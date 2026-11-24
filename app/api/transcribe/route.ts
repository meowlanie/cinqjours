import { NextResponse } from "next/server";
import { ProxyAgent } from "undici";
import { execSync } from "node:child_process";
import { mintPoToken, type PotFetch } from "@/lib/potoken";
import { extractYouTubeId, groupIntoSentences, parseTrackContent, requiresPoToken, selectCaptionTrack, INNERTUBE_ANDROID_KEY, INNERTUBE_IOS_KEY, type CaptionTrack, type RawLine } from "@/lib/transcript";

export const runtime = "nodejs";
export const maxDuration = 60;

const ANDROID_UA =
  "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

interface PlayerResponse {
  playabilityStatus?: {
    status?: string;
    reason?: string;
  };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
  videoDetails?: { title?: string };
  responseContext?: { visitorData?: string };
}

interface ClientConfig {
  name: string;
  version: string;
  ua: string;
  key: string;
}

// Android first: it is PoToken-exempt when called with the public Android key
// and a matching User-Agent. VR/iOS are alternate identities, WEB is last and
// needs a visitorData minted from the homepage.
const CLIENTS: ClientConfig[] = [
  { name: "ANDROID", version: "20.10.38", ua: ANDROID_UA, key: INNERTUBE_ANDROID_KEY },
  { name: "ANDROID_VR", version: "1.60.19", ua: ANDROID_UA, key: INNERTUBE_ANDROID_KEY },
  { name: "IOS", version: "19.45.4", ua: "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)", key: INNERTUBE_IOS_KEY },
  { name: "WEB", version: "2.20241126.01.00", ua: BROWSER_UA, key: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8" },
];

// YouTube is unreachable directly from some networks (e.g. behind the GFW), but
// a local proxy provides access. The browser honors the macOS system proxy;
// Node's fetch does not, so we attach an explicit dispatcher. Resolution order:
// YT_PROXY / HTTPS_PROXY env, then the macOS system proxy. On hosts with neither
// (e.g. Vercel) this is null and requests go direct.
let proxyAgentCache: ProxyAgent | null | undefined;

function systemProxyUrl(): string | null {
  const env =
    process.env.YT_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (env) return env;
  if (process.platform !== "darwin") return null;
  try {
    const out = execSync("scutil --proxy", { encoding: "utf8", timeout: 3000 });
    const field = (k: string): string | null => out.match(new RegExp(`${k}\\s*:\\s*(\\S+)`))?.[1] ?? null;
    for (const [enable, host, port] of [
      ["HTTPSEnable", "HTTPSProxy", "HTTPSPort"],
      ["HTTPEnable", "HTTPProxy", "HTTPPort"],
    ] as const) {
      if (field(enable) === "1") {
        const h = field(host);
        const p = field(port);
        if (h && p) return `http://${h}:${p}`;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function getProxyAgent(): ProxyAgent | null {
  if (proxyAgentCache !== undefined) return proxyAgentCache;
  proxyAgentCache = null;
  const url = systemProxyUrl();
  if (url) {
    try {
      proxyAgentCache = new ProxyAgent(url);
    } catch {
      proxyAgentCache = null;
    }
  }
  return proxyAgentCache;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const agent = getProxyAgent();
  const attempt = (dispatcher: ProxyAgent | null): Promise<Response> => {
    const opts: RequestInit & { dispatcher?: ProxyAgent } = { ...init, signal: controller.signal };
    if (dispatcher) opts.dispatcher = dispatcher;
    return fetch(url, opts);
  };
  try {
    return await attempt(agent);
  } catch (err) {
    // Proxy itself unreachable -> retry direct (but not if we simply timed out).
    const aborted = controller.signal.aborted || (err instanceof Error && err.name === "AbortError");
    if (agent && !aborted) return await attempt(null);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// BotGuard's challenge/attestation calls use the same route to the network as
// the rest of the fetcher (proxy when available, direct otherwise).
const poFetch: PotFetch = (url, init) => fetchWithTimeout(url, init ?? {}, 20000);

/** One InnerTube player call for a given client. Returns raw parsed body or null on any error. */
async function callInnerTube(
  videoId: string,
  client: ClientConfig,
  visitorData?: string
): Promise<PlayerResponse | null> {
  const res = await fetchWithTimeout(
    `https://www.youtube.com/youtubei/v1/player?key=${client.key}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": client.ua,
      },
      body: JSON.stringify({
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
        context: {
          client: {
            clientName: client.name,
            clientVersion: client.version,
            hl: "en",
            gl: "US",
            ...(visitorData ? { visitorData } : {}),
          },
        },
      }),
    },
    15000
  );
  if (!res.ok) return null;
  const text = await res.text();
  if (!text || text.trim() === "") return null;
  try {
    return JSON.parse(text) as PlayerResponse;
  } catch {
    return null;
  }
}

/** Fetch one caption track. srv3 XML first, JSON3 if that body is empty. */
async function fetchTrackLines(track: CaptionTrack, preferLang: string | null, poToken?: string | null): Promise<RawLine[]> {
  const base = track.baseUrl.replace(/&amp;/g, "&");
  const absolute = base.startsWith("//") ? `https:${base}` : base;
  // Keep the signed query string byte-for-byte: URLSearchParams re-encodes
  // commas in `sparams` (%2C), which invalidates YouTube's signature and
  // makes even a valid PoToken return an empty body.
  const raw = absolute.replace(/([?&])fmt=[^&]*&?/g, "$1").replace(/[?&]$/, "");
  const hasPot = /[?&]pot=/.test(raw);
  const hasClient = /[?&]c=/.test(raw);
  const potParams = poToken
    ? `${hasPot ? "" : "&pot=" + encodeURIComponent(poToken)}${hasClient ? "" : "&c=WEB"}`
    : "";

  let lastError: Error | null = null;
  for (const fmt of ["3", "json3"]) {
    const url = `${raw}${potParams}${raw.includes("?") ? "&" : "?"}fmt=${fmt}`;
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          // A PoToken is minted for the WEB client; using the Android UA here
          // makes YouTube reject it as a mismatched identity.
          "User-Agent": poToken ? BROWSER_UA : ANDROID_UA,
          "Accept-Language": preferLang ? `${preferLang},en;q=0.8` : "en;q=0.9",
        },
      },
      15000
    );
    if (!res.ok) {
      lastError = new Error(`Sous-titres indisponibles (HTTP ${res.status}).`);
      continue;
    }
    try {
      const lines = parseTrackContent(await res.text());
      if (lines.length > 0) return lines;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error("Sous-titres vides.");
}

/** Try clients in order; return the first that yields caption tracks. */
async function fetchCaptionsInnerTube(videoId: string, preferLang: string | null): Promise<{
  lines: RawLine[];
  lang: string | null;
  title: string | null;
  status: string | null;
  reason: string | null;
  debug: string[];
} | null> {
  const debug: string[] = [];
  let capturedVisitorData: string | null = null;
  let best: { status: string | null; reason: string | null } | null = null;

  for (const client of CLIENTS) {
    // WEB is the identity YouTube bot-checks. Only try it after the app
    // clients fail, and only with a visitorData from the homepage.
    if (client.name === "WEB" && !capturedVisitorData) {
      try {
        const res = await fetchWithTimeout(
          "https://www.youtube.com/?hl=en&gl=US",
          { headers: { "User-Agent": BROWSER_UA } },
          8000
        );
        const html = await res.text();
        const m = html.match(/"VISITOR_DATA":"([^"]+)"/);
        if (m?.[1]) {
          capturedVisitorData = m[1].replace(/\\u0026/g, "&");
          debug.push(`homepage visitorData OK (${capturedVisitorData.slice(0, 12)}…)`);
        }
      } catch {
        debug.push("homepage visitorData failed");
      }
    }

    const data = await callInnerTube(
      videoId,
      client,
      client.name === "WEB" ? capturedVisitorData ?? undefined : undefined
    );

    if (!data) {
      debug.push(`${client.name}: network/invalid`);
      continue;
    }
    if (data.responseContext?.visitorData) {
      capturedVisitorData = data.responseContext.visitorData;
    }

    const status = data.playabilityStatus?.status ?? null;
    const reason = data.playabilityStatus?.reason ?? null;
    const tracks: CaptionTrack[] = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const title = data.videoDetails?.title ?? null;
    debug.push(`${client.name}@${client.version}: status=${status ?? "?"}, tracks=${tracks.length}${title ? ", title=OK" : ""}`);

    if (status && status !== "OK" && !best) best = { status, reason };
    // Age gates are properties of the video, not the client. Stop retrying.
    if (status === "AGE_VERIFICATION_REQUIRED" || status === "AGE_CHECK_REQUIRED") break;

    if (tracks.length > 0) {
      try {
        const track = selectCaptionTrack(tracks, preferLang);
        const lines = await fetchTrackLines(track, preferLang);
        if (lines.length > 0) {
          return { lines, lang: track.languageCode ?? null, title, status, reason, debug };
        }
      } catch (err) {
        debug.push(`${client.name}: track fetch failed (${err instanceof Error ? err.message : err})`);
      }
    }
  }

  return { lines: [], lang: null, title: null, status: best?.status ?? null, reason: best?.reason ?? null, debug };
}

/**
 * YouTube's watch page bot-check is sensitive to visitor cookies. Pick up the
 * anonymous visitor cookies from the homepage and reuse them on every page
 * variant below (a datacenter has no cookie jar of its own).
 */
async function harvestYouTubeCookies(): Promise<string> {
  try {
    const res = await fetchWithTimeout(
      "https://www.youtube.com/?hl=en&gl=US",
      { headers: { "User-Agent": BROWSER_UA } },
      8000
    );
    const headers = res.headers as Headers & { getSetCookie?: () => string[] };
    const raw = headers.getSetCookie?.() ?? (headers.get("set-cookie") ? [headers.get("set-cookie")!] : []);
    const keep = new Set(["VISITOR_INFO1_LIVE", "VISITOR_PRIVACY_METADATA", "YSC", "PREF", "CONSENT", "SOCS"]);
    const pairs: string[] = [];
    for (const line of raw) {
      const pair = line.split(";")[0]?.trim();
      const name = pair?.split("=")[0]?.trim();
      if (pair && name && keep.has(name)) pairs.push(pair);
    }
    return pairs.join("; ");
  } catch {
    return "";
  }
}

/** Extract a JSON object starting at `{`, ignoring braces inside strings. */
function extractJsonObject(text: string, start: number): string | null {
  if (text[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parsePlayerResponse(html: string): PlayerResponse | null {
  for (const token of ["ytInitialPlayerResponse = ", '"ytInitialPlayerResponse":']) {
    const index = html.indexOf(token);
    if (index === -1) continue;
    const raw = extractJsonObject(html, index + token.length);
    if (!raw) continue;
    try {
      return JSON.parse(raw) as PlayerResponse;
    } catch {
      /* try the next spelling */
    }
  }
  return null;
}

/**
 * Watch-page path: the embedded player response often has caption tracks even
 * when InnerTube reports LOGIN_REQUIRED from a datacenter. Gated (`exp=xpe`)
 * tracks need a PoToken — and both `pot` and `c=WEB` on the caption request.
 */
async function fetchViaWatchPage(
  videoId: string,
  preferLang: string | null,
  debug: string[] = []
): Promise<{ lines: RawLine[]; lang: string | null; title: string | null } | null> {
  const visitorCookies = await harvestYouTubeCookies();
  const baseCookie = [visitorCookies, "CONSENT=YES+cb", "SOCS=CAI"].filter(Boolean).join("; ");
  const pages: { name: string; url: string; ua: string; cookie: string }[] = [
    {
      name: "desktop",
      url: `https://www.youtube.com/watch?v=${videoId}`,
      ua: BROWSER_UA,
      cookie: baseCookie,
    },
    {
      name: "desktop-alt",
      url: `https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US&bpctr=9999999999&has_verified=1`,
      ua: BROWSER_UA,
      cookie: `${baseCookie}; PREF=hl=en&gl=US`,
    },
    {
      name: "mobile",
      url: `https://m.youtube.com/watch?v=${videoId}`,
      ua: MOBILE_UA,
      cookie: baseCookie,
    },
    {
      name: "mobile-alt",
      url: `https://m.youtube.com/watch?v=${videoId}&hl=en&gl=US`,
      ua: MOBILE_UA,
      cookie: `${baseCookie}; PREF=hl=en&gl=US`,
    },
  ];

  let withTracks: PlayerResponse | null = null;
  let first: PlayerResponse | null = null;
  for (const page of pages) {
    let html: string;
    try {
      const res = await fetchWithTimeout(
        page.url,
        {
          headers: {
            "User-Agent": page.ua,
            "Accept-Language": "en-US,en;q=0.9",
            Cookie: page.cookie,
          },
        },
        20000
      );
      if (!res.ok) {
        debug.push(`watch ${page.name}: HTTP ${res.status}`);
        continue;
      }
      html = await res.text();
    } catch (err) {
      debug.push(`watch ${page.name}: network error (${err instanceof Error ? err.message : err})`);
      continue;
    }
    const parsed = parsePlayerResponse(html);
    const count = parsed?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length ?? 0;
    debug.push(
      `watch ${page.name}: bytes=${html.length}, status=${parsed?.playabilityStatus?.status ?? "none"}, tracks=${count}` +
        (parsed?.playabilityStatus?.reason ? `, reason=${parsed.playabilityStatus.reason}` : "")
    );
    first ??= parsed;
    if (count > 0) {
      withTracks = parsed;
      break;
    }
  }

  const parsed = withTracks ?? first;
  const tracks = parsed?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const title = parsed?.videoDetails?.title ?? null;
  debug.push(`watch page: tracks=${tracks.length}${title ? ", title=OK" : ""}`);
  if (tracks.length === 0) return null;

  const gatedUrl = (t: CaptionTrack) => requiresPoToken(t.baseUrl.replace(/&amp;/g, "&"));
  const ungated = tracks.filter((t) => !gatedUrl(t));
  const pool = ungated.length > 0 ? ungated : tracks;
  const track = selectCaptionTrack(pool, preferLang);
  const gated = gatedUrl(track);
  debug.push(`watch page: selected ${track.languageCode ?? "?"}, gated=${gated}`);

  // Retry once with a PoToken even when the exp flag looks ungated: YouTube has
  // gating variants that the flag check can miss (and tokens can expire mid-flight).
  for (let attempt = 0; attempt < 2; attempt++) {
    const useToken = gated || attempt === 1;
    let poToken: string | null = null;
    if (useToken) {
      try {
        poToken = await mintPoToken(videoId, poFetch, gated && attempt > 0);
        debug.push(`potoken: minted (attempt ${attempt + 1}, gated=${gated})`);
      } catch (err) {
        debug.push(`potoken: failed (${err instanceof Error ? err.message : err})`);
        continue;
      }
    }
    try {
      const lines = await fetchTrackLines(track, preferLang, poToken);
      if (lines.length > 0) {
        debug.push(`watch page: ${lines.length} lines (attempt ${attempt + 1})`);
        return { lines, lang: track.languageCode ?? null, title };
      }
      debug.push(`watch page: empty body (attempt ${attempt + 1})`);
    } catch (err) {
      debug.push(`watch page: caption fetch failed (${err instanceof Error ? err.message : err})`);
    }
  }
  return null;
}

/**
 * Legacy lenient path: `get_video_info` returns the same playerResponse as a
 * plain GET, and is historically far less bot-guarded than the InnerTube POST
 * API. Good fallback when InnerTube answers LOGIN_REQUIRED from a datacenter.
 */
async function fetchViaGetVideoInfo(videoId: string, preferLang: string | null): Promise<{
  lines: RawLine[];
  lang: string | null;
  title: string | null;
} | null> {
  const res = await fetchWithTimeout(
    `https://www.youtube.com/get_video_info?video_id=${videoId}&el=detailpage&hl=fr&gl=US`,
    { headers: { "User-Agent": BROWSER_UA, "Accept-Language": "fr,en;q=0.9" } },
    15000
  );
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.includes("player_response")) return null;

  const params = new URLSearchParams(text);
  const raw = params.get("player_response");
  if (!raw) return null;

  let data: PlayerResponse;
  try {
    data = JSON.parse(raw) as PlayerResponse;
  } catch {
    return null;
  }

  const status = data.playabilityStatus?.status;
  if (status && status !== "OK") return null;

  const tracks: CaptionTrack[] = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (tracks.length === 0) return null;

  const track = selectCaptionTrack(tracks, preferLang);
  const lines = await fetchTrackLines(track, preferLang);
  if (lines.length === 0) return null;

  return { lines, lang: track.languageCode ?? null, title: data.videoDetails?.title ?? null };
}

/**
 * Legacy timedtext API: fetches captions directly by language code with a
 * plain GET — no InnerTube, no auth, no PoToken. Still works for many videos
 * even when the player API is bot-blocked.
 */
async function fetchViaTimedText(videoId: string, debug: string[] = [], preferLang: string | null = null): Promise<{
  lines: RawLine[];
  lang: string | null;
} | null> {
  const candidates: { lang: string; label: string }[] = [
    ...(preferLang ? [{ lang: preferLang, label: "custom" }, { lang: preferLang, label: "asr" }] : []),
    { lang: "fr", label: "custom" },
    { lang: "fr", label: "asr" },
    { lang: "en", label: "custom" },
    { lang: "en", label: "asr" },
  ];

  for (const c of candidates) {
    const url = `https://www.youtube.com/api/timedtext?lang=${c.lang}&v=${videoId}&fmt=json3`;
    try {
      const res = await fetchWithTimeout(
        url,
        { headers: { "User-Agent": BROWSER_UA, "Accept-Language": "fr,en;q=0.9" } },
        10000
      );
      if (!res.ok) {
        debug.push(`timedtext(${c.label}): HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (!text.includes("events")) {
        debug.push(`timedtext(${c.label}): no events`);
        continue;
      }
      const json = JSON.parse(text);
      const events: { tStartMs?: number; segs?: { utf8?: string }[] }[] = json.events ?? [];
      const lines: RawLine[] = events
        .filter((e) => Array.isArray(e.segs))
        .map((e) => ({
          text: (e.segs || []).map((s) => s.utf8 || "").join("").replace(/\n/g, " ").trim(),
          offset: e.tStartMs ?? 0,
          duration: 0,
        }))
        .filter((c) => c.text);
      if (lines.length > 0) {
        debug.push(`timedtext(${c.label}): ${lines.length} lines`);
        return { lines, lang: c.lang };
      }
      debug.push(`timedtext(${c.label}): empty`);
    } catch {
      debug.push(`timedtext(${c.label}): network error`);
    }
  }
  return null;
}

function describeUnplayable(status: string | null, _reason: string | null, hasTitle = false): string | null {
  if (!status || status === "OK") return null;
  if (status === "LOGIN_REQUIRED") {
    // A title from oEmbed/player means the video is public: LOGIN_REQUIRED is a
    // block on this server's IP, not a private video.
    return hasTitle
      ? "Impossible de récupérer les sous-titres de cette vidéo depuis le serveur. Réessayez ou utilisez l'extension navigateur."
      : "Impossible de vérifier l'accès à cette vidéo depuis le serveur.";
  }
  if (status === "AGE_VERIFICATION_REQUIRED" || status === "AGE_CHECK_REQUIRED")
    return "Vidéo réservée aux adultes (age-restricted).";
  // YouTube's raw reason is often English and can be misleading; never echo it.
  return "Cette vidéo n'est pas lisible depuis le serveur.";
}

async function getTitle(oembedUrl: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(oembedUrl)}&format=json`,
      {},
      8000
    );
    if (res.ok) {
      const data = await res.json();
      return data.title || null;
    }
  } catch {
    // ignore
  }
  // Fallback: scrape <title> from the watch page
  try {
    const id = extractYouTubeId(oembedUrl);
    if (!id) return null;
    const res = await fetchWithTimeout(
      `https://www.youtube.com/watch?v=${id}`,
      { headers: { "User-Agent": BROWSER_UA, "Accept-Language": "fr,en;q=0.9" } },
      8000
    );
    if (res.ok) {
      const html = await res.text();
      const m = html.match(/<title>(.*?)<\/title>/);
      if (m?.[1]) {
        const raw = m[1].replace(/ - YouTube$/, "").trim();
        return raw || null;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export async function POST(req: Request) {
  let body: { url?: string; target?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const url = body.url?.trim();
  const videoId = extractYouTubeId(url || "");
  if (!videoId) {
    return NextResponse.json({ error: "Lien YouTube non reconnu." }, { status: 400 });
  }

  // Prefer subtitles in the language the user is learning, falling back to any
  // available language (matches the source-tab copy).
  const preferLang: string | null = body.target?.trim() || null;

  const oembedTitle = await getTitle(url!);
  const notFound = { videoId, transcript: [], title: oembedTitle, count: 0 };

  // --- Step 1: InnerTube, primary path — no watch page, no key needed ---
  const debug: string[] = [];
  let result: Awaited<ReturnType<typeof fetchCaptionsInnerTube>> | null = null;
  try {
    result = await fetchCaptionsInnerTube(videoId, preferLang);
  } catch (err) {
    debug.push(`innertube: failed (${err instanceof Error ? err.message : err})`);
  }

  if (result && result.lines.length > 0) {
    const transcript = groupIntoSentences(result.lines);
    const title = result.title || (await getTitle(url!));
    return NextResponse.json({
      videoId,
      title: title ?? null,
      transcript,
      sourceLanguage: result.lang,
      count: transcript.length,
      error: null,
    });
  }

  debug.push(...(result?.debug ?? []));

  // --- Step 1.5: watch page + PoToken (works from datacenter IPs) ---
  if (!result || result.lines.length === 0) {
    const page = await fetchViaWatchPage(videoId, preferLang, debug);
    if (page && page.lines.length > 0) {
      const transcript = groupIntoSentences(page.lines);
      return NextResponse.json({
        videoId,
        title: page.title || (await getTitle(url!)),
        transcript,
        sourceLanguage: page.lang,
        count: transcript.length,
        error: null,
      });
    }
  }

  // --- Step 2: legacy get_video_info (lenient with datacenter IPs) ---
  if (!result || result.lines.length === 0) {
    try {
      const alt = await fetchViaGetVideoInfo(videoId, preferLang);
      if (alt && alt.lines.length > 0) {
        const transcript = groupIntoSentences(alt.lines);
        const title = alt.title || (await getTitle(url!));
        return NextResponse.json({
          videoId,
          title: title ?? null,
          transcript,
          sourceLanguage: alt.lang,
          count: transcript.length,
          error: null,
        });
      } else {
        debug.push("get_video_info: no usable player_response");
      }
    } catch (err) {
      debug.push(`get_video_info: error (${err instanceof Error ? err.message : err})`);
    }
  }

  // --- Step 3: legacy timedtext API (direct caption GET, no auth) ---
  if (!result || result.lines.length === 0) {
    const tt = await fetchViaTimedText(videoId, debug, preferLang);
    if (tt && tt.lines.length > 0) {
      const transcript = groupIntoSentences(tt.lines);
      const title = await getTitle(url!);
      return NextResponse.json({
        videoId,
        title: title ?? null,
        transcript,
        sourceLanguage: tt.lang,
        count: transcript.length,
        error: null,
      });
    }
  }

  const hasPublicTitle = Boolean(oembedTitle || result?.title);
  // A public video with LOGIN_REQUIRED means this server's IP was blocked, not
  // that the video is private. The client uses this flag to suggest the extension.
  const serverBlocked = result?.status === "LOGIN_REQUIRED" && hasPublicTitle;
  const blockReason = describeUnplayable(result?.status ?? null, result?.reason ?? null, hasPublicTitle);
  // Only an age gate is a hard stop; the watch page and legacy paths were tried above.
  const ageBlocked = result?.status === "AGE_VERIFICATION_REQUIRED" || result?.status === "AGE_CHECK_REQUIRED";
  if (ageBlocked && blockReason) {
    return NextResponse.json(
      { ...notFound, title: result?.title ?? null, error: blockReason, blocked: serverBlocked },
      { status: 200 }
    );
  }

  // The PoToken-aware watch-page path above supersedes the old Step 4.
  return NextResponse.json(
    {
      ...notFound,
      error: blockReason || "Cette vidéo ne possède pas de sous-titres lisibles depuis ce serveur.",
      blocked: serverBlocked,
    },
    { status: 200 }
  );
}

/**
 * PoToken minting for the browser extension. The extension fetches captions
 * from the user's own browser (residential IP + signed-in cookies), but gated
 * tracks still need a Web PoToken. Minting needs no watch page, so this works
 * from the server even when caption fetches from this server fail.
 */
export async function GET(req: Request) {
  const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  const videoId = new URL(req.url).searchParams.get("videoId")?.trim() || "";
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json({ error: "Lien YouTube non reconnu." }, { status: 400, headers: cors });
  }
  try {
    const pot = await mintPoToken(videoId, poFetch);
    return NextResponse.json({ pot }, { headers: cors });
  } catch (err) {
    console.error("[transcribe] PoToken mint failed", err);
    return NextResponse.json({ error: "PoToken indisponible." }, { status: 503, headers: cors });
  }
}
