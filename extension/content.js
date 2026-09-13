function extractYtInitialPlayerResponse() {
  try {
    if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;
  } catch (e) {
    /* ignore */
  }
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
            return JSON.parse(html.slice(start, i + 1));
          }
        }
      }
    }
  } catch (e) {
    /* ignore */
  }
  return null;
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

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- Find the pre-computed get_transcript params YouTube stores on the page ---

function findGetTranscriptParams(obj, depth) {
  if (!obj || typeof obj !== "object" || (depth || 0) > 10) return null;
  if (obj.getTranscriptEndpoint && obj.getTranscriptEndpoint.params) {
    return obj.getTranscriptEndpoint.params;
  }
  for (const k in obj) {
    if (k === "__proto__" || k === "prototype") continue;
    const v = obj[k];
    if (v && typeof v === "object") {
      const r = findGetTranscriptParams(v, (depth || 0) + 1);
      if (r) return r;
    }
  }
  return null;
}

function extractTranscriptParams() {
  try {
    const p = findGetTranscriptParams(window.ytInitialData, 0);
    if (p) return p;
  } catch {
    /* ignore */
  }
  try {
    const html = document.documentElement.innerHTML;
    const m = html.match(/"getTranscriptEndpoint":\s*\{\s*"params":\s*"([^"]+)"/);
    if (m) return m[1];
  } catch {
    /* ignore */
  }
  return null;
}

// Recursively collect transcript cues regardless of response structure.
function collectCues(obj, out) {
  if (!obj || typeof obj !== "object" || out.length > 10000) return out;
  if (obj.transcriptCueRenderer) out.push({ kind: "cue", r: obj.transcriptCueRenderer });
  if (obj.transcriptSegmentRenderer) out.push({ kind: "seg", r: obj.transcriptSegmentRenderer });
  for (const k in obj) {
    if (k === "__proto__" || k === "prototype") continue;
    const v = obj[k];
    if (v && typeof v === "object") collectCues(v, out);
  }
  return out;
}

function textOf(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.simpleText) return node.simpleText;
  if (node.text) return node.text;
  if (Array.isArray(node.runs)) return node.runs.map((r) => r.text || "").join("");
  return "";
}

function cuesToXml(cues) {
  return cues
    .map((c) => {
      const r = c.r;
      if (c.kind === "cue") {
        const text = textOf(r.cue);
        if (!text.trim()) return null;
        const start = (parseFloat(r.startOffsetMs) || 0) / 1000;
        const dur = (parseFloat(r.durationMs) || 0) / 1000;
        return `<text start="${start.toFixed(3)}" dur="${dur.toFixed(3)}">${escapeXml(text)}</text>`;
      }
      const snip = r.snippet || {};
      const text = textOf(snip);
      if (!text.trim()) return null;
      const startMs = parseFloat(r.startMs) || 0;
      const endMs = parseFloat(r.endMs) || startMs;
      return `<text start="${(startMs / 1000).toFixed(3)}" dur="${((endMs - startMs) / 1000).toFixed(3)}">${escapeXml(text)}</text>`;
    })
    .filter(Boolean)
    .join("");
}

function getApiKey() {
  return (window.ytcfg?.get?.("INNERTUBE_API_KEY")) || "AIzaSyAO_FJ2SlqU8Q4IZoHfKFWCCXObxKut7cw";
}

function getClientVersion() {
  return (window.ytcfg?.get?.("INNERTUBE_CLIENT_VERSION")) || "2.20240101.00.00";
}

async function callGetTranscript(params, lang, diagnostics) {
  const res = await fetch(
    "https://www.youtube.com/youtubei/v1/get_transcript?key=" +
      encodeURIComponent(getApiKey()) +
      "&prettyPrint=false",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion: getClientVersion() } },
        params,
      }),
    }
  );
  diagnostics.status = res.status;
  if (!res.ok) return null;
  const data = await res.json();
  const cues = collectCues(data, []);
  diagnostics.cues = cues.length;
  return cues.length ? cuesToXml(cues) : null;
}

// --- Method 1: pre-computed params from the page ---
async function fetchTranscriptFromPage(diag) {
  const params = extractTranscriptParams();
  diag.paramsFound = !!params;
  if (!params) return null;
  const xml = await callGetTranscript(params, null, diag);
  return xml || null;
}

// --- Method 2: guessed protobuf params per language ---
function buildTranscriptParams(videoId, lang, fieldTags) {
  const s =
    String.fromCharCode(fieldTags[0]) +
    String.fromCharCode(videoId.length) +
    videoId +
    String.fromCharCode(fieldTags[1]) +
    String.fromCharCode(lang.length) +
    lang;
  return btoa(unescape(encodeURIComponent(s)));
}

