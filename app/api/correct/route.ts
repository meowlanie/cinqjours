import { NextResponse } from "next/server";
import { aiChat, parseJson } from "@/lib/ai";
import { professorOf, inLang, correctionCategoryLabel, apiMessage, type LangCode } from "@/lib/languages";

export const runtime = "nodejs";

type Task = "summary" | "writing" | "speaking" | "journal";

interface Segment {
  text: string;
  flagged: boolean;
  note: { type: string; label: string; comment: string } | null;
  correction?: string;
  suggestion?: string;
}

function fallbackSegments(text: string): Segment[] {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  return sentences.map((s) => ({ text: s, flagged: false, note: null, correction: s }));
}

export function buildPrompt(task: Task, userText: string, sourceText: string, target: LangCode = "fr", translation: LangCode = "en") {
  const source = (sourceText || userText).trim();
  const isSpeaking = task === "speaking";

  const labels = {
    grammar: correctionCategoryLabel(translation, "grammar"),
    spelling: correctionCategoryLabel(translation, "spelling"),
    conjugation: correctionCategoryLabel(translation, "conjugation"),
    agreement: correctionCategoryLabel(translation, "agreement"),
    syntax: correctionCategoryLabel(translation, "syntax"),
    vocabulary: correctionCategoryLabel(translation, "vocabulary"),
  };

  // French target keeps the original French instructions verbatim.
  if (target === "fr") {
    const taskDescFr: Record<Task, string> = {
      summary: "L'apprenant a rédigé un résumé (80-120 mots) d'un texte source.",
      writing: "L'apprenant a rédigé un texte argumentatif (120-180 mots) en lien avec un texte source.",
      speaking: "Voici la transcription d'un enregistrement oral de l'apprenant.",
      journal: "L'apprenant a rédigé une entrée de journal personnel.",
    };
    const sourceBlock = source.trim()
      ? `

TEXTE SOURCE (${inLang(target)}) :
"""${source.trim().slice(0, 6000)}"""

Utilise ce texte source comme référence. Corrige les erreurs de langue ET signale (flagged) les phrases qui contredisent le source ou n'en rendent pas le contenu de façon fidèle. Une reformulation correcte n'est pas une erreur.`
      : "";

    return `${professorOf(target)}. ${taskDescFr[task]}

TEXTE DE L'APPRENANT :
"""${userText}"""${sourceBlock}

Corrige les erreurs objectives vérifiables : orthographe, grammaire, conjugaison, accord, ponctuation, vocabulaire incorrect, syntaxe${source.trim() ? ", infidélité au texte source" : ""}.

IMPORTANT :
  - flagged=true UNIQUEMENT pour les erreurs OBJECTIVES vérifiables (orthographe, grammaire, conjugaison, accord, syntaxe, vocabulaire incorrect${source.trim() ? ", infidélité au texte source" : ""}).
  - En cas de doute, laisse flagged=false.
  - Si une phrase est grammaticalement correcte mais maladroite, lourde ou peu naturelle, garde flagged=false mais propose une reformulation plus naturelle dans "suggestion".
${isSpeaking
    ? "- Pour les suggestions de style : privilégie un ton décontracté, conversationnel, comme le parlerait un natif à l'oral."
    : "- Pour les suggestions de style : privilégie un registre soutenu, élégant et naturel, ni trop familier ni trop formel."}

Découpe le texte en phrases. Pour chaque phrase :
- "text" : la phrase originale INCHANGÉE.
- "correction" : la phrase corrigée (identique à "text" si aucune erreur objective).
- "flagged" : true si la phrase contient au moins une erreur objective.
  - "note" : si flagged=true, un objet JSON {"type":"<grammaire/orthographe/conjugaison/accord/syntaxe/vocabulaire${source.trim() ? "/infidélité au texte source" : ""}>", "label":"<étiquette courte, en ${inLang(translation)}>", "comment":"<explication concise du point corrigé, en ${inLang(translation)}>"}. Sinon null.
- "suggestion" : si la phrase est correcte mais maladroite ou peu naturelle, propose une reformulation plus fluide et naturelle. Sinon null.

Réponds UNIQUEMENT en JSON : {"segments":[...]}`;
  }

  const taskDesc: Record<Task, string> = {
    fr: {
      summary: "L'apprenant a rédigé un résumé (80-120 mots) d'un texte source.",
      writing: "L'apprenant a rédigé un texte argumentatif (120-180 mots) en lien avec un texte source.",
      speaking: "Voici la transcription d'un enregistrement oral de l'apprenant.",
      journal: "L'apprenant a rédigé une entrée de journal personnel.",
    },
    en: {
      summary: "The learner wrote a summary (80-120 words) of a source text.",
      writing: "The learner wrote an argumentative text (120-180 words) related to a source text.",
      speaking: "Here is the transcript of the learner's oral recording.",
      journal: "The learner wrote a personal journal entry.",
    },
    de: {
      summary: "Die Lernperson hat eine Zusammenfassung (80-120 Wörter) eines Quelltextes verfasst.",
      writing: "Die Lernperson hat einen argumentativen Text (120-180 Wörter) zum Quelltext verfasst.",
      speaking: "Hier ist die Transkription der mündlichen Aufnahme der Lernperson.",
      journal: "Die Lernperson hat einen persönlichen Tagebucheintrag verfasst.",
    },
    zh: {
      summary: "学习者写了一篇源文本的摘要（80-120 词）。",
      writing: "学习者写了一篇与源文本相关的议论性文字（120-180 词）。",
      speaking: "以下是学习者的口语录音转写。",
      journal: "学习者写了一篇个人日记。",
    },
  }[target] ?? {
    summary: "The learner wrote a summary (80-120 words) of a source text.",
    writing: "The learner wrote an argumentative text (120-180 words) related to a source text.",
    speaking: "Here is the transcript of the learner's oral recording.",
    journal: "The learner wrote a personal journal entry.",
  };

  const sourceBlock = source.trim()
    ? `

SOURCE TEXT (${inLang(target)}):
"""${source.trim().slice(0, 6000)}"""

Use this source text as a reference. Correct language errors AND flag (flagged) the sentences that contradict the source or do not faithfully reflect its content. A correct reformulation is not an error.`
    : "";

  const styleNote = isSpeaking
    ? "For style suggestions: prefer a casual, conversational tone, as a native would speak."
    : "For style suggestions: prefer a polished, elegant and natural register, neither too familiar nor too formal.";

  const britishSpelling = target === "en" || translation === "en"
    ? "  - Prefer British spelling (e.g. colour, organise, centre); American variants are also accepted.\n"
    : "";

  return `${professorOf(target)}. ${taskDesc[task]}

LEARNER'S TEXT:
"""${userText}"""${sourceBlock}

Correct objective, verifiable errors: spelling, grammar, conjugation, agreement, punctuation, incorrect vocabulary, syntax${source.trim() ? ", lack of faithfulness to the source text" : ""}.

IMPORTANT:
  - flagged=true ONLY for OBJECTIVE verifiable errors (spelling, grammar, conjugation, agreement, syntax, incorrect vocabulary${source.trim() ? ", faithfulness to the source text" : ""}).
  - When in doubt, set flagged=false.
${britishSpelling}  - If a sentence is grammatically correct but awkward, heavy or unnatural, keep flagged=false but propose a more natural reformulation in "suggestion".
${styleNote}

Split the text into sentences. For each sentence:
- "text": the original sentence UNCHANGED.
- "correction": the corrected sentence (identical to "text" if no objective error).
- "flagged": true if the sentence contains at least one objective error.
  - "note": if flagged=true, an object {"type":"<grammar/spelling/conjugation/agreement/syntax/vocabulary${source.trim() ? "/faithfulness" : ""}>", "label":"<short label, in ${inLang(translation)}>", "comment":"<concise explanation of the correction, in ${inLang(translation)}>"}. Otherwise null.
- "suggestion": if the sentence is correct but awkward or unnatural, propose a more fluent and natural reformulation. Otherwise null.

Write the "label" and "comment" fields in ${inLang(translation)}. Use these category labels in ${inLang(translation)}: grammar = "${labels.grammar}", spelling = "${labels.spelling}", conjugation = "${labels.conjugation}", agreement = "${labels.agreement}", syntax = "${labels.syntax}", vocabulary = "${labels.vocabulary}".

Respond ONLY in JSON: {"segments":[...]}`;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    segments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING" },
          correction: { type: "STRING" },
          flagged: { type: "BOOLEAN" },
          note: {
            type: "OBJECT",
            nullable: true,
            properties: {
              type: { type: "STRING" },
              label: { type: "STRING" },
              comment: { type: "STRING" },
            },
            required: ["type", "label", "comment"],
          },
          suggestion: { type: "STRING", nullable: true },
        },
        required: ["text", "correction", "flagged", "note"],
      },
    },
  },
  required: ["segments"],
};

