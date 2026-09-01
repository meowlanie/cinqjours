export type LangCode = "fr" | "en" | "de" | "zh";
export type Level = "beginner" | "intermediate" | "advanced";

export interface LangMeta {
  /** Language name used inside AI prompts, e.g. "français". */
  llmName: string;
  /** UI chrome is translated for this language (first release: fr, en). */
  uiReady?: boolean;
  /** Dictionary provider id whose built-in box syncs this target language. */
  dictProvider?: "frdic" | "godic" | "eudic";
}

export const LANGUAGES: Record<LangCode, LangMeta> = {
  fr: { llmName: "français", uiReady: true, dictProvider: "frdic" },
  en: { llmName: "anglais", uiReady: true, dictProvider: "eudic" },
  de: { llmName: "allemand", dictProvider: "godic", uiReady: true },
  zh: { llmName: "chinois", uiReady: true },
};

/** Languages whose UI chrome is translated (first release: fr, en). */
export const UI_LANGUAGES: LangCode[] = ["en", "fr", "de", "zh"];

export const TARGET_LANGUAGES: LangCode[] = ["en", "fr", "de", "zh"];
export const TRANSLATION_LANGUAGES: LangCode[] = ["en", "fr", "de", "zh"];

export const LEVELS: Level[] = ["beginner", "intermediate", "advanced"];

export function llmName(code: LangCode): string {
  return LANGUAGES[code]?.llmName ?? code;
}

/** "professeur de français" / "professeur d'anglais" / "professeur d'allemand" / "professeur de chinois". */
export function professorOf(code: LangCode): string {
  const name = llmName(code);
  return `professeur ${/^[aeiou]/i.test(name) ? "d'" : "de "}${name}`;
}

/** "en français" / "en anglais" / "en allemand" / "en chinois". */
export function inLang(code: LangCode): string {
  return `en ${llmName(code)}`;
}

/** BCP-47 locale matching a target language, for date/number formatting. */
export function localeOf(code: LangCode): string {
  switch (code) {
    case "fr":
      return "fr-FR";
    case "en":
      return "en-US";
    case "de":
      return "de-DE";
    case "zh":
      return "zh-CN";
    default:
      return "fr-FR";
  }
}

type CategoryKind =
  | "grammar"
  | "spelling"
  | "conjugation"
  | "agreement"
  | "syntax"
  | "vocabulary"
  | "style"
  | "punctuation"
  | "faithfulness";

const CORRECTION_CATEGORY_LABELS: Record<LangCode, Record<CategoryKind, string>> = {
  fr: { grammar: "grammaire", spelling: "orthographe", conjugation: "conjugaison", agreement: "accord", syntax: "syntaxe", vocabulary: "vocabulaire", style: "style", punctuation: "ponctuation", faithfulness: "fidélité au source" },
  en: { grammar: "grammar", spelling: "spelling", conjugation: "conjugation", agreement: "agreement", syntax: "syntax", vocabulary: "vocabulary", style: "style", punctuation: "punctuation", faithfulness: "faithfulness to source" },
  de: { grammar: "Grammatik", spelling: "Rechtschreibung", conjugation: "Konjugation", agreement: "Kongruenz", syntax: "Syntax", vocabulary: "Wortschatz", style: "Stil", punctuation: "Zeichensetzung", faithfulness: "Quellentreue" },
  zh: { grammar: "语法", spelling: "拼写", conjugation: "变位", agreement: "配合", syntax: "句法", vocabulary: "词汇", style: "风格", punctuation: "标点", faithfulness: "忠于原文" },
};

/** Localized short label for a correction category (grammar, spelling, …). */
export function correctionCategoryLabel(target: LangCode, kind: CategoryKind): string {
  return CORRECTION_CATEGORY_LABELS[target]?.[kind] ?? CORRECTION_CATEGORY_LABELS.fr[kind];
}

const EXERCISE_TYPE_LABELS: Record<LangCode, Record<string, string>> = {
  fr: { qcm: "QCM", fill: "Texte à trous", translation: "Traduction", sentence: "Construction de phrase", synonyms: "Synonymes", conjugation: "Conjugaison", reformulation: "Reformulation", register: "Registre", error_detection: "Détection d'erreur", word_formation: "Formation de mots", collocation: "Collocation" },
  en: { qcm: "MCQ", fill: "Fill in the blanks", translation: "Translation", sentence: "Sentence building", synonyms: "Synonyms", conjugation: "Conjugation", reformulation: "Rephrasing", register: "Register", error_detection: "Error detection", word_formation: "Word formation", collocation: "Collocation" },
  de: { qcm: "MC", fill: "Lückentext", translation: "Übersetzung", sentence: "Satzbau", synonyms: "Synonyme", conjugation: "Konjugation", reformulation: "Umformulierung", register: "Register", error_detection: "Fehlererkennung", word_formation: "Wortbildung", collocation: "Kollokation" },
  zh: { qcm: "选择题", fill: "填空", translation: "翻译", sentence: "造句", synonyms: "同义词", conjugation: "动词变位", reformulation: "改写", register: "语域", error_detection: "改错", word_formation: "构词", collocation: "搭配" },
};

/** Localized badge label for an exercise type, keyed by target language. */
export function typeLabels(target: LangCode): Record<string, string> {
  return EXERCISE_TYPE_LABELS[target] ?? EXERCISE_TYPE_LABELS.fr;
}

type ApiMessageKey =
  | "invalid_body"
  | "text_missing"
  | "word_missing"
  | "source_missing"
  | "sentence_missing"
  | "fields_missing"
  | "ai_error"
  | "quota"
  | "eval_unavailable";

const API_MESSAGES: Record<LangCode, Record<ApiMessageKey, string>> = {
  fr: {
    invalid_body: "Corps de requête invalide.",
    text_missing: "Texte manquant.",
    word_missing: "Mot manquant.",
    source_missing: "Source manquante.",
    sentence_missing: "Phrase manquante.",
    fields_missing: "Champs manquants.",
    ai_error: "Erreur IA.",
    quota: "Quota IA dépassé — réessayez plus tard.",
    eval_unavailable: "Évaluation indisponible.",
  },
  en: {
    invalid_body: "Invalid request body.",
    text_missing: "Text missing.",
    word_missing: "Word missing.",
    source_missing: "Source missing.",
    sentence_missing: "Sentence missing.",
    fields_missing: "Missing fields.",
    ai_error: "AI error.",
    quota: "AI quota exceeded — try again later.",
    eval_unavailable: "Evaluation unavailable.",
  },
  de: {
    invalid_body: "Ungültiger Anfragekörper.",
    text_missing: "Text fehlt.",
    word_missing: "Wort fehlt.",
    source_missing: "Quelle fehlt.",
    sentence_missing: "Satz fehlt.",
    fields_missing: "Felder fehlen.",
    ai_error: "KI-Fehler.",
    quota: "KI-Kontingent überschritten — versuchen Sie es später erneut.",
    eval_unavailable: "Auswertung nicht verfügbar.",
  },
  zh: {
    invalid_body: "请求正文无效。",
    text_missing: "缺少文本。",
    word_missing: "缺少单词。",
    source_missing: "缺少来源。",
    sentence_missing: "缺少句子。",
    fields_missing: "缺少字段。",
    ai_error: "AI 错误。",
    quota: "AI 配额已超出 — 请稍后重试。",
    eval_unavailable: "评估不可用。",
  },
};

/** Localized server-side error/notice text for API routes, per target language. */
export function apiMessage(target: LangCode, key: ApiMessageKey): string {
  return API_MESSAGES[target]?.[key] ?? API_MESSAGES.fr[key];
}
