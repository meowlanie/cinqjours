import { NextResponse } from "next/server";
import { ProxyAgent } from "undici";
import { execSync } from "node:child_process";
import { extractYouTubeId, groupIntoSentences, parseTrackContent, selectCaptionTrack, INNERTUBE_ANDROID_KEY, INNERTUBE_IOS_KEY, type CaptionTrack, type RawLine } from "@/lib/transcript";

export const runtime = "nodejs";
export const maxDuration = 60;

const ANDROID_UA =
  "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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
// and a matching User-Agent. iOS is the next identity. WEB is last and needs
// a visitorData minted from the homepage.
const CLIENTS: ClientConfig[] = [
  { name: "ANDROID", version: "20.10.38", ua: ANDROID_UA, key: INNERTUBE_ANDROID_KEY },
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

function selectTrack(tracks: CaptionTrack[], preferLang: string | null): CaptionTrack {
  return selectCaptionTrack(tracks, preferLang);
}

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
async function fetchTrackLines(track: CaptionTrack, preferLang: string | null): Promise<RawLine[]> {
  const base = track.baseUrl.replace(/&amp;/g, "&");
  const absolute = base.startsWith("//") ? `https:${base}` : base;
  const url = new URL(absolute);
  url.searchParams.delete("fmt");
  url.searchParams.delete("kind");

  let lastError: Error | null = null;
  for (const fmt of ["3", "json3"]) {
    url.searchParams.set("fmt", fmt);
    const res = await fetchWithTimeout(
      url.toString(),
      {
        headers: {
          "User-Agent": ANDROID_UA,
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
        const track = selectTrack(tracks, preferLang);
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

  const track = selectTrack(tracks, preferLang);
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

function describeUnplayable(status: string | null, reason: string | null): string | null {
  if (!status || status === "OK") return null;
  if (status === "LOGIN_REQUIRED") return "Vidéo privée ou nécessite une connexion YouTube.";
  if (status === "AGE_VERIFICATION_REQUIRED" || status === "AGE_CHECK_REQUIRED")
    return "Vidéo réservée aux adultes (age-restricted).";
  if (status === "UNPLAYABLE" && reason) return reason;
  return `Vidéo non lisible depuis ce serveur (${status}).`;
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
    return NextResponse.json({ error: "Corps de requête invalide.", build: "v6-android-key" }, { status: 400 });
  }

  const url = body.url?.trim();
  const videoId = extractYouTubeId(url || "");
  if (!videoId) {
    return NextResponse.json({ error: "Lien YouTube non reconnu.", build: "v6-android-key" }, { status: 400 });
  }

  // Prefer subtitles in the language the user is learning, falling back to any
  // available language (matches the source-tab copy).
  const preferLang: string | null = body.target?.trim() || null;

  const oembedTitle = await getTitle(url!);
  const notFound = { videoId, transcript: [], title: oembedTitle, count: 0, build: "v6-android-key" };

  // --- Step 1: InnerTube, primary path — no watch page, no key needed ---
  let result: Awaited<ReturnType<typeof fetchCaptionsInnerTube>>;
  try {
    result = await fetchCaptionsInnerTube(videoId, preferLang);
  } catch {
    return NextResponse.json(
      { ...notFound, error: "Impossible de joindre YouTube depuis le serveur.", build: "v6-android-key" },
      { status: 200 }
    );
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
      build: "v6-android-key",
    });
  }

  // --- Step 2: legacy get_video_info (lenient with datacenter IPs) ---
  const debug = [...(result?.debug ?? [])];
  if (result && result.lines.length === 0) {
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
          build: "v6-android-key",
        });
      } else {
        debug.push("get_video_info: no usable player_response");
      }
    } catch (err) {
      debug.push(`get_video_info: error (${err instanceof Error ? err.message : err})`);
    }
  }

  // --- Step 3: legacy timedtext API (direct caption GET, no auth) ---
  if (result && result.lines.length === 0) {
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
        build: "v6-android-key",
      });
    }
  }

  const blockReason = describeUnplayable(result?.status ?? null, result?.reason ?? null);
  // LOGIN_REQUIRED from a datacenter is often a client block, not a private video.
  // Only an age gate is a hard stop; everything else still tries the watch page.
  const ageBlocked = result?.status === "AGE_VERIFICATION_REQUIRED" || result?.status === "AGE_CHECK_REQUIRED";
  if (ageBlocked && blockReason) {
    return NextResponse.json(
      { ...notFound, title: result?.title ?? null, error: blockReason, build: "v6-android-key", debug },
      { status: 200 }
    );
  }

  // --- Step 4 (fallback): caption tracks embedded in the watch page ---
  let pageTracks: CaptionTrack[] = [];
  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/watch?v=${videoId}`,
      { headers: { "User-Agent": BROWSER_UA, "Accept-Language": "fr,en-US;q=0.9,en;q=0.8" } },
      20000
    );
    const html = await res.text();
    const startToken = "ytInitialPlayerResponse = ";
    const startIndex = html.indexOf(startToken);
    if (startIndex !== -1) {
      const jsonStart = startIndex + startToken.length;
      let depth = 0;
      for (let i = jsonStart; i < html.length; i++) {
        if (html[i] === "{") depth++;
        else if (html[i] === "}") {
          depth--;
          if (depth === 0) {
            try {
              const parsed = JSON.parse(html.slice(jsonStart, i + 1)) as PlayerResponse;
              pageTracks = parsed?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
            } catch {
              // ignore
            }
            break;
          }
        }
      }
    }
  } catch {
    // fall through; InnerTube already failed — nothing more we can do
  }

  if (pageTracks.length > 0) {
    try {
      const track = selectTrack(pageTracks, preferLang);
      const lines = await fetchTrackLines(track, preferLang);
      const transcript = groupIntoSentences(lines);
      const title = await getTitle(url!);
      return NextResponse.json({
        videoId,
        title: title ?? null,
        transcript,
        sourceLanguage: track.languageCode ?? null,
        count: transcript.length,
        error: null,
        build: "v6-android-key",
      });
    } catch (err) {
      return NextResponse.json(
        { ...notFound, error: err instanceof Error ? err.message : "Échec de lecture des sous-titres.", build: "v6-android-key" },
        { status: 200 }
      );
    }
  }

  return NextResponse.json(
    { ...notFound, error: blockReason || "Cette vidéo ne possède pas de sous-titres lisibles depuis ce serveur.", build: "v6-android-key", debug },
    { status: 200 }
  );
}