"use client";

import { X } from "lucide-react";
import { useSettings } from "@/lib/settings";
import { UI_LANGUAGES, TARGET_LANGUAGES, TRANSLATION_LANGUAGES } from "@/lib/languages";
import { Field, LangSelect, LevelPicker } from "@/components/LanguagePickers";

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    uiLocale,
    targetLang,
    translationLang,
    level,
    setUiLocale,
    setTargetLang,
    setTranslationLang,
    setLevel,
    t,
  } = useSettings();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#171B22]/90 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[#F4EEE0] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="cj-display text-2xl text-[#262220]">{t("settings.title", "Paramètres")}</h2>
          <button
            onClick={onClose}
            aria-label={t("settings.close", "Fermer")}
            className="rounded-full p-1 text-[#6b665e] transition hover:bg-[#26222011] hover:text-[#262220]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <Field label={t("settings.ui", "Langue de l'interface")}>
            <LangSelect value={uiLocale} onChange={setUiLocale} options={UI_LANGUAGES} />
          </Field>
          <Field label={t("settings.target", "Langue à apprendre")}>
            <LangSelect value={targetLang} onChange={setTargetLang} options={TARGET_LANGUAGES} />
          </Field>
          <Field label={t("settings.translation", "Langue de traduction")}>
            <LangSelect
              value={translationLang}
              onChange={setTranslationLang}
              options={TRANSLATION_LANGUAGES}
            />
          </Field>
          <Field label={t("settings.level", "Niveau")}>
            <LevelPicker value={level} onChange={setLevel} />
          </Field>
        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full rounded-full bg-[#5C7A5A] py-3 text-sm font-medium text-white shadow-lg transition hover:bg-[#4f6b4e]"
        >
          {t("settings.done", "Terminé")}
        </button>
      </div>
    </div>
  );
}
