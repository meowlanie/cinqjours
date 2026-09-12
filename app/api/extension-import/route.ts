import { NextResponse } from "next/server";
import { groupIntoSentences, parseTrackContent, type RawLine } from "@/lib/transcript";

export const runtime = "nodejs";
export const maxDuration = 30;

interface Pending {
  transcript: { t: string; text: string }[];
  title: string | null;
  lang: string | null;
}

const pending = new Map<string, Pending>();

function isLocal(req: Request): boolean {
  try {
    const h = new URL(req.url).hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return true;
  } catch {
    /* ignore */
  }
  const host = req.headers.get("host") || "";
  return (
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]")
  );
}

export async function POST(req: Request) {
  if (!isLocal(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const token = process.env.CJQ_EXT_TOKEN;
  if (token && req.headers.get("x-cjq-token") !== token) {
    return NextResponse.json({ error: "invalid token" }, { status: 403 });
  }

  let body: { videoId?: string; rawTrack?: string; title?: string | null; lang?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { videoId, rawTrack, title, lang } = body;
  if (!videoId || !rawTrack) {
    return NextResponse.json({ error: "videoId and rawTrack required" }, { status: 400 });
  }

  let lines: RawLine[];
  try {
    lines = parseTrackContent(rawTrack);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "parse failed" },
      { status: 400 }
    );
  }
  if (lines.length === 0) {
    return NextResponse.json({ error: "empty transcript" }, { status: 400 });
  }

  const transcript = groupIntoSentences(lines);
  pending.set(videoId, { transcript, title: title ?? null, lang: lang ?? null });
  return NextResponse.json({ ok: true, count: transcript.length });
}

export async function GET(req: Request) {
  const videoId = new URL(req.url).searchParams.get("videoId");
  if (!videoId) return NextResponse.json({ error: "videoId required" }, { status: 400 });
  const p = pending.get(videoId);
  if (!p) return NextResponse.json({ found: false });
  pending.delete(videoId);
  return NextResponse.json({
    found: true,
    transcript: p.transcript,
    title: p.title,
    lang: p.lang,
  });
}
