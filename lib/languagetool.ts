export interface LTMatch {
  offset: number;
  length: number;
  message: string;
  replacements: { value: string }[];
  context: { text: string; offset: number; length: number };
  rule: { id: string; description: string; category: { id: string; name: string } };
}

/** Map a target language to the LanguageTool language code. Returns null if unsupported. */
export function ltLangCode(lang: string): string | null {
  switch (lang) {
    case "fr":
      return "fr";
    case "en":
      return "en-US";
    case "de":
      return "de-DE";
    case "zh":
      return "zh";
    default:
      return null;
  }
}

export async function checkText(text: string, lang: string): Promise<LTMatch[]> {
  const language = ltLangCode(lang);
  if (!language) throw new Error(`LanguageTool non supporté pour "${lang}".`);
  const res = await fetch("https://api.languagetool.org/v2/check", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ text, language }),
  });
  if (!res.ok) throw new Error(`LanguageTool error (${res.status})`);
  const data = await res.json();
  return data.matches || [];
}

/** Backwards-compatible French alias. */
export async function checkFrenchText(text: string): Promise<LTMatch[]> {
  return checkText(text, "fr");
}
