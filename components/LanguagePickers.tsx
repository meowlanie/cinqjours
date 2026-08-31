"use client";

import { type ReactNode } from "react";
import {
  UI_LANGUAGES,
  TARGET_LANGUAGES,
  TRANSLATION_LANGUAGES,
  LEVELS,
  type LangCode,
  type Level,
} from "@/lib/languages";
import { t } from "@/lib/settings";

type TFn = (key: string, fallback: string) => string;

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-[#6b665e]">{label}</p>
      {children}
    </div>
  );
}

export function LangSelect({
  value,
  onChange,
  options,
}: {
  value: LangCode;
  onChange: (l: LangCode) => void;
  options: LangCode[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`rounded-lg border px-3 py-1.5 text-sm transition ${
            value === o
              ? "border-[#B08D57] bg-[#B08D5733] text-[#262220]"
              : "border-[#26222022] text-[#6b665e] hover:border-[#26222044]"
          }`}
        >
          {t(`lang.${o}`, o)}
        </button>
      ))}
    </div>
  );
}

export function LevelPicker({
  value,
  onChange,
}: {
  value: Level;
  onChange: (l: Level) => void;
}) {
  return (
    <div className="flex gap-2">
      {LEVELS.map((lv) => (
        <button
          key={lv}
          onClick={() => onChange(lv)}
          className={`flex-1 rounded-lg border px-2 py-2 text-sm transition ${
            value === lv
              ? "border-[#B08D57] bg-[#B08D5733] text-[#262220]"
              : "border-[#26222022] text-[#6b665e] hover:border-[#26222044]"
          }`}
        >
          {t(`level.${lv}`, lv)}
        </button>
      ))}
    </div>
  );
}

export { UI_LANGUAGES, TARGET_LANGUAGES, TRANSLATION_LANGUAGES };
