import { NextRequest, NextResponse } from "next/server";
import { resolveProvider, getToken, getCategory, getLanguage, authHeaders } from "@/lib/dictSync";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const provider = resolveProvider(req);
  const token = getToken(req, provider.id);
  if (!token) return NextResponse.json({ words: [] });
  const category = getCategory(req, provider.id, "0");
  const lang = getLanguage(req, provider.id, provider.language);
  const base = provider.apiBase;
  try {
    const res = await fetch(
      `${base}/api/open/v1/studylist/words?category=${encodeURIComponent(category)}&language=${encodeURIComponent(lang)}`,
      { headers: authHeaders(token), cache: "no-store" }
    );
    if (!res.ok) return NextResponse.json({ words: [] });
    const data = (await res.json()) as { words?: { word?: string; master_status?: number; masterStatus?: number }[] };
    const words = Array.isArray(data.words) ? data.words : [];
    const mastered = words
      .filter((w) => w.master_status === 1 || w.masterStatus === 1)
      .map((w) => String(w.word ?? ""))
      .filter(Boolean);
    return NextResponse.json({ words: mastered });
  } catch {
    return NextResponse.json({ words: [] });
  }
}
