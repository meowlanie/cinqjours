import { NextResponse } from "next/server";
import { extractYouTubeId, groupIntoSentences, type CaptionTrack, type RawLine } from "@/lib/transcript";

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
  ua?: string;
  /** Adds an "api_key" query param (needed by some WEB-family clients). */
  needsKey?: boolean;
}

// ANDROID & TVHTML5_SIMPLY_EMBEDDED_PLAYER first: they are PoToken-exempt and
// read captions reliably in 2025+. From datacenter IPs the ANDROID client can
// answer LOGIN_REQUIRED, in which case visitorData from a first probe call
// usually un-blocks it (see fetchCaptionsInnerTube below).
const CLIENTS: ClientConfig[] = [
  { name: "ANDROID", version: "20.10.38", ua: ANDROID_UA },
  { name: "ANDROID", version: "19.09.37", ua: ANDROID_UA },
  { name: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", version: "2.0", ua: BROWSER_UA },
  { name: "WEB_EMBEDDED_PLAYER", version: "1.20241008.00.00", ua: BROWSER_UA, needsKey: true },
  { name: "IOS", version: "19.09.3", ua: "com.google.ios.youtube/19.09.3 (iPhone16,3; U; CPU iOS 17_5 like Mac OS X)" },
  { name: "ANDROID_MUSIC", version: "6.33.52", ua: "com.google.android.apps.youtube.music/6.33.52 (Linux; U; Android 14; en_US) gzip" },
];

// Public key used by YouTube's own web client; harmless to reuse for
// WEB-family fallback clients.
const INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

async function fetchWithTimeout(url: string, init: RequestInit, ms = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function selectTrack(tracks: CaptionTrack[], preferLang: string | null): CaptionTrack {
  if (preferLang) {
    const preferred = tracks.find(
      (t) => t.languageCode === preferLang || t.languageCode?.startsWith(`${preferLang}-`),
    );
    if (preferred) return preferred;
  }
  return tracks.find((t) => t.kind !== "asr") ?? tracks[0];
}

/** One InnerTube player call for a given client. Returns raw parsed body or null on any error. */
async function callInnerTube(
  videoId: string,
  client: ClientConfig,
  visitorData?: string
): Promise<PlayerResponse | null> {
  const key = client.needsKey ? `&key=${INNERTUBE_API_KEY}` : "";
  const res = await fetchWithTimeout(
    `https://www.youtube.com/youtubei/v1/player?prettyPrint=false${key}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(client.ua ? { "User-Agent": client.ua } : {}),
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: client.name,
            clientVersion: client.version,
            hl: "fr",
            gl: "US",
            ...(visitorData ? { visitorData } : {}),
          },
        },
        videoId,
      }),
    },
    20000
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

/** Fetch one caption track as JSON3, with the ANDROID UA (avoids PoToken empties). */
async function fetchTrackLines(track: CaptionTrack, preferLang: string | null): Promise<RawLine[]> {
  const base = track.baseUrl.replace(/&amp;/g, "&");

  const url = new URL(base);
  url.searchParams.delete("fmt");
  url.searchParams.delete("kind");
  url.searchParams.set("fmt", "json3");

  const res = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        "User-Agent": ANDROID_UA,
        "Accept-Language": preferLang ? `${preferLang},fr;q=0.8,en;q=0.6` : "en;q=0.9",
      },
    },
    15000
  );
  if (!res.ok) throw new Error(`Sous-titres indisponibles (HTTP ${res.status}).`);
  const text = await res.text();
  if (text.trim() === "") throw new Error("Sous-titres vides (restriction PoToken).");

  try {
    const json = JSON.parse(text);
    const events: { tStartMs?: number; segs?: { utf8?: string }[] }[] = json.events ?? [];
    return events
      .filter((e) => Array.isArray(e.segs))
      .map((e) => {
        const captionText = (e.segs || [])
          .map((s) => s.utf8 || "")
          .join("")
          .replace(/\n/g, " ")
          .trim();
        return { text: captionText, offset: e.tStartMs ?? 0, duration: 0 };
      })
      .filter((c) => c.text);
  } catch {
    const xml: RawLine[] = [];
    const re = /<text start="([\d.]+)" dur="([\d.]+)">([\s\S]*?)<\/text>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const body = m[3]
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
      if (body) {
        xml.push({ text: body, offset: Math.round(parseFloat(m[1]) * 1000), duration: Math.round(parseFloat(m[2]) * 1000) });
      }
    }
    if (xml.length === 0) throw new Error("Format de sous-titres non reconnu.");
    return xml;
  }
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

  // Prefer a visitorData minted by the homepage (a plain GET, rarely
  // captcha'd) over one returned by a rejected player call.
  try {
    const res = await fetchWithTimeout(
      "https://www.youtube.com/?hl=fr&gl=US",
      { headers: { "User-Agent": BROWSER_UA } },
      12000
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

  for (const client of CLIENTS) {
    // Attempt 1: bare probe. Even when rejected (LOGIN_REQUIRED), YouTube
    // usually returns a visitorData in responseContext.
    let data = await callInnerTube(videoId, client, capturedVisitorData ?? undefined);
    if (data && data.responseContext?.visitorData) {
      capturedVisitorData = data.responseContext.visitorData;
    }

    // Attempt 2: replay with captured visitorData when we couldn't get
    // caption tracks from the probe.
    if (capturedVisitorData) {
      const replay = await callInnerTube(videoId, client, capturedVisitorData);
      if (replay) data = replay;
    }

    if (!data) {
      debug.push(`${client.name}: network/invalid`);
      continue;
    }

    const status = data.playabilityStatus?.status ?? null;
    const reason = data.playabilityStatus?.reason ?? null;
    const tracks: CaptionTrack[] = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const title = data.videoDetails?.title ?? null;
    debug.push(`${client.name}@${client.version}: status=${status ?? "?"}, tracks=${tracks.length}${title ? ", title=OK" : ""}`);

    if (status && status !== "OK" && !best) best = { status, reason };

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
    return NextResponse.json({ error: "Corps de requête invalide.", build: "v5-android" }, { status: 400 });
  }

  const url = body.url?.trim();
  const videoId = extractYouTubeId(url || "");
  if (!videoId) {
    return NextResponse.json({ error: "Lien YouTube non reconnu.", build: "v5-android" }, { status: 400 });
  }

  // Prefer subtitles in the language the user is learning, falling back to any
  // available language (matches the source-tab copy).
  const preferLang: string | null = body.target?.trim() || null;

  const oembedTitle = await getTitle(url!);
  const notFound = { videoId, transcript: [], title: oembedTitle, count: 0, build: "v5-android" };

  // --- Step 1: InnerTube, primary path — no watch page, no key needed ---
  let result: Awaited<ReturnType<typeof fetchCaptionsInnerTube>>;
  try {
    result = await fetchCaptionsInnerTube(videoId, preferLang);
  } catch {
    return NextResponse.json(
      { ...notFound, error: "Impossible de joindre YouTube depuis le serveur.", build: "v5-android" },
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
      build: "v5-android",
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
          build: "v5-android",
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
        build: "v5-android",
      });
    }
  }

  const blockReason = describeUnplayable(result?.status ?? null, result?.reason ?? null);
  if (blockReason) {
    return NextResponse.json(
      { ...notFound, title: result?.title ?? null, error: blockReason, build: "v5-android", debug },
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
        build: "v5-android",
      });
    } catch (err) {
      return NextResponse.json(
        { ...notFound, error: err instanceof Error ? err.message : "Échec de lecture des sous-titres.", build: "v5-android" },
        { status: 200 }
      );
    }
  }

  return NextResponse.json(
    { ...notFound, error: "Cette vidéo ne possède pas de sous-titres lisibles depuis ce serveur.", build: "v5-android", debug },
    { status: 200 }
  );
}