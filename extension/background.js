const APP_URL = "https://cinqjours.app";

function pickTrack(tracks, preferLang) {
  if (!tracks || tracks.length === 0) return null;
  if (preferLang) {
    const p = tracks.find(
      (t) => t.languageCode === preferLang || (t.languageCode || "").startsWith(preferLang + "-")
    );
    if (p) return p;
  }
  const manual = tracks.find((t) => t.kind !== "asr");
  return manual || tracks[0];
}

// Service-worker fallback fetch (used only when no YouTube tab is open/injectable).
async function fetchTrackTextSW(track, videoId) {
  try {
    const u = new URL(track.baseUrl.replace(/&amp;/g, "&"));
    u.searchParams.delete("fmt");
    u.searchParams.delete("kind");
    u.searchParams.set("fmt", "json3");
    const res = await fetch(u.toString(), {
      credentials: "include",
      headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "fr,en;q=0.9" },
    });
    if (res.ok) {
      const text = await res.text();
      if (text && text.trim()) return text;
    }
  } catch (e) {
    console.error("[cjq] sw track fetch failed", e);
  }
  return null;
}

function getTargetLang() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get("targetLang", (r) => resolve((r && r.targetLang) || "fr"));
    } catch {
      resolve("fr");
    }
  });
}

function findCjqTab(tabs) {
  const list = tabs || [];
  return (
    list.find((t) => t.url && t.url.includes("cinqjours.app")) ||
    list.find((t) => t.url && t.url.startsWith("http://localhost")) ||
    null
  );
}

function waitSend(tabId, payload, attempts) {
  attempts = attempts || 25;
  chrome.tabs.sendMessage(tabId, payload, () => {
    if (chrome.runtime.lastError && attempts > 1) {
      setTimeout(() => waitSend(tabId, payload, attempts - 1), 300);
    }
  });
}

function sendToApp(videoId, title, rawTrack) {
  const payload = { type: "cjq:import", videoId, title: title ?? null, rawTrack };
  chrome.tabs.query({}, (tabs) => {
    const tab = findCjqTab(tabs);
    if (tab && tab.id != null) {
      chrome.tabs.update(tab.id, { active: true });
      chrome.tabs.sendMessage(tab.id, payload, () => {
        if (chrome.runtime.lastError) {
          console.warn("[cjq] bridge not ready, opening app", chrome.runtime.lastError.message);
          chrome.tabs.create({ url: APP_URL, active: true }, (nt) => nt && nt.id != null && waitSend(nt.id, payload));
        }
      });
    } else {
      chrome.tabs.create({ url: APP_URL, active: true }, (nt) => nt && nt.id != null && waitSend(nt.id, payload));
    }
  });
}

function sendAppError(videoId, message) {
  chrome.tabs.query({}, (tabs) => {
    const tab = findCjqTab(tabs);
    if (tab && tab.id != null) {
      chrome.tabs.update(tab.id, { active: true });
      chrome.tabs.sendMessage(tab.id, { type: "cjq:error", videoId, message }, () => {
        if (chrome.runtime.lastError) console.warn("[cjq] error delivery failed", chrome.runtime.lastError.message);
      });
    }
  });
}

function tabsReady() {
  return new Promise((resolve) => chrome.tabs.query({}, (t) => resolve(t || [])));
}

function findYoutubeTab(tabs) {
  const list = tabs || [];
  return list.find((t) => t.url && /youtube\.com|youtube\.fr|youtu\.be/.test(t.url) && /[?&]v=/.test(t.url)) || null;
}

function isYoutubeWatch(tab) {
  return !!(tab && tab.url && /youtube\.com|youtube\.fr|youtu\.be/.test(tab.url) && /[?&]v=/.test(tab.url));
}

// Make sure content.js is present in the YouTube tab; inject it on demand if not.
// Returns true on success, or the Chrome error message string on failure.
async function ensureContentScript(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: "cjq:ping-content" });
    if (r && r.ok) return true;
  } catch {
    /* not present yet */
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return true;
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.warn("[cjq] inject content.js failed:", msg);
    return msg;
  }
}

function sendExtract(tabId) {
  return new Promise((resolve) =>
    chrome.tabs.sendMessage(tabId, { type: "extract" }, (r) => {
      if (chrome.runtime.lastError) {
        console.warn("[cjq] extract: receiver not ready:", chrome.runtime.lastError.message);
        resolve(null);
      } else {
        resolve(r);
      }
    })
  );
}

function sendFetch(tabId, info, preferLang) {
  return new Promise((resolve) =>
    chrome.tabs.sendMessage(
      tabId,
      { type: "cjq:fetch", videoId: info.videoId, captionTracks: info.captionTracks, title: info.title, targetLang: preferLang },
      (r) => {
        if (chrome.runtime.lastError) {
          console.warn("[cjq] fetch: receiver not ready:", chrome.runtime.lastError.message);
          resolve(null);
        } else {
          resolve(r);
        }
      }
    )
  );
}

