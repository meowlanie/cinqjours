import { NextRequest, NextResponse } from "next/server";
import {
  resolveProvider,
  getToken,
  getCategory,
  getLanguage,
  authHeaders,
  cleanExp,
} from "@/lib/dictSync";

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
    if (res.status === 401) return NextResponse.json({ error: "Token invalide ou expiré." }, { status: 401 });
    if (!res.ok) return NextResponse.json({ error: `Erreur API (${res.status}).` }, { status: res.status });
    const data = (await res.json()) as { words?: { word?: string }[] };
    const words = Array.isArray(data.words) ? data.words : [];
    const withExp = await Promise.all(
      words.map(async (w) => {
        const word = String(w.word ?? "");
        const expRes = await fetch(
          `${base}/api/open/v1/studylist/words/exp?category=${encodeURIComponent(category)}&language=${encodeURIComponent(lang)}&word=${encodeURIComponent(word)}`,
          { headers: authHeaders(token), cache: "no-store" }
        );
        const expText = expRes.ok ? cleanExp((await expRes.json()).exp) : "";
        return { word, exp: expText };
      })
    );
    return NextResponse.json({ words: withExp });
  } catch {
    return NextResponse.json({ error: "Impossible de joindre le serveur." }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const provider = resolveProvider(req);
  const token = getToken(req, provider.id);
  if (!token) return NextResponse.json({ error: "Non connecté." }, { status: 401 });
  let body: { word?: string; context?: string; category?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }
  const word = String(body.word ?? "").trim();
  if (!word) return NextResponse.json({ error: "Mot manquant." }, { status: 400 });
  const category = typeof body.category === "string" && body.category ? body.category : getCategory(req, provider.id, "0");
  const lang = getLanguage(req, provider.id, provider.language);
  const base = provider.apiBase;
  try {
    const res = await fetch(`${base}/api/open/v1/studylist/word`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ category, language: lang, word, context: body.context ?? "" }),
    });
    if (res.status === 401) return NextResponse.json({ error: "Token invalide ou expiré." }, { status: 401 });
    if (!res.ok) return NextResponse.json({ error: `Erreur API (${res.status}).` }, { status: res.status });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Impossible de joindre le serveur." }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const provider = resolveProvider(req);
  const token = getToken(req, provider.id);
  if (!token) return NextResponse.json({ error: "Non connecté." }, { status: 401 });
  let body: { word?: string; category?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }
  const word = String(body.word ?? "").trim();
  if (!word) return NextResponse.json({ error: "Mot manquant." }, { status: 400 });
  const category = typeof body.category === "string" && body.category ? body.category : getCategory(req, provider.id, "0");
  const lang = getLanguage(req, provider.id, provider.language);
  const base = provider.apiBase;
  try {
    const res = await fetch(`${base}/api/open/v1/studylist/word`, {
      method: "DELETE",
      headers: authHeaders(token),
      body: JSON.stringify({ category, language: lang, word }),
    });
    if (res.status === 401) return NextResponse.json({ error: "Token invalide ou expiré." }, { status: 401 });
    if (!res.ok) return NextResponse.json({ error: `Erreur API (${res.status}).` }, { status: res.status });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Impossible de joindre le serveur." }, { status: 502 });
  }
}
