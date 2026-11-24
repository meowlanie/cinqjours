"use client";

import { useSettings } from "@/lib/settings";
import { UI_LANGUAGES } from "@/lib/languages";

export function LanguageSwitcher() {
  const { uiLocale, setUiLocale, t } = useSettings();
  return (
    <div
      className="flex h-[29px] items-center gap-0.5 rounded-full border border-[var(--cream-border)] px-1 text-[11px]"
      aria-label={t("settings.ui", "Langue de l'interface")}
    >
      {UI_LANGUAGES.map((l) => (
        <button
          key={l}
          onClick={() => setUiLocale(l)}
          title={t(`lang.${l}`, l)}
          className={`flex h-5 w-8 items-center justify-center rounded-full font-medium leading-none transition ${
            uiLocale === l
              ? "bg-[var(--primary-text)] text-[var(--text-strong)]"
              : "text-[var(--primary-text)] hover:text-[var(--primary-text)]"
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
