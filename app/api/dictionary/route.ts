import { NextResponse } from "next/server";
import { aiChat, parseJson } from "@/lib/ai";
import { llmName, inLang, apiMessage, type LangCode } from "@/lib/languages";

export const runtime = "nodejs";

/** Example part-of-speech labels shown to the model, in the target language. */
function posExamples(target: LangCode): string {
  switch (target) {
    case "fr":
      return "verbe / nom m. / nom f. / adjectif / adverbe / expression…";
    case "en":
      return "verb / noun (m.) / noun (f.) / adjective / adverb / phrase…";
    case "de":
      return "Verb / Substantiv, n. / Substantiv, m. / Substantiv, f. / Adjektiv / Adverb / Ausdruck…";
    case "zh":
      return "动词 / 名词（阳） / 名词（阴） / 形容词 / 副词 / 短语…";
    default:
      return "verbe / nom / adjectif…";
  }
}

interface DictionaryEntry {
  base: string;
  pos: string;
  translation: string;
  def: string;
  example: string | null;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    base: { type: "STRING" },
    pos: { type: "STRING" },
    translation: { type: "STRING" },
    def: { type: "STRING" },
    example: { type: "STRING", nullable: true },
  },
  required: ["base", "translation", "def"],
};

export async function POST(req: Request) {
  let body: { word?: string; sentence?: string; target?: string; translation?: string; ui?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: apiMessage("fr", "invalid_body") }, { status: 400 });
  }

  const word = (body.word || "").trim();
  const sentence = (body.sentence || "").trim();
  const target = (body.target || "fr") as LangCode;
  const translation = (body.translation || "en") as LangCode;
  const ui = (body.ui || translation) as LangCode;
  if (!word) return NextResponse.json({ error: apiMessage(target, "word_missing") }, { status: 400 });

  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({
      base: word,
      pos: "—",
      translation: "",
      def: "Traduction contextuelle générée par l'IA — ajoutez une clé DEEPSEEK_API_KEY.",
      example: null,
      fallback: true,
    });
  }

  try {
    const raw = await aiChat([
      {
        role: "user",
        content: `Identifie le mot ou l'expression « ${word} » utilisé dans cette phrase ${inLang(target)} : "${sentence}".
${target === "de" ? "\nSi le mot est un préfixe séparable ou une forme conjuguée d'un verbe séparable allemand, donne l'infinitif COMPLET (préfixe + radical), par exemple « nimmt … an » → « annehmen », « steht … auf » → « aufstehen »." : ""}
Réponds UNIQUEMENT en JSON :
{
  "base": "<forme de base du mot, ${inLang(target)}${target === "de" ? ", en respectant la MAJUSCULE des noms allemands (ex. « Hund », « die Schule »)" : ""}>",
  "pos": "<${posExamples(ui)}>",
  "translation": "<traduction ${inLang(translation)} du mot DANS CE CONTEXTE>",
  "def": "<brève explication ${inLang(translation)} du sens du mot dans ce contexte>",
  "example": "<exemple d'utilisation ${inLang(target)}, ou null>"
}${translation === "en" ? " Utilise l'orthographe britannique." : ""}`,
      },
    ], { maxTokens: 400, responseSchema: RESPONSE_SCHEMA });

    const parsed = parseJson(raw) as Partial<DictionaryEntry> | null;
    if (parsed && parsed.base) {
      return NextResponse.json({
        base: parsed.base,
        pos: parsed.pos || "—",
        translation: parsed.translation || "",
        def: parsed.def || "Explanation unavailable.",
        example: parsed.example || null,
        fallback: false,
      });
    }
    throw new Error("JSON attendu absent.");
  } catch (err) {
    console.log("[dictionary] ERROR:", err instanceof Error ? err.message : err);
    const status = (err as { status?: number })?.status;
    if (status === 429) {
      return NextResponse.json({
        base: word,
        pos: "—",
        translation: "",
        def: "Quota dépassé — réessayez plus tard.",
        example: null,
        fallback: true,
      }, { status: 429 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur IA." },
      { status: 502 }
    );
  }
}
