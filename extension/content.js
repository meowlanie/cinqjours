function extractYtInitialPlayerResponse() {
  try {
    const w = window;
    if (w.ytInitialPlayerResponse) return w.ytInitialPlayerResponse;
  } catch (e) {
    /* ignore */
  }
  // Fallback: parse the player response out of the page HTML (balanced braces).
  try {
    const html = document.documentElement.innerHTML;
    const marker = "ytInitialPlayerResponse = ";
    const idx = html.indexOf(marker);
    if (idx !== -1) {
      let i = idx + marker.length;
      let depth = 0;
      let inStr = false;
      let esc = false;
      let start = -1;
      for (; i < html.length; i++) {
        const ch = html[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === "{") {
          if (depth === 0) start = i;
          depth++;
        } else if (ch === "}") {
          depth--;
          if (depth === 0 && start !== -1) {
            const slice = html.slice(start, i + 1);
            return JSON.parse(slice);
          }
        }
      }
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "extract") {
    try {
      const y = extractYtInitialPlayerResponse();
      const tracks =
        (y &&
          y.captions &&
          y.captions.playerCaptionsTracklistRenderer &&
          y.captions.playerCaptionsTracklistRenderer.captionTracks) ||
        [];
      const videoId =
        (y && y.videoDetails && y.videoDetails.videoId) ||
        new URLSearchParams(location.search).get("v");
      const title =
        (y && y.videoDetails && y.videoDetails.title) ||
        document.title.replace(/\s*-\s*YouTube$/, "").trim();
      sendResponse({ videoId, captionTracks: tracks, title });
    } catch (e) {
      sendResponse({ error: String(e) });
    }
  }
  return true;
});
