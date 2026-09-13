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

const SENTENCE_END_PASTE = /[.!?…:»"」。！？」』]\s*$/;
const TS_SAME_LINE = /^(?:\[|\()?(\d{1,2}:\d{2}(?::\d{2})?)(?:\]|\))?\s+(\S.*)$/;
const TS_ONLY = /^(?:\[|\()?(\d{1,2}:\d{2}(?::\d{2})?)(?:\]|\))?$/;

function splitLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

function isTimestamped(lines: string[]): boolean {
  if (lines.length === 0) return false;
  const withTs = lines.filter((l) => TS_SAME_LINE.test(l) || TS_ONLY.test(l)).length;
  return withTs / lines.length >= 0.5;
}

function parseTimestamped(lines: string[]): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  let pendingTs: string | null = null;
  for (const raw of lines) {
    const same = raw.match(TS_SAME_LINE);
    if (same) {
      out.push({ t: same[1], text: same[2].trim() });
      pendingTs = null;
      continue;
    }
    const only = raw.match(TS_ONLY);
    if (only) {
      pendingTs = only[1];
      continue;
    }
    if (pendingTs) {
      out.push({ t: pendingTs, text: raw });
      pendingTs = null;
    } else {
      out.push({ t: "", text: raw });
    }
  }
  return out.filter((s) => s.text);
}

function parsePlainSentences(lines: string[]): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  let buffer = "";
  for (const raw of lines) {
    if (!buffer) {
      buffer = raw;
    } else {
      buffer += " " + raw;
    }
    if (SENTENCE_END_PASTE.test(buffer) || buffer.split(/\s+/).length >= 30) {
      out.push({ t: "", text: buffer.trim() });
      buffer = "";
    }
  }
  if (buffer.trim()) out.push({ t: "", text: buffer.trim() });
  return out.filter((s) => s.text);
}

/** Parse a SubRip (.srt) or WebVTT (.vtt) block pasted by the user. */
function parseSubrip(text: string): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  const timeRe = /(\d{1,2}:\d{2}:\d{2})[.,]\d{0,3}\s*-->/;
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const cue = lines.findIndex((l) => l.includes("-->"));
    if (cue === -1) continue;
    const m = lines[cue].match(timeRe);
    if (!m) continue;
    const cueText = lines.slice(cue + 1).join(" ").trim();
    if (cueText) {
      const ts = m[1].replace(/^0+:(\d{1,2}:\d{2})$/, "$1");
      out.push({ t: ts, text: cueText });
    }
  }
  return out;
}

const YT_COPY_MARKER = /(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:(\d+)\s*minute[s]?\s*,\s*)?(\d+)\s*second[s]?/gi;

/** True when the text contains ≥2 inline `mm:ss<duration> seconds` markers. */
function hasYouTubeTimestampedCopy(text: string): boolean {
  YT_COPY_MARKER.lastIndex = 0;
  let count = 0;
  while (YT_COPY_MARKER.exec(text)) {
    if (++count >= 2) return true;
  }
  return false;
}

/**
 * YouTube transcript copies glue each caption to an inline marker like
 * `0:000 seconds` or `1:031 minute, 3 seconds` (mm:ss + duration + the word
 * "seconds"), with no separator between captions. Split at each marker and
 * discard the marker debris; each caption keeps its own timestamp.
 */
function parseYouTubeTimestampedCopy(text: string): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  YT_COPY_MARKER.lastIndex = 0;
  let m: RegExpExecArray | null;
  let prev: { ts: string } | null = null;
  let lastIndex = 0;
  while ((m = YT_COPY_MARKER.exec(text)) !== null) {
    const caption = text.slice(lastIndex, m.index).trim();
    if (caption) {
      if (prev) {
        out.push({ t: prev.ts, text: caption.replace(/\s+/g, " ") });
      } else {
        // Leading text before the first duration marker may carry a bare
        // `m:ss` timestamp (a caption that lost its duration phrase).
        const lead = caption.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(\S[\s\S]*)$/);
        if (lead) out.push({ t: lead[1], text: lead[2].replace(/\s+/g, " ").trim() });
      }
    }
    prev = { ts: m[1] };
    lastIndex = YT_COPY_MARKER.lastIndex;
  }
  const tail = text.slice(lastIndex).trim();
  if (tail && prev) out.push({ t: prev.ts, text: tail.replace(/\s+/g, " ") });
  return out.filter((l) => l.text);
}

/**
 * Parse transcript text the user pastes into the app. Auto-detects the format:
 * - raw caption dumps (JSON3 or XML)
 * - SRT / VTT cue blocks
 * - timestamped plain lines (m:ss or h:mm:ss, optional brackets, same line or next)
 * - plain text, grouped into sentences
 * Unknown input degrades to sentence grouping; empty input yields [].
 */
export function parsePastedText(raw: string): TranscriptLine[] {
  const input = raw.replace(/\r\n/g, "\n").trim();
  if (!input) return [];

  if (input.startsWith("{") || input.includes("<text") || input.includes("<transcript")) {
    try {
      const parsed = groupIntoSentences(parseTrackContent(input));
      if (parsed.length > 0) return parsed;
    } catch {
      // fall through to the line-based heuristics
    }
  }

  if (input.includes("-->")) {
    const sr = parseSubrip(input);
    if (sr.length > 0) return sr;
  }

  if (hasYouTubeTimestampedCopy(input)) {
    return parseYouTubeTimestampedCopy(input);
  }

  const lines = splitLines(input);
  if (lines.length === 0) return [];
  return isTimestamped(lines) ? parseTimestamped(lines) : parsePlainSentences(lines);
}

/** Parse a raw caption track body (JSON3 preferred, XML fallback) into lines. */
export function parseTrackContent(text: string): RawLine[] {
  if (!text || text.trim() === "") throw new Error("Sous-titres vides (restriction PoToken).");
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
  return parseTrackContent(text);
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