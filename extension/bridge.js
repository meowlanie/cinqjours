// Bridge content script injected into cinqjours.app (and localhost during dev).
// Relays messages between the page and the extension's background service worker.

window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || typeof d !== "object") return;
  if (d.type === "cjq:need-captions") {
    chrome.runtime.sendMessage({
      type: "cjq:need-captions",
      videoId: d.videoId,
      targetLang: d.targetLang,
      requestId: d.requestId,
    });
  } else if (d.type === "cjq:ping") {
    window.postMessage({ type: "cjq:pong" }, "*");
  } else if (d.type === "cjq:targetLang") {
    try {
      chrome.storage.local.set({ targetLang: d.targetLang });
    } catch {
      /* ignore */
    }
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === "cjq:captions") {
    window.postMessage(
      { type: "cjq:captions", requestId: msg.requestId, rawTrack: msg.rawTrack, title: msg.title },
      "*"
    );
  } else if (msg.type === "cjq:import") {
    window.postMessage(
      { type: "cjq:import", videoId: msg.videoId, title: msg.title, rawTrack: msg.rawTrack },
      "*"
    );
  } else if (msg.type === "cjq:error") {
    window.postMessage({ type: "cjq:error", videoId: msg.videoId, message: msg.message }, "*");
  } else if (msg.type === "cjq:retry") {
    window.postMessage({ type: "cjq:retry" }, "*");
  }
});