async function fetchTranscriptGuessed(videoId, lang, diag) {
  const encodings = [
    [0x12, 0x1a],
    [0x0a, 0x12],
  ];
  for (const tags of encodings) {
    try {
      const params = buildTranscriptParams(videoId, lang, tags);
      const xml = await callGetTranscript(params, lang, diag);
      if (xml) return xml;
    } catch (e) {
      diag.guessError = String(e);
    }
  }
  return null;
}

// --- Method 3: direct baseUrl / timedtext fetch ---
function getPoToken() {
  try {
    const y = extractYtInitialPlayerResponse();
    return y?.serviceIntegrityDimensions?.poToken || null;
  } catch {
    return null;
  }
}

async function fetchWithPot(url, diag, key) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "fr,en;q=0.9" },
  });
  diag[key] = res.status;
  if (res.ok) {
    const text = await res.text();
    if (text && text.trim()) return text;
  }
  return null;
}

async function fetchTrackText(track, videoId, diag) {
  // Fetch the baseUrl UNCHANGED — its signature is computed over the existing
  // params, so deleting/replacing them invalidates it and YouTube returns 200
  // with an empty body. Only append fmt=json3 if missing.
  let url = track.baseUrl.replace(/&amp;/g, "&");
  if (!url.includes("fmt=")) url += (url.includes("?") ? "&" : "?") + "fmt=json3";

  // 1. Plain baseUrl.
  let text = await fetchWithPot(url, diag, "baseUrlStatus");
  if (text) return text;

  // 2. baseUrl + PoToken (required for gated videos).
  const pot = getPoToken();
  if (pot) {
    diag.potFound = true;
    const potUrl = url + (url.includes("?") ? "&" : "?") + "pot=" + encodeURIComponent(pot) + "&c=WEB";
    text = await fetchWithPot(potUrl, diag, "baseUrlPotStatus");
    if (text) return text;
  } else {
    diag.potFound = false;
  }

  // 3. Timedtext fallback (no signature) + PoToken if available.
  if (videoId) {
    let tt =
      "https://www.youtube.com/api/timedtext?lang=" +
      encodeURIComponent(track.languageCode || "") +
      "&v=" +
      encodeURIComponent(videoId) +
      "&fmt=json3";
    if (pot) tt += "&pot=" + encodeURIComponent(pot) + "&c=WEB";
    text = await fetchWithPot(tt, diag, "timedtextStatus");
    if (text) return text;
  }
  return null;
}

// --- Method 4: scrape YouTube's transcript panel (DOM + network interception) ---
// Bypasses the caption API entirely (reads what YouTube already rendered / fetched).
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Hook fetch ONCE to capture YouTube's own successful transcript responses
// (the page issues them with a valid PoToken when the panel opens).
(function installTranscriptHook() {
  if (window.__cjqHookInstalled) return;
  window.__cjqHookInstalled = true;
  window.__cjqTranscriptSamples = [];
  try {
    const orig = window.fetch;
    window.fetch = function (...args) {
      const p = orig.apply(this, args);
      try {
        const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
        if (/get_transcript|\/youtubei\/v1\/browse/.test(url)) {
          p.then(async (res) => {
            try {
              const text = await res.clone().text();
              if (/transcriptCueRenderer|transcriptSegmentRenderer/.test(text)) {
                window.__cjqTranscriptSamples.push(text);
              }
            } catch {
              /* ignore */
            }
          }).catch(() => {});
        }
      } catch {
        /* ignore */
      }
      return p;
    };
  } catch {
    /* ignore */
  }
})();

function transcriptPanel() {
  return document.querySelector(
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]'
  );
}

function clickElement(el) {
  if (!el) return;
  try {
    el.scrollIntoView({ block: "center" });
  } catch {
    /* ignore */
  }
  const evts = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
  // YouTube's new ytSpecButtonShapeNextHost components use shadow DOM — the
  // actual click handler lives on the inner element, not the outer host.
  const targets = [el];
  if (el.shadowRoot) {
    const inner = el.shadowRoot.querySelector("button, [role='button'], [tabindex]");
    if (inner) targets.push(inner);
  }
  for (const target of targets) {
    for (const t of evts) {
      try {
        target.dispatchEvent(
          new MouseEvent(t, { bubbles: true, cancelable: true, view: window, buttons: 1 })
        );
      } catch {
        /* ignore */
      }
    }
  }
}

