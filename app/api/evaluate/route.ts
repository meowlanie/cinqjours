import { NextResponse } from "next/server";
import { aiChat, parseJson } from "@/lib/ai";
import { professorOf, inLang, apiMessage, type LangCode } from "@/lib/languages";

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
    results: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          correct: { type: "BOOLEAN" },
          feedback: { type: "STRING" },
        },
        required: ["correct", "feedback"],
      },
    },
  },
  required: ["results"],
};

export async function POST(req: Request) {
  let body: { items?: { question: string; type: string; reference: string; answer: string }[]; target?: string; translation?: string; level?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: apiMessage("fr", "invalid_body") }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  const target = (body.target || "fr") as LangCode;
  const translation = (body.translation || "en") as LangCode;
  const levelPhrase = levelToFr(body.level);
  if (!items.length) return NextResponse.json({ results: [] });

  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ results: items.map(() => ({ correct: false, feedback: apiMessage(target, "eval_unavailable") })) });
  }

  const list = items.map((it, i) =>
    `${i + 1}. Type : ${it.type}\nQuestion : ${it.question}\nRéponse modèle (indicative) : ${it.reference}\nRéponse de l'apprenant : ${it.answer}`
  ).join("\n\n");

  const feedbackLang = inLang(translation);
  const enSpellingNote = target === "en" || translation === "en"
    ? "  - For answers written in English, accept both American and British spelling (e.g. color/colour, organize/organise, recognize/recognise): a spelling variant alone is not an error.\n"
    : "";

  let prompt: string;
  if (target === "fr") {
    prompt = `${professorOf(target)}. Évalue les réponses d'un apprenant à des exercices ${inLang(target)} (niveau ${levelPhrase}).

Pour chaque réponse, juge si elle est CORRECTE ou APPROPRIÉE (équivalence de sens acceptée, pas de correspondance exacte exigée), notamment pour les questions ouvertes (expliquer un mot avec ses propres mots, traduction, construction de phrase, synonymes). Sois tolérant sur la forme si le sens est juste.${translation === "en" ? " Pour les réponses rédigées en anglais (traduction, etc.), accepte indifféremment l'orthographe américaine et britannique (ex. color/colour, organize/organise, recognize/recognise) : une variante orthographique seule n'est pas une erreur." : ""}

${list}

Réponds UNIQUEMENT en JSON avec un résultat par item, dans l'ordre : {"results":[{"correct":true,"feedback":"..."}]}.
Rédige chaque "feedback" en ${feedbackLang} : explication brève et claire de la réponse attendue ou de la correction.`;
  } else {
    prompt = `${professorOf(target)}. Evaluate a learner's answers to ${inLang(target)} exercises (level ${levelPhrase}).

For each answer, judge whether it is CORRECT or ACCEPTABLE (sense equivalence is accepted, exact wording is not required), especially for open-ended questions (explaining a word in one's own words, translation, sentence building, synonyms). Be tolerant on form if the meaning is correct.
${enSpellingNote}
${list}

Respond ONLY in JSON with one result per item, in order: {"results":[{"correct":true,"feedback":"..."}]}.
Write each "feedback" in ${feedbackLang}: a brief, clear explanation of the expected answer or the correction.`;
  }

  try {
    const raw = await aiChat([
      {
        role: "user",
        content: prompt,
      },
    ], { maxTokens: 3000, responseSchema: RESPONSE_SCHEMA });

    const parsed = parseJson(raw) as { results?: { correct?: boolean; feedback?: string }[] } | null;
    const results = Array.isArray(parsed?.results) ? parsed.results : null;
    if (results && results.length) {
      const clean = results.map((r) => ({
        correct: Boolean(r?.correct),
        feedback: typeof r?.feedback === "string" ? r.feedback : "",
      }));
      return NextResponse.json({ results: clean });
    }
    throw new Error("Structure de réponse inattendue.");
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 429) {
      return NextResponse.json({ results: items.map(() => ({ correct: false, feedback: "Quota dépassé." })) }, { status: 429 });
    }
    return NextResponse.json({ results: items.map(() => ({ correct: false, feedback: "Évaluation indisponible." })) });
  }
}
