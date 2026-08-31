import { NextResponse } from "next/server";
import { aiTranscribeAudio, parseJson } from "@/lib/ai";
import { professorOf, inLang, type LangCode } from "@/lib/languages";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Segment {
  text: string;
  flagged: boolean;
  note: { type: string; label: string; comment: string } | null;
  correction?: string;
  suggestion?: string | null;
}

function audioErrors(target: LangCode): { invalid: string; missing: string; key: string } {
  const map: Record<LangCode, { invalid: string; missing: string; key: string }> = {
    fr: { invalid: "Corps de requête invalide.", missing: "Audio manquant.", key: "MISTRAL_API_KEY manquante." },
    en: { invalid: "Invalid request body.", missing: "Audio missing.", key: "MISTRAL_API_KEY missing." },
    de: { invalid: "Ungültiger Anfragekörper.", missing: "Audio fehlt.", key: "MISTRAL_API_KEY fehlt." },
    zh: { invalid: "请求正文无效。", missing: "缺少音频。", key: "MISTRAL_API_KEY 缺失。" },
  };
  return map[target] ?? map.fr;
}

// Mistral Voxtral returns free-form JSON; the structure is enforced via the prompt.

export async function POST(req: Request) {
  let body: { audio?: string; source?: string; target?: string; translation?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const audio = (body.audio || "").trim();
  const source = (body.source || "").trim();
  const target = (body.target || "fr") as LangCode;
  const translation = (body.translation || "en") as LangCode;
  const errs = audioErrors(target);

  if (!audio) return NextResponse.json({ error: errs.missing }, { status: 400 });

  if (!process.env.MISTRAL_API_KEY) {
    return NextResponse.json({ segments: [], fallback: true, error: errs.key });
  }

  const context = source ? `\n\nTEXTE SOURCE (contexte) :\n"""${source.slice(0, 4000)}"""` : "";

  const prompt = `${professorOf(target)}. Transcrits l'enregistrement audio ci-joint ${inLang(target)}, puis corrige les erreurs objectives vérifiables : grammaire, conjugaison, accord, vocabulaire incorrect, syntaxe.
${context}

IMPORTANT :
- flagged=true UNIQUEMENT pour les erreurs OBJECTIVES vérifiables (grammaire, conjugaison, accord, syntaxe, vocabulaire incorrect).
- En cas de doute, laisse flagged=false.
${target === "en" ? "- Accepte indifféremment l'orthographe américaine et britannique (ex. color/colour, organize/organise, recognize/recognise).\n" : ""}
- Si une phrase est grammaticalement correcte mais maladroite, lourde ou peu naturelle, garde flagged=false mais propose une reformulation plus naturelle dans "suggestion".

Découpe la transcription en phrases. Pour chaque phrase :
- "text" : la phrase transcrite telle quelle.
- "correction" : la phrase corrigée (identique à "text" si aucune erreur objective).
- "flagged" : true si la phrase contient au moins une erreur objective.
- "note" : si flagged=true, un objet JSON {"type":"<grammaire/orthographe/conjugaison/accord/syntaxe/vocabulaire>", "label":"<étiquette courte, en ${inLang(translation)}>", "comment":"<explication concise du point corrigé, en ${inLang(translation)}>"}. Sinon null.
- "suggestion" : si la phrase est correcte mais maladroite ou peu naturelle, propose une reformulation plus fluide et naturelle (ton conversationnel, comme le parlerait un natif à l'oral). Sinon null.

Réponds UNIQUEMENT en JSON : {"segments":[...]}`;

  try {
    const raw = await aiTranscribeAudio(audio, prompt);

    const parsed = parseJson(raw) as { segments?: Segment[] } | null;

    if (!parsed || !Array.isArray(parsed.segments) || parsed.segments.length === 0) {
      return NextResponse.json({ segments: [], fallback: true });
    }

    const safeSegments = parsed.segments
      .filter((s) => s && typeof s.text === "string" && s.text.trim())
      .map((s) => ({
        text: s.text.trim(),
        flagged: Boolean(s.flagged),
        note: s.note && typeof s.note === "object" ? s.note : null,
        correction: typeof s.correction === "string" && s.correction.trim() ? s.correction.trim() : s.text.trim(),
        suggestion: typeof s.suggestion === "string" && s.suggestion.trim() ? s.suggestion.trim() : null,
      }));

    return NextResponse.json({
      segments: safeSegments,
      fallback: false,
    });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const message = err instanceof Error ? err.message : "Erreur IA.";
    if (status === 429) {
      return NextResponse.json({ segments: [], fallback: true, quotaExceeded: true, error: message }, { status: 429 });
    }
    return NextResponse.json({ segments: [], fallback: true, error: message });
  }
}