function findTranscriptButton() {
  const classSels = [
    "ytd-video-description-transcript-section-renderer button",
    "ytd-video-description-transcript-section-renderer ytd-button-renderer button",
    "ytd-video-description-transcript-section-renderer #button button",
  ];
  for (const sel of classSels) {
    const b = document.querySelector(sel);
    if (b) return b;
  }
  const buttons = document.querySelectorAll(
    "button, yt-button-shape button, yt-button-shape, ytd-button-renderer, tp-yt-paper-button"
  );
  for (const b of buttons) {
    const label = ((b.getAttribute("aria-label") || "") + " " + (b.textContent || "")).toLowerCase();
    if (label.includes("transcri")) return b.querySelector("button") || b;
  }
  return null;
}

// Open the "…" overflow menu and click a "transcript" item (language-agnostic).
function openViaMoreMenu() {
  const toOpen =
    document.querySelector("#actions ytd-menu-renderer button") ||
    document.querySelector("#actions button") ||
    document.querySelector('#menu button[aria-label*="more"], #menu button[aria-label*="Actions"]') ||
    document.querySelector("#actions yt-button-shape button");
  if (!toOpen) return false;
  clickElement(toOpen);
  for (let i = 0; i < 40; i++) {
    const items = document.querySelectorAll(
      "ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer"
    );
    for (const item of items) {
      if ((item.textContent || "").toLowerCase().includes("transcri")) {
        clickElement(item);
        return true;
      }
    }
  }
  return false;
}

async function openTranscriptPanel(diag) {
  try {
    const expand = document.querySelector("#expand");
    if (expand) clickElement(expand);
  } catch {
    /* ignore */
  }
  let btn = null;
  for (let i = 0; i < 20 && !btn; i++) {
    btn = findTranscriptButton();
    if (!btn) await sleep(200);
  }
  if (btn) {
    diag.domButtonFound = true;
    diag.domButton = (btn.outerHTML || "").slice(0, 140);
    diag.domButtonText = (btn.textContent || "").trim().slice(0, 60);
    clickElement(btn);
    return true;
  }
  diag.domButtonFound = false;
  diag.domViaMenu = openViaMoreMenu();
  return diag.domViaMenu;
}

// Read transcript segments. Text/timestamp live inside each renderer's SHADOW
// DOM, so pierce it (with light-DOM / textContent fallbacks).
function readTranscriptSegments() {
  const items = [];
  document.querySelectorAll("ytd-transcript-segment-renderer").forEach((s) => {
    const root = s.shadowRoot || s;
    const text =
      root.querySelector(".segment-text")?.textContent?.trim() ||
      root.querySelector("yt-formatted-string")?.textContent?.trim() ||
      s.textContent?.trim() ||
      "";
    const ts =
      root.querySelector(".segment-timestamp")?.textContent?.trim() ||
      root.querySelector(".segment-start-offset")?.textContent?.trim() ||
      "";
    if (text) items.push({ text, ts });
  });
  return items;
}

function tsToSeconds(ts) {
  const parts = ts.split(":").map((n) => parseInt(n, 10) || 0);
  if (parts.length >= 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function countSegments() {
  return document.querySelectorAll("ytd-transcript-segment-renderer").length;
}

// Parse an intercepted transcript network response into XML.
function parseInterceptedResponse(text) {
  const data = JSON.parse(text);
  const cues = collectCues(data, []);
  return cues.length ? cuesToXml(cues) : null;
}

async function fetchTranscriptFromDOM(diag) {
  if (window.__cjqTranscriptSamples.length === 0 && countSegments() === 0) {
    await openTranscriptPanel(diag);
    // Poll for either intercepted data or rendered segments.
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      if (window.__cjqTranscriptSamples.length > 0 || countSegments() > 0) break;
    }
  }

  // Prefer intercepted network response (cleanest signal).
  for (const sample of window.__cjqTranscriptSamples.splice(0)) {
    try {
      const xml = parseInterceptedResponse(sample);
      if (xml) {
        diag.domOpened = true;
        diag.domSource = "network";
        return xml;
      }
    } catch (e) {
      diag.parseError = String(e);
    }
  }

  if (countSegments() === 0) {
    diag.domOpened = false;
    return null;
  }
  diag.domOpened = true;

  // Scroll the panel/page to load all lazy segments.
  const panel = transcriptPanel();
  const scroller =
    panel?.querySelector("#segments-container") || panel?.querySelector("#content") || panel || document.scrollingElement;
  for (let i = 0; i < 400; i++) {
    const before = countSegments();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    await sleep(120);
    if (countSegments() === before && i > 2) break;
  }

  const items = readTranscriptSegments();
  const uniq = [];
  const seen = new Set();
  for (const it of items) {
    const k = it.ts + "|" + it.text;
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(it);
    }
  }
  diag.domSegments = uniq.length;
  if (!uniq.length) return null;

  let xml = "";
  for (let i = 0; i < uniq.length; i++) {
    const start = tsToSeconds(uniq[i].ts);
    const nextStart = i + 1 < uniq.length ? tsToSeconds(uniq[i + 1].ts) : start + 3;
    const dur = Math.max(nextStart - start, 0.3);
    xml += `<text start="${start.toFixed(3)}" dur="${dur.toFixed(3)}">${escapeXml(uniq[i].text)}</text>`;
  }
  diag.domSource = "dom";
  return xml || null;
}

