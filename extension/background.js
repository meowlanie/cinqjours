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
async function fetchTrackTextSW(track, poToken) {
  try {
    // Keep the signed query byte-for-byte. URLSearchParams re-encodes commas in
    // `sparams` and invalidates the signature, so strip fmt as raw text only.
    const base = track.baseUrl.replace(/&amp;/g, "&");
    const absolute = base.startsWith("//") ? `https:${base}` : base;
    const raw = absolute.replace(/([?&])fmt=[^&]*&?/, "$1").replace(/[?&]$/, "");
    const hasPot = /[?&]pot=/.test(raw);
    const hasClient = /[?&]c=/.test(raw);
    const potParams = poToken
      ? `${hasPot ? "" : "&pot=" + encodeURIComponent(poToken)}${hasClient ? "" : "&c=WEB"}`
      : "";
    const url = `${raw}${potParams}${raw.includes("?") ? "&" : "?"}fmt=json3`;
    const res = await fetch(url, {
      credentials: "include",
      headers: { "Accept-Language": "en;q=0.9" },
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

function isAppUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === "cinqjours.app" || u.hostname === "www.cinqjours.app" ||
      u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function findCjqTab(tabs) {
  const list = tabs || [];
  return list.find((t) => t.url && isAppUrl(t.url)) || null;
}

function waitSend(tabId, payload, attempts) {
  attempts = attempts || 25;
  chrome.tabs.sendMessage(tabId, payload, () => {
    if (chrome.runtime.lastError && attempts > 1) {
      setTimeout(() => waitSend(tabId, payload, attempts - 1), 300);
    }
  });
}

function deliverToApp(payload) {
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

function sendToApp(videoId, title, rawTrack) {
  // Duplicate delivery is filtered in the app; repeated imports of the same
  // video must still be allowed here.
  deliverToApp({ type: "cjq:import", videoId, title: title ?? null, rawTrack });
}

/**
 * Errors are sent as stable codes so the app can localize them; the raw detail
 * stays in the extension console for debugging.
 */
function sendAppError(videoId, code, detail) {
  if (detail) console.warn("[cjq] " + code, detail);
  deliverToApp({ type: "cjq:error", videoId, code, detail: detail || null });
}

function tabsReady() {
  return new Promise((resolve) => chrome.tabs.query({}, (t) => resolve(t || [])));
}

function waitForTabComplete(tabId, timeoutMs) {
  timeoutMs = timeoutMs || 10000;
  return new Promise((resolve) => {
    let loadingSeen = false;
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve(ok);
    };
    const listener = (id, info) => {
      if (id !== tabId) return;
      if (info.status === "loading") loadingSeen = true;
      else if (info.status === "complete" && loadingSeen) finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) finish(false);
      else if (tab && tab.status === "loading") loadingSeen = true;
    });
  });
}

function findYoutubeTab(tabs) {
  const list = (tabs || []).filter(isYoutubeWatch);
  // The tab the user is actually looking at wins; otherwise fall back to the
  // first watch tab. Query order alone made imports stick to an older video.
  return list.find((t) => t.active) || list[0] || null;
}

function youtubeVideoIdFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (u.hostname.endsWith("youtube.com") || u.hostname.endsWith("youtube.fr")) {
      return u.searchParams.get("v") || (u.pathname.startsWith("/shorts/") ? u.pathname.split("/")[2] : null);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function findYoutubeTabFor(tabs, videoId) {
  const list = (tabs || []).filter(isYoutubeWatch);
  if (videoId) {
    return list.find((t) => youtubeVideoIdFromUrl(t.url) === videoId) || null;
  }
  return findYoutubeTab(list);
}

function isYoutubeWatch(tab) {
  return !!(tab && tab.url && youtubeVideoIdFromUrl(tab.url));
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

function sendFetch(tabId, info, preferLang, pageData) {
  return new Promise((resolve) =>
    chrome.tabs.sendMessage(
      tabId,
      {
        type: "cjq:fetch",
        videoId: info.videoId,
        captionTracks: info.captionTracks,
        title: info.title,
        targetLang: preferLang,
        pageData: pageData || null,
      },
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

/**
 * Content scripts live in an isolated world: `window.ytInitialPlayerResponse`
 * and `window.ytInitialData` are invisible to them. Inject into the page's MAIN
 * world instead, where the real objects (and ytcfg) live. The function is
 * serialized, so it must stay self-contained.
 */
async function mintPoToken(videoId) {
  if (!videoId) return null;
  try {
    const res = await fetch(`${APP_URL}/api/transcribe?videoId=${encodeURIComponent(videoId)}`);
    if (!res.ok) {
      console.warn("[cjq] PoToken endpoint HTTP", res.status);
      return null;
    }
    const data = await res.json();
    return data.pot || null;
  } catch (e) {
    console.warn("[cjq] PoToken endpoint failed", e);
    return null;
  }
}

async function extractPageData(tabId) {
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        try {
          let transcriptParams = null;
          const findParams = (obj, depth) => {
            if (!obj || typeof obj !== "object" || depth > 12 || transcriptParams) return;
            if (obj.getTranscriptEndpoint && obj.getTranscriptEndpoint.params) {
              transcriptParams = obj.getTranscriptEndpoint.params;
              return;
            }
            for (const k in obj) {
              if (k === "__proto__" || k === "prototype") continue;
              const v = obj[k];
              if (v && typeof v === "object") findParams(v, depth + 1);
            }
          };
          try { if (window.ytInitialData) findParams(window.ytInitialData, 0); } catch { /* ignore */ }

          const y = window.ytInitialPlayerResponse || null;
          const tracks =
            (y && y.captions && y.captions.playerCaptionsTracklistRenderer &&
              y.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
          const videoId =
            (y && y.videoDetails && y.videoDetails.videoId) ||
            new URLSearchParams(location.search).get("v") || null;
          const title =
            (y && y.videoDetails && y.videoDetails.title) ||
            document.title.replace(/\s*-\s*YouTube$/, "").trim() || null;
          const poToken =
            (y && y.serviceIntegrityDimensions && y.serviceIntegrityDimensions.poToken) || null;

          const cfg = window.ytcfg || {};
          const get = typeof cfg.get === "function" ? (k) => cfg.get(k) : () => null;
          return {
            videoId,
            captionTracks: tracks,
            title,
            transcriptParams,
            poToken,
            apiKey: get("INNERTUBE_API_KEY") || "AIzaSyAO_FJ2SlqU8Q4IZoHfKFWCCXObxKut7cw",
            clientVersion: get("INNERTUBE_CLIENT_VERSION") || "2.20240101.00.00",
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    });
    const result = injected && injected[0] && injected[0].result;
    if (!result || result.error) return null;
    return result;
  } catch (e) {
    console.warn("[cjq] MAIN-world extract failed", e);
    return null;
  }
}

// One-click import. Only ever acts on the ACTIVE tab (the one you clicked from).
// If you click while on a non-YouTube tab, it focuses an open YouTube tab and
// asks you to click the icon again there.
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
    sendAppError(null, "reclick");
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
    sendAppError(null, "inject", typeof ready === "string" ? ready : null);
    return;
  }

  // MAIN-world data is authoritative; the isolated-world extract stays as a
  // fallback for pages where script injection is restricted.
  let pageData = await extractPageData(tabId);
  // YouTube is an SPA: an in-site navigation changes the URL while
  // ytInitialPlayerResponse can still describe the previous video. Reload once
  // so the player data (and its signed caption URLs) match the current video.
  let urlId = null;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.url) urlId = youtubeVideoIdFromUrl(tab.url);
    if (urlId && pageData && pageData.videoId !== urlId) {
      console.warn("[cjq] stale player response; reloading watch tab", pageData.videoId, urlId);
      const navigated = waitForTabComplete(tabId);
      await chrome.tabs.reload(tabId);
      if (!(await navigated)) {
        sendAppError(urlId, "inject", "watch tab did not finish reloading");
        return;
      }
      await ensureContentScript(tabId);
      pageData = await extractPageData(tabId);
    }
  } catch (e) {
    console.warn("[cjq] stale-page check failed", e);
  }
  const info = await sendExtract(tabId);
  const videoId = urlId || (pageData && pageData.videoId) || (info && info.videoId);
  const captionTracks =
    (pageData && pageData.captionTracks && pageData.captionTracks.length && pageData.captionTracks) ||
    (info && info.captionTracks) || [];
  const title = (pageData && pageData.title) || (info && info.title) || null;
  if (!videoId) {
    console.warn("[cjq] No video detected on the YouTube tab.");
    sendAppError(null, "no-video");
    return;
  }
  if (pageData && !pageData.poToken) pageData.poToken = await mintPoToken(videoId);

  const preferLang = await getTargetLang();
  const fetched = await sendFetch(tabId, { videoId, captionTracks, title }, preferLang, pageData);
  if (!fetched || !fetched.rawTrack) {
    sendAppError(videoId, "no-captions", fetched && fetched.error);
    return;
  }
  sendToApp(videoId, fetched.title || title, fetched.rawTrack);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "cjq:need-captions") return;
  (async () => {
    const reply = (rawTrack, title, error) => {
      if (!sender.tab || sender.tab.id == null) return;
      chrome.tabs.sendMessage(
        sender.tab.id,
        { type: "cjq:captions", requestId: msg.requestId, rawTrack: rawTrack || null, title: title || null, error: error || null },
        () => {
          if (chrome.runtime.lastError) console.warn("[cjq] captions delivery failed", chrome.runtime.lastError.message);
        }
      );
    };
    try {
      const videoId = msg.videoId;
      const preferLang = msg.targetLang || (await getTargetLang());
      const tabs = await tabsReady();
      const ytTab = findYoutubeTabFor(tabs, videoId);
      let raw = null;
      let title = null;
      if (ytTab && ytTab.id != null) {
        await ensureContentScript(ytTab.id);
        let pageData = await extractPageData(ytTab.id);
        const pageMismatch = !!pageData && !!videoId && pageData.videoId !== videoId;
        if (pageMismatch) {
          // A wrong-video tab's tracks, params, PoToken and DOM panel must never
          // be used for this import; fall through to the InnerTube SW path.
          console.warn("[cjq] YouTube tab is on a different video; ignoring page data", pageData.videoId, videoId);
          pageData = null;
        }
        if (pageData && !pageData.poToken) {
          pageData.poToken = await mintPoToken(videoId || pageData.videoId);
        }
        if (!pageMismatch) {
          const f = await new Promise((resolve) =>
            chrome.tabs.sendMessage(
              ytTab.id,
              { type: "cjq:fetch", videoId, targetLang: preferLang, pageData },
              (r) => {
                if (chrome.runtime.lastError) {
                  console.warn("[cjq] yt fetch: receiver not ready:", chrome.runtime.lastError.message);
                  resolve(null);
                } else {
                  resolve(r);
                }
              }
            )
          );
          raw = f && f.rawTrack;
          title = f && f.title;
          if (!raw && f && f.error) console.warn("[cjq] yt fetch failed:", f.error);
        }
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
          const swPot = await mintPoToken(videoId);
          raw = track ? await fetchTrackTextSW(track, swPot) : null;
        } catch (e) {
          console.warn("[cjq] SW player fetch failed", e);
        }
      }
      reply(raw, title);
    } catch (e) {
      console.error("[cjq] need-captions failed", e);
      reply(null, null, String(e));
    }
  })();
  return false;
});
