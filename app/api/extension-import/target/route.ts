import { NextResponse } from "next/server";

export const runtime = "nodejs";

let currentTargetLang: string | null = null;

function isLocal(req: Request): boolean {
  try {
    const h = new URL(req.url).hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return true;
  } catch {
    /* ignore */
  }
  const host = req.headers.get("host") || "";
  return host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]");
}

export async function POST(req: Request) {
  if (!isLocal(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: { targetLang?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (body.targetLang) currentTargetLang = body.targetLang;
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ targetLang: currentTargetLang });
}
