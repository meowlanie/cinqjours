import { NextRequest, NextResponse } from "next/server";
import { resolveProvider, getToken, getMode, authHeaders, setProviderCookies, clearProviderCookies } from "@/lib/dictSync";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const provider = resolveProvider(req);
  const token = getToken(req, provider.id);
  if (!token) return NextResponse.json({ connected: false });
  return NextResponse.json({ connected: true, mode: getMode(req, provider.id), provider: provider.id });
}

export async function POST(req: NextRequest) {
  const provider = resolveProvider(req);
  let body: { token?: string; mode?: string; language?: string; category?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }
  const token = String(body.token ?? "").trim();
  const mode = body.mode === "two-way" ? "two-way" : "push";
  const language = String(body.language ?? provider.language).trim() || provider.language;
  const category = String(body.category ?? "0").trim() || "0";
  if (!token) return NextResponse.json({ error: "令牌不能为空。" }, { status: 400 });
  const base = provider.apiBase;
  try {
    const check = await fetch(`${base}/api/open/v1/studylist/category?language=${encodeURIComponent(language)}`, {
      headers: authHeaders(token),
      cache: "no-store",
    });
    if (check.status === 401) return NextResponse.json({ error: "令牌无效或已过期。" }, { status: 401 });
    if (!check.ok) return NextResponse.json({ error: `授权失败（${check.status}）。` }, { status: check.status });

    const res = NextResponse.json({ ok: true, mode, provider: provider.id });
    setProviderCookies(res, provider, token, language, mode, category);
    return res;
  } catch {
    return NextResponse.json({ error: "无法连接服务器，请稍后重试。" }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const provider = resolveProvider(req);
  const res = NextResponse.json({ ok: true });
  clearProviderCookies(res, provider);
  return res;
}
