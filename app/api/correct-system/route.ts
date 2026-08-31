import { NextResponse } from "next/server";
import { checkText, type LTMatch } from "@/lib/languagetool";
import { type LangCode, correctionCategoryLabel, apiMessage } from "@/lib/languages";

export const runtime = "nodejs";

interface Segment {
  text: string;
  flagged: boolean;
  note: { type: string; label: string; comment: string } | null;
  correction?: string;
}

function splitSentences(text: string): { text: string; start: number; end: number }[] {
  const sentences: { text: string; start: number; end: number }[] = [];
  const re = /[^.!?]+[.!?]+[\s]*/g;
  let m: RegExpExecArray | null;
  let lastEnd = 0;
  while ((m = re.exec(text)) !== null) {
    sentences.push({ text: m[0].trim(), start: m.index, end: m.index + m[0].length });
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < text.length) {
    const remaining = text.slice(lastEnd).trim();
    if (remaining) sentences.push({ text: remaining, start: lastEnd, end: text.length });
  }
  return sentences;
}

function applyReplacements(sentence: string, sentenceStart: number, matches: LTMatch[]): string {
  const relevant = matches
    .filter((m) => m.offset >= sentenceStart && m.offset < sentenceStart + sentence.length && m.replacements.length > 0)
    .sort((a, b) => b.offset - a.offset);

  let result = sentence;
  for (const match of relevant) {
    const localOffset = match.offset - sentenceStart;
    const bestReplacement = match.replacements[0].value;
    result = result.slice(0, localOffset) + bestReplacement + result.slice(localOffset + match.length);
  }
  return result;
}

function getCategoryKind(match: LTMatch): "grammar" | "spelling" | "style" | "punctuation" {
  const catId = match.rule.category.id.toLowerCase();
  if (catId.includes("grammar") || catId.includes("grammaire")) return "grammar";
  if (catId.includes("typo") || catId.includes("spelling") || catId.includes("orthographe")) return "spelling";
  if (catId.includes("style")) return "style";
  if (catId.includes("punct") || catId.includes("ponctuation")) return "punctuation";
  return "spelling";
}

export async function POST(req: Request) {
  let body: { text?: string; target?: string; translation?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: apiMessage("fr", "invalid_body") }, { status: 400 });
  }

  const text = (body.text || "").trim();
  const target = (body.target || "fr") as LangCode;
  const translation = (body.translation || target) as LangCode;
  if (!text) return NextResponse.json({ error: apiMessage(target, "text_missing") }, { status: 400 });

  if (target !== "fr" && target !== "en" && target !== "de" && target !== "zh") {
    const sentences = splitSentences(text);
    return NextResponse.json({
      segments: sentences.map((s) => ({ text: s.text, flagged: false, note: null, correction: s.text })),
      fallback: true,
      languageUnsupported: true,
    });
  }

  try {
    const matches = await checkText(text, target);
    const sentences = splitSentences(text);

    const segments: Segment[] = sentences.map((s) => {
      const sentenceMatches = matches.filter(
        (m) => m.offset >= s.start && m.offset < s.end
      );

      if (sentenceMatches.length === 0) {
        return { text: s.text, flagged: false, note: null, correction: s.text };
      }

      const correction = applyReplacements(s.text, s.start, matches);
      const firstMatch = sentenceMatches[0];

      return {
        text: s.text,
        flagged: true,
        correction,
        note: {
          type: getCategoryKind(firstMatch),
          label: correctionCategoryLabel(translation, getCategoryKind(firstMatch)),
          comment: firstMatch.message,
        },
      };
    });

    return NextResponse.json({ segments, fallback: false });
  } catch (err) {
    console.error("[correct-system] ERROR:", err instanceof Error ? err.message : err);
    const sentences = splitSentences(text);
    return NextResponse.json({
      segments: sentences.map((s) => ({ text: s.text, flagged: false, note: null, correction: s.text })),
      fallback: true,
    });
  }
}
