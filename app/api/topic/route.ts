import { NextResponse } from "next/server";
import { aiChat, parseJson } from "@/lib/ai";
import { inLang, apiMessage, type LangCode } from "@/lib/languages";

export const runtime = "nodejs";

function levelToFr(level?: string): string {
  switch (level) {
    case "beginner":
      return "débutant (A1-A2)";
    case "intermediate":
      return "intermédiaire (B1-B2)";
    case "advanced":
    default:
      return "avancé (C1-C2)";
  }
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    topic: { type: "STRING" },
  },
  required: ["topic"],
};

export async function POST(req: Request) {
  let body: { source?: string; title?: string; mode?: string; target?: string; level?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: apiMessage("fr", "invalid_body") }, { status: 400 });
  }

  const source = (body.source || "").trim();
  const title = (body.title || "").trim();
  const target = (body.target || "fr") as LangCode;
  const levelPhrase = levelToFr(body.level);
  const mode = body.mode === "speaking" ? "speaking" : body.mode === "journal" ? "journal" : "writing";

  if (mode !== "journal" && !source) return NextResponse.json({ error: apiMessage(target, "source_missing") }, { status: 400 });

  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ topic: "", fallback: true });
  }

  const instruction = mode === "speaking"
    ? `Propose UN sujet de présentation orale ${inLang(target)} (1 à 2 phrases), adapté à un enregistrement d'une à deux minutes, où l'apprenant présente le thème du texte puis donne son opinion personnelle. Le sujet doit être adapté à un apprenant ${levelPhrase}.

Réponds UNIQUEMENT en JSON : {"topic":"<sujet>"}`
    : mode === "journal"
    ? `Propose UN sujet d'écriture de journal intime ${inLang(target)} (1 à 2 phrases), une question ouverte qui invite l'apprenant à réfléchir à sa journée, ses émotions, ses projets ou ses souvenirs. Le sujet doit être adapté à un niveau ${levelPhrase}.

Réponds UNIQUEMENT en JSON : {"topic":"<sujet>"}`
    : `Propose UN sujet de rédaction (une question ouverte, ${inLang(target)}, 1 à 2 phrases) qui invite l'apprenant à donner son avis argumenté sur le thème du texte. Le sujet doit être adapté à un apprenant ${levelPhrase}.

Réponds UNIQUEMENT en JSON : {"topic":"<sujet>"}`;

  const sourceContext = source
    ? `Voici un texte source ${inLang(target)}${title ? ` intitulé « ${title} »` : ""} :
"""${source.slice(0, 4000)}"""

`
    : "";

  try {
    const raw = await aiChat([
      {
        role: "user",
        content: mode === "journal" ? instruction : `${sourceContext}${instruction}`,
      },
    ], { maxTokens: 500, responseSchema: RESPONSE_SCHEMA });

    const parsed = parseJson(raw) as { topic?: string } | null;
    const topic = typeof parsed?.topic === "string" ? parsed.topic.trim() : "";
    if (topic) return NextResponse.json({ topic, fallback: false });

    throw new Error("Structure de réponse inattendue.");
  } catch (err) {
    console.error("[topic] ERROR:", err instanceof Error ? err.message : err);
    const status = (err as { status?: number })?.status;
    if (status === 429) {
      return NextResponse.json({ topic: "", fallback: true, quotaExceeded: true }, { status: 429 });
    }
    return NextResponse.json({ topic: "", fallback: true });
  }
}
