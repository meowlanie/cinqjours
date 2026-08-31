import { NextResponse } from "next/server";
import { aiChat, parseJson } from "@/lib/ai";
import { llmName, inLang, apiMessage, type LangCode } from "@/lib/languages";

export const runtime = "nodejs";

function levelToFr(level?: string): string {
  switch (level) {
    case "beginner":
      return "de niveau débutant (A1-A2)";
    case "intermediate":
      return "de niveau intermédiaire (B1-B2)";
    case "advanced":
    default:
      return "de niveau avancé (C1-C2)";
  }
}


interface ExerciseQuestion {
  type: string;
  category: string;
  label: string;
  q: string;
  options: string[];
  answer: string;
  explain: string;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING" },
          category: { type: "STRING" },
          label: { type: "STRING" },
          q: { type: "STRING" },
          options: { type: "ARRAY", items: { type: "STRING" } },
          answer: { type: "STRING" },
          explain: { type: "STRING" },
        },
        required: ["type", "category", "q", "answer", "explain"],
      },
    },
  },
  required: ["questions"],
};

function parseQuestions(qs: unknown[]): ExerciseQuestion[] {
  return qs.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const q = raw as Record<string, unknown>;
    const questionText = (typeof q.q === "string" && q.q) ? q.q : (typeof q.question === "string" && q.question) ? q.question : "";
    if (!questionText) return [];
    if (typeof q.answer !== "string" || !q.answer.trim()) return [];
    const options = Array.isArray(q.options) ? (q.options as unknown[]).map(String).filter(Boolean).slice(0, 4) : [];
    const category = typeof q.category === "string" && q.category.toLowerCase().startsWith("gram") ? "grammar" : "vocab";
    return [{
      type: typeof q.type === "string" ? q.type : "qcm",
      category,
      label: typeof q.label === "string" ? q.label : "Question",
      q: questionText,
      options,
      answer: q.answer,
      explain: typeof q.explain === "string" ? q.explain : "",
    }];
  });
}

export async function POST(req: Request) {
  let body: { source?: string; previous?: { type: string; q: string; answer: string }[]; target?: string; translation?: string; level?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: apiMessage("fr", "invalid_body") }, { status: 400 });
  }

  const source = (body.source || "").trim();
  const target = (body.target || "fr") as LangCode;
  const translation = (body.translation || "en") as LangCode;
  const levelPhrase = levelToFr(body.level);
  const previous = Array.isArray(body.previous) ? body.previous.filter((p) => p && typeof p.q === "string") : [];

  if (!source) return NextResponse.json({ error: apiMessage(target, "source_missing") }, { status: 400 });

  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ questions: [], fallback: true });
  }

  const prevText = previous.length
    ? `\n\nExercices DÉJÀ générés (à ne JAMAIS répéter) — utilise des mots et points de langue STRICTEMENT différents :\n${previous.map((p, i) => `${i + 1}. [${p.type}] ${p.q} (réponse : ${p.answer})`).join("\n")}`
    : "";

  try {
    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      try {
        const raw = await aiChat([
          {
            role: "user",
            content: `Voici un texte source ${inLang(target)} :
"""${source.slice(0, 5000)}"""
${prevText}

        Crée 10 exercices de ${llmName(target)} langue étrangère, ${levelPhrase}, directement basés sur ce texte :
- 5 exercices de VOCABULAIRE (category="vocab")
- 5 exercices de GRAMMAIRE (category="grammar")

Varie les types autant que possible parmi : "qcm" (question à choix multiple), "fill" (texte à trous), "translation" (traduction), "sentence" (construction de phrase), "synonyms" (synonymes), "conjugation" (conjugaison), "reformulation" (réécrire la phrase dans un autre registre), "register" (identifier le registre : familier / courant / soutenu), "error_detection" (repérer l'erreur dans une phrase), "word_formation" (dériver un mot à partir d'une racine), "collocation" (choisir la collocation correcte).

Règle de diversification STRICTE : Chaque fois que tu génères des exercices (chaque tour), chaque exercice doit cibler un point de langue DIFFÉRENT de TOUS les exercices précédents (ceux listés ci-dessus) ET du tour en cours. Ne JAMAIS répéter un mot, une expression, un temps verbal ou un point de grammaire déjà couvert. Explore des parties différentes du texte.

Pour "qcm", "error_detection" et "collocation" : mets 3 à 4 options dans "options" et la réponse exacte dans "answer" (l'answer doit figurer exactement dans options). Pour tous les autres types : laisse "options" vide et mets la réponse modèle dans "answer".

        Chaque exercice doit être exigeant (${levelPhrase}), avec une explication claire ${inLang(translation)} dans "explain".

Réponds UNIQUEMENT en JSON : {"questions":[...]}`,
          },
        ], { maxTokens: 5000, responseSchema: RESPONSE_SCHEMA });

        const parsed = parseJson(raw) as { questions?: unknown[] } | null;
        const qs = Array.isArray(parsed?.questions) ? parsed.questions : null;
        if (qs && qs.length) {
          const clean = parseQuestions(qs);
          if (clean.length) return NextResponse.json({ questions: clean, fallback: false });
        }
        // réponse reçue mais aucun exercice valide : on réessaie une fois
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if (status === 429) {
          return NextResponse.json({ questions: [], fallback: true, quotaExceeded: true }, { status: 429 });
        }
        // autre erreur : on réessaie une fois
      }
    }
    return NextResponse.json({ questions: [], fallback: true });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 429) {
      return NextResponse.json({ questions: [], fallback: true, quotaExceeded: true }, { status: 429 });
    }
    return NextResponse.json({ questions: [], fallback: true });
  }
}
