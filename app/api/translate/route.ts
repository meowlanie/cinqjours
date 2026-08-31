import { NextResponse } from "next/server";
import { aiChat, parseJson } from "@/lib/ai";
import { llmName, inLang, apiMessage, type LangCode } from "@/lib/languages";

export const runtime = "nodejs";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    translation: { type: "STRING" },
  },
  required: ["translation"],
};

export async function POST(req: Request) {
  let body: { sentence?: string; source?: string; target?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: apiMessage("fr", "invalid_body") }, { status: 400 });
  }

  const sentence = (body.sentence || "").trim();
  const sourceLang = (body.source || "fr") as LangCode;
  const targetLang = (body.target || "en") as LangCode;
  if (!sentence) return NextResponse.json({ error: apiMessage(targetLang, "sentence_missing") }, { status: 400 });

  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ translation: "", fallback: true });
  }

  try {
    const raw = await aiChat([
      {
        role: "user",
        content: `Traduis la phrase suivante (${inLang(sourceLang)}) vers ${llmName(targetLang)} (${llmName(targetLang)} naturel et fidèle au sens)${targetLang === "en" ? " Utilise l'orthographe britannique." : ""} : "${sentence}"

Réponds UNIQUEMENT en JSON : {"translation":"<traduction>"}`,
      },
    ], { maxTokens: 300, responseSchema: RESPONSE_SCHEMA });

    const parsed = parseJson(raw) as { translation?: string } | null;
    const translation = typeof parsed?.translation === "string" ? parsed.translation.trim() : "";
    if (translation) return NextResponse.json({ translation, fallback: false });

    throw new Error("Structure de réponse inattendue.");
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 429) {
      return NextResponse.json({ translation: "", fallback: true, quotaExceeded: true }, { status: 429 });
    }
    return NextResponse.json({ translation: "", fallback: true });
  }
}
