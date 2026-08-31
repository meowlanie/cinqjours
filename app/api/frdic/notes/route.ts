import { NextRequest, NextResponse } from "next/server";
import { resolveProvider, getToken, getCategory, getLanguage, authHeaders } from "@/lib/dictSync";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const provider = resolveProvider(req);
  const token = getToken(req, provider.id);
  if (!token) return NextResponse.json({ notes: [] });
  const category = getCategory(req, provider.id, "0");
  const lang = getLanguage(req, provider.id, provider.language);
  const base = provider.apiBase;
  try {
    const res = await fetch(
      `${base}/api/open/v1/studylist/notes?category=${encodeURIComponent(category)}&language=${encodeURIComponent(lang)}`,
      { headers: authHeaders(token), cache: "no-store" }
    );
    if (!res.ok) return NextResponse.json({ notes: [] });
    const data = (await res.json()) as { notes?: { word?: string; note?: string }[] };
    const notes = Array.isArray(data.notes) ? data.notes : [];
    return NextResponse.json({
      notes: notes
        .map((n) => ({ word: String(n.word ?? ""), note: String(n.note ?? "") }))
        .filter((n) => n.word && n.note),
    });
  } catch {
    return NextResponse.json({ notes: [] });
  }
}

export async function POST(req: NextRequest) {
  const provider = resolveProvider(req);
  const token = getToken(req, provider.id);
  if (!token) return NextResponse.json({ error: "Non connecté." }, { status: 401 });
  let body: { word?: string; note?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }
  const word = String(body.word ?? "").trim();
  const note = String(body.note ?? "").trim();
  if (!word || !note) return NextResponse.json({ error: "Champs manquants." }, { status: 400 });
  const category = getCategory(req, provider.id, "0");
  const lang = getLanguage(req, provider.id, provider.language);
  const base = provider.apiBase;
  try {
    const res = await fetch(`${base}/api/open/v1/studylist/note`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ category, language: lang, word, note }),
    });
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
  let body: { word?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }
  const word = String(body.word ?? "").trim();
  if (!word) return NextResponse.json({ error: "Mot manquant." }, { status: 400 });
  const category = getCategory(req, provider.id, "0");
  const lang = getLanguage(req, provider.id, provider.language);
  const base = provider.apiBase;
  try {
    const res = await fetch(`${base}/api/open/v1/studylist/note`, {
      method: "DELETE",
      headers: authHeaders(token),
      body: JSON.stringify({ category, language: lang, word }),
    });
    if (!res.ok) return NextResponse.json({ error: `Erreur API (${res.status}).` }, { status: res.status });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Impossible de joindre le serveur." }, { status: 502 });
  }
}
