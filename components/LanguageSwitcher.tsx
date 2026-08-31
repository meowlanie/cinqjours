"use client";

import { useSettings } from "@/lib/settings";
import { UI_LANGUAGES } from "@/lib/languages";

export function LanguageSwitcher() {
  const { uiLocale, setUiLocale, t } = useSettings();
  return (
    <div
      className="flex items-center gap-0.5 rounded-full border border-[#F4EEE022] px-1 py-0.5 text-xs"
      aria-label={t("settings.ui", "Langue de l'interface")}
    >
      {UI_LANGUAGES.map((l) => (
        <button
          key={l}
          onClick={() => setUiLocale(l)}
          title={t(`lang.${l}`, l)}
          className={`rounded-full px-2 py-0.5 font-medium transition ${
            uiLocale === l
              ? "bg-[#F4EEE0] text-[#171B22]"
              : "text-[#F4EEE0aa] hover:text-[#F4EEE0]"
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