// One-click import. Only ever acts on the ACTIVE tab (the one you clicked from),
// because clicking the toolbar action grants the `activeTab` permission for it —
// no host_permissions needed. If you click while on a non-YouTube tab, it focuses
// an open YouTube tab and asks you to click the icon again there.
chrome.action.onClicked.addListener(async (tab) => {
  const tabs = await tabsReady();

  // 1. You clicked while ON the YouTube video → import it directly.
  if (tab && tab.id != null && isYoutubeWatch(tab)) {
    await importFromTab(tab.id);
    return;
  }

  // 2. You clicked elsewhere → focus an open YouTube tab and ask for a re-click.
  const ytTab = findYoutubeTab(tabs);
  if (ytTab && ytTab.id != null) {
    try {
      if (ytTab.windowId != null) chrome.windows.update(ytTab.windowId, { focused: true });
    } catch {
      /* ignore */
    }
    chrome.tabs.update(ytTab.id, { active: true });
    sendAppError(null, "Cliquez à nouveau sur l'icône de l'extension dans l'onglet YouTube.");
    return;
  }

  // 3. No YouTube tab open → just open/focus the app.
  const existing = findCjqTab(tabs);
  if (existing && existing.id != null) chrome.tabs.update(existing.id, { active: true });
  else chrome.tabs.create({ url: APP_URL, active: true });
});

async function importFromTab(tabId) {
  const ready = await ensureContentScript(tabId);
  if (ready !== true) {
    sendAppError(null, "Impossible d'injecter le script dans l'onglet YouTube : " + (typeof ready === "string" ? ready : "rechargez l'onglet."));
    return;
  }

  const info = await sendExtract(tabId);
  if (!info || !info.videoId) {
    console.warn("[cjq] No video detected on the YouTube tab.");
    sendAppError(null, "Aucune vidéo détectée sur l'onglet YouTube. Rechargez l'onglet YouTube.");
    return;
  }

  const preferLang = await getTargetLang();
  const fetched = await sendFetch(tabId, info, preferLang);
  if (!fetched || !fetched.rawTrack) {
    sendAppError(info.videoId, (fetched && fetched.error) || "Impossible de récupérer les sous-titres depuis YouTube.");
    return;
  }
  sendToApp(info.videoId, info.title ?? null, fetched.rawTrack);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "cjq:need-captions") return;
  (async () => {
    try {
      const videoId = msg.videoId;
      const preferLang = msg.targetLang || (await getTargetLang());
      const tabs = await tabsReady();
      const ytTab = findYoutubeTab(tabs);
      let raw = null;
      let title = null;
      if (ytTab && ytTab.id != null) {
        await ensureContentScript(ytTab.id);
        const f = await new Promise((resolve) =>
          chrome.tabs.sendMessage(ytTab.id, { type: "cjq:fetch", videoId, targetLang: preferLang }, (r) => {
            if (chrome.runtime.lastError) {
              console.warn("[cjq] yt fetch: receiver not ready:", chrome.runtime.lastError.message);
              resolve(null);
            } else {
              resolve(r);
            }
          })
        );
        raw = f && f.rawTrack;
        title = f && f.title;
        if (!raw && f && f.error) console.warn("[cjq] yt fetch failed:", f.error);
      }
      if (!raw) {
        // Fallback: SW InnerTube fetch (works only for public videos; private
        // videos require the signed-in YouTube tab above).
        try {
          const resp = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              context: { client: { clientName: "WEB", clientVersion: "2.20240504.01.00" } },
              videoId,
            }),
          });
          let data = null;
          const ct = resp.headers.get("content-type") || "";
          if (ct.includes("json")) {
            try {
              data = await resp.json();
            } catch {
              data = null;
            }
          }
          const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
          title = title || data?.videoDetails?.title || null;
          const track = pickTrack(tracks, preferLang);
          raw = track ? await fetchTrackTextSW(track, videoId) : null;
        } catch (e) {
          console.warn("[cjq] SW player fetch failed", e);
        }
      }
      if (sender.tab && sender.tab.id != null) {
        chrome.tabs.sendMessage(
          sender.tab.id,
          { type: "cjq:captions", requestId: msg.requestId, rawTrack: raw, title },
          () => {
            if (chrome.runtime.lastError) console.warn("[cjq] captions delivery failed", chrome.runtime.lastError.message);
          }
        );
      }
    } catch (e) {
      console.error("[cjq] need-captions failed", e);
    }
  })();
  return true;
});
