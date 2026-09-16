"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { X, Download, Save, Loader2 } from "lucide-react";
import { useSettings } from "@/lib/settings";
import { UI_LANGUAGES, TARGET_LANGUAGES, TRANSLATION_LANGUAGES } from "@/lib/languages";
import { Field, LangSelect, LevelPicker } from "@/components/LanguagePickers";
import { collectBackup, restoreBackup, type BackupPayload } from "@/lib/storage";

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
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);

  const handleExport = async () => {
    if (busy) return;
    setBusy("export");
    try {
      const payload = await collectBackup();
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cinq-jours-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  };

  const handleImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) return;
    try {
      const payload = JSON.parse(await file.text()) as BackupPayload;
      if (!payload || typeof payload !== "object" || !payload.localStorage) throw new Error("bad payload");
      if (!window.confirm(t("v265", "Importing replaces your current data. Continue?"))) return;
      setBusy("import");
      await restoreBackup(payload);
      window.location.reload();
    } catch {
      window.alert(t("v266", "Invalid backup file."));
      setBusy(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#262220]/70 p-4"
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
          <Field label={t("v261", "Données")}>
            <div className="flex gap-2">
              <button
                onClick={handleExport}
                disabled={!!busy}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--background)] py-2.5 text-sm font-medium text-[var(--primary-text)] shadow transition hover:bg-[var(--background-hover)] disabled:opacity-60"
              >
                {busy === "export" ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {t("v262", "Exporter mes données")}
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={!!busy}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--accent)] py-2.5 text-sm font-medium text-[#262220] shadow transition hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                {busy === "import" ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                {t("v263", "Importer mes données")}
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImportFile}
            />
          </Field>
        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full rounded-full bg-[var(--background)] py-3 text-sm font-medium text-[var(--primary-text)] shadow-lg transition hover:bg-[var(--background-hover)]"
        >
          {t("settings.done", "Terminé")}
        </button>
      </div>
    </div>
  );
}
