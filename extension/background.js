const DEFAULT_APP_URL = "http://localhost:3000";

function getAppUrl() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get("appUrl", (r) => resolve(r && r.appUrl ? r.appUrl : DEFAULT_APP_URL));
    } catch {
      resolve(DEFAULT_APP_URL);
    }
  });
}

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

async function fetchTrackText(track, videoId) {
  // Primary: the caption track baseUrl (carries the user's session cookies).
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
    console.error("[cjq] track fetch failed", e);
  }
  // Fallback: legacy timedtext endpoint (no InnerTube, uses the session).
  if (videoId) {
    try {
      const tt = `https://www.youtube.com/api/timedtext?lang=${encodeURIComponent(
        track.languageCode || ""
      )}&v=${encodeURIComponent(videoId)}&fmt=json3`;
      const res = await fetch(tt, {
        credentials: "include",
        headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "fr,en;q=0.9" },
      });
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim()) return text;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function getTargetLang(appUrl) {
  try {
    const res = await fetch(`${appUrl}/api/extension-import/target`);
    if (res.ok) {
      const d = await res.json();
      return d.targetLang || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id || !tab.url || !tab.url.includes("youtube.com/watch")) {
    console.log("[cjq] Open a YouTube watch page, then click the icon.");
    return;
  }

  const appUrl = await getAppUrl();

  let info;
  try {
    info = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: "extract" }, (resp) => resolve(resp));
    });
  } catch (e) {
    console.error("[cjq] content script message failed", e);
    return;
  }

  if (!info || !info.videoId || !info.captionTracks || info.captionTracks.length === 0) {
    console.log("[cjq] No caption tracks found on this video.");
    return;
  }

  const preferLang = await getTargetLang(appUrl);
  const track = pickTrack(info.captionTracks, preferLang);
  if (!track) {
    console.log("[cjq] No caption track to import.");
    return;
  }

  const raw = await fetchTrackText(track, info.videoId);
  if (!raw) {
    console.log("[cjq] Could not fetch caption text (YouTube may require extra auth).");
    return;
  }

  try {
    const res = await fetch(`${appUrl}/api/extension-import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoId: info.videoId,
        rawTrack: raw,
        title: info.title ?? null,
        lang: track.languageCode ?? null,
      }),
    });
    if (res.ok) {
      chrome.tabs.create({ url: `${appUrl}/?ext=${encodeURIComponent(info.videoId)}` });
    } else {
      console.error("[cjq] import failed", await res.text());
    }
  } catch (e) {
    console.error("[cjq] POST to app failed (is it running on " + appUrl + "?)", e);
  }
});