export async function POST(req: Request) {
  let body: { task?: Task; text?: string; source?: string; target?: string; translation?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: apiMessage("fr", "invalid_body") }, { status: 400 });
  }

  const task = body.task || "summary";
  const userText = (body.text || "").trim();
  const source = (body.source || "").trim();
  const target = (body.target || "fr") as LangCode;
  const translation = (body.translation || "en") as LangCode;
  if (!userText) return NextResponse.json({ error: apiMessage(target, "text_missing") }, { status: 400 });

  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ segments: fallbackSegments(userText), fallback: true });
  }

  try {
    const raw = await aiChat([
      { role: "user", content: buildPrompt(task, userText, source || userText, target, translation) },
    ], { maxTokens: 8000, responseSchema: RESPONSE_SCHEMA });

    const parsed = parseJson(raw) as { segments?: Segment[] } | null;

    if (!parsed || !Array.isArray(parsed.segments)) {
      return NextResponse.json({ segments: fallbackSegments(userText), fallback: true });
    }

    const safeSegments = parsed.segments
      .filter((s) => s && typeof s.text === "string" && s.text.trim())
      .map((s) => ({
        text: s.text.trim(),
        flagged: Boolean(s.flagged),
        note: s.note && typeof s.note === "object" ? s.note : null,
        correction: typeof s.correction === "string" && s.correction.trim() ? s.correction.trim() : s.text.trim(),
        suggestion: typeof s.suggestion === "string" && s.suggestion.trim() ? s.suggestion.trim() : undefined,
      }));

    return NextResponse.json({
      segments: safeSegments.length > 0 ? safeSegments : fallbackSegments(userText),
      fallback: false,
    });
  } catch (err) {
    console.log("[correct] ERROR:", err instanceof Error ? err.message : err);
    const status = (err as { status?: number })?.status;
    if (status === 429) {
      return NextResponse.json({
        segments: fallbackSegments(userText),
        fallback: true,
        quotaExceeded: true,
        message: apiMessage(target, "quota"),
      }, { status: 429 });
    }
    return NextResponse.json({
      segments: fallbackSegments(userText),
      fallback: true,
      error: err instanceof Error ? err.message : apiMessage(target, "ai_error"),
    });
  }
}