function currentVideoMeta() {
  const y = extractYtInitialPlayerResponse();
  const tracks =
    (y &&
      y.captions &&
      y.captions.playerCaptionsTracklistRenderer &&
      y.captions.playerCaptionsTracklistRenderer.captionTracks) ||
    [];
  const videoId =
    (y && y.videoDetails && y.videoDetails.videoId) || new URLSearchParams(location.search).get("v");
  const title =
    (y && y.videoDetails && y.videoDetails.title) ||
    document.title.replace(/\s*-\s*YouTube$/, "").trim();
  return { videoId, captionTracks: tracks, title };
}

// Guard against double-injection (e.g. manifest match + on-demand executeScript).
if (!window.__cjqYtInjected) {
  window.__cjqYtInjected = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return false;
    if (msg.type === "cjq:ping-content") {
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === "extract") {
      try {
        sendResponse(currentVideoMeta());
      } catch (e) {
        sendResponse({ error: String(e) });
      }
      return true;
    }
    if (msg.type === "cjq:fetch") {
      (async () => {
        try {
          const meta = currentVideoMeta();
          const tracks = msg.captionTracks || meta.captionTracks;
          const videoId = msg.videoId || meta.videoId;
          const title = msg.title || meta.title;

          const diag = {
            videoId: videoId || null,
            trackCount: tracks.length,
            trackLangs: tracks.map((t) => t.languageCode),
            paramsFound: false,
            status: null,
            cues: 0,
            baseUrlStatus: null,
            timedtextStatus: null,
            potFound: null,
            baseUrlPotStatus: null,
            domButtonFound: null,
            domViaMenu: null,
            domOpened: null,
            domSegments: null,
            domSource: null,
            parseError: null,
          };

          if (!videoId) {
            sendResponse({ rawTrack: null, error: "Aucun identifiant vidéo trouvé." });
            return;
          }

          let raw = await fetchTranscriptFromPage(diag);
          if (!raw) {
            const ordered = [];
            const preferred = pickTrack(tracks, msg.targetLang);
            if (preferred) ordered.push(preferred);
            for (const t of tracks) if (t !== preferred) ordered.push(t);
            for (const t of ordered) {
              raw = await fetchTranscriptGuessed(videoId, t.languageCode, diag);
              if (raw) break;
            }
          }
          if (!raw) {
            for (const t of tracks) {
              raw = await fetchTrackText(t, videoId, diag);
              if (raw) break;
            }
          }
          if (!raw) {
            console.log("[cjq] API methods failed; scraping transcript panel from DOM…");
            raw = await fetchTranscriptFromDOM(diag);
          }

          if (raw) {
            sendResponse({ rawTrack: raw, title });
            return;
          }

          console.error("[cjq] all methods failed", JSON.stringify(diag));
          // Keep the diagnostic short so the whole message is readable.
          const shortDiag = {};
          for (const k of [
            "videoId",
            "trackCount",
            "trackLangs",
            "paramsFound",
            "status",
            "baseUrlStatus",
            "timedtextStatus",
            "domButtonFound",
            "domButton",
            "domViaMenu",
            "domOpened",
            "domSegments",
            "domSource",
            "parseError",
          ]) {
            if (diag[k] !== null && diag[k] !== undefined && diag[k] !== false) shortDiag[k] = diag[k];
          }
          sendResponse({
            rawTrack: null,
            error: "Échec. diag: " + JSON.stringify(shortDiag),
          });
        } catch (e) {
          sendResponse({ rawTrack: null, error: String(e) });
        }
      })();
      return true;
    }
    return false;
  });
}
