export const YOUTUBE_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

export interface RawLine {
  text: string;
  offset: number;
  duration: number;
}

export interface TranscriptLine {
  t: string;
  text: string;
}

export function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  if (/^[\w-]{11}$/.test(url)) return url;
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function toTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function groupIntoSentences(captions: RawLine[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  let buffer = "";
  let startOffset = captions[0]?.offset ?? 0;
  const END = /[.!?…:»"]\s*$/;

  for (let i = 0; i < captions.length; i++) {
    const item = captions[i];
    if (!buffer) startOffset = item.offset;
    buffer += (buffer ? " " : "") + item.text.trim();

    const next = captions[i + 1];
    const gapBig = next && next.offset - (item.offset + item.duration) > 600;
    if (END.test(buffer) || buffer.split(/\s+/).length >= 24 || gapBig) {
      lines.push({ t: toTimestamp(startOffset), text: buffer.replace(/\[.*?\]/g, "").trim() });
      buffer = "";
    }
  }
  if (buffer.trim()) lines.push({ t: toTimestamp(startOffset), text: buffer.replace(/\[.*?\]/g, "").trim() });

  return lines.filter((l) => l.text.length > 0);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/** Fetch a caption track (JSON3 format preferred, XML fallback). */
export async function fetchTrack(track: CaptionTrack, preferFr: boolean): Promise<RawLine[]> {
  const base = track.baseUrl.replace(/&amp;/g, "&");
  const url = `${base}&fmt=json3`;
  const res = await fetch(url, {
    headers: {
      "Accept-Language": preferFr ? "fr,en;q=0.9" : "en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`Sous-titres indisponibles (HTTP ${res.status}).`);

  const text = await res.text();
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
      const body = decodeEntities(m[3].replace(/<[^>]+>/g, "").trim());
      if (body) {
        xml.push({ text: body, offset: Math.round(parseFloat(m[1]) * 1000), duration: Math.round(parseFloat(m[2]) * 1000) });
      }
    }
    if (xml.length === 0) throw new Error("Format de sous-titres non reconnu.");
    return xml;
  }
}

function selectTrack(tracks: CaptionTrack[], wantFr: boolean): CaptionTrack {
  if (wantFr) {
    const fr = tracks.find((t) => t.languageCode === "fr" || t.languageCode?.startsWith("fr-"));
    if (fr) return fr;
  }
  return tracks.find((t) => t.kind !== "asr") ?? tracks[0];
}

interface PlayerResponse {
  playabilityStatus?: { status?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
  videoDetails?: { title?: string };
}

/**
 * Fetch captions directly from the browser, bypassing any server-side
 * network restrictions (the browser reaches YouTube even when the server
 * cannot). Uses the InnerTube player API, which is CORS-accessible.
 */
export async function fetchTranscriptClient(videoId: string): Promise<{ transcript: TranscriptLine[]; title: string | null; lang: string | null }> {
  const clients = [
    { clientName: "WEB", clientVersion: "2.20240504.01.00" },
    { clientName: "WEB", clientVersion: "1.20231129.00.00" },
    { clientName: "ANDROID", clientVersion: "20.10.38" },
  ];

  let lastError: Error | null = null;

  for (const client of clients) {
    try {
      const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: { client }, videoId }),
      });
      if (!res.ok) {
        lastError = new Error(`InnerTube HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as PlayerResponse;
      const tracks: CaptionTrack[] = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      if (tracks.length === 0) {
        lastError = new Error("Aucun sous-titre listé par InnerTube.");
        continue;
      }
      const track = selectTrack(tracks, true);
      const raw = await fetchTrack(track, true);
      if (raw.length === 0) {
        lastError = new Error("Sous-titres vides.");
        continue;
      }
      return {
        transcript: groupIntoSentences(raw),
        title: data.videoDetails?.title ?? null,
        lang: track.languageCode ?? null,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw new Error(lastError?.message || "Impossible de charger les sous-titres.");
}