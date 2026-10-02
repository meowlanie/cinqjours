"use client";

import { useState, useEffect, type ReactNode } from "react";
import { useSettings } from "@/lib/settings";
import {
  UI_LANGUAGES,
  TARGET_LANGUAGES,
  TRANSLATION_LANGUAGES,
  LEVELS,
  type LangCode,
  type Level,
} from "@/lib/languages";

type TFn = (key: string, fallback: string) => string;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      {children}
    </div>
  );
}

function LangSelect({
  value,
  onChange,
  options,
  t,
}: {
  value: LangCode;
  onChange: (l: LangCode) => void;
  options: LangCode[];
  t: TFn;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`rounded-lg border px-3 py-1.5 text-sm transition ${
            value === o
              ? "border-[#B08D57] bg-[#B08D5733] text-[var(--text)]"
              : "border-[var(--border-strong)] text-[var(--text-muted)] hover:border-[var(--border-strong)]"
          }`}
        >
          {t(`lang.${o}`, o)}
        </button>
      ))}
    </div>
  );
}

export function OnboardingModal() {
  const { onboarded, completeOnboarding, t } = useSettings();
  const [ui, setUi] = useState<LangCode>("en");
  const [target, setTarget] = useState<LangCode>("en");
  const [trans, setTrans] = useState<LangCode>("en");
  const [level, setLevel] = useState<Level>("advanced");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  if (onboarded) return null;

  const tp: TFn = (key, fallback) => t(key, fallback, ui);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--scrim-strong)] p-4">
      <div className="w-full max-w-md rounded-2xl bg-[var(--primary-text)] p-6 shadow-2xl">
        <h2 className="cj-display text-2xl text-[var(--text)]">{tp("onboarding.title", "Welcome to Cinq jours")}</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{tp("onboarding.subtitle", "A five-day language learning routine that turns your favourite content into a structured curriculum.")}</p>

        <div className="mt-5 space-y-4">
          <Field label={tp("onboarding.ui", "Langue de l'interface")}>
            <LangSelect value={ui} onChange={setUi} options={UI_LANGUAGES} t={tp} />
          </Field>
          <Field label={tp("onboarding.target", "Langue à apprendre")}>
            <LangSelect value={target} onChange={setTarget} options={TARGET_LANGUAGES} t={tp} />
          </Field>
          <Field label={tp("onboarding.translation", "Langue de traduction")}>
            <LangSelect value={trans} onChange={setTrans} options={TRANSLATION_LANGUAGES} t={tp} />
          </Field>
          <Field label={tp("onboarding.level", "Niveau")}>
            <div className="flex gap-2">
              {LEVELS.map((lv) => (
                <button
                  key={lv}
                  onClick={() => setLevel(lv)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-sm transition ${
                    level === lv
                      ? "border-[#B08D57] bg-[#B08D5733] text-[var(--text)]"
                      : "border-[var(--border-strong)] text-[var(--text-muted)] hover:border-[var(--border-strong)]"
                  }`}
                >
                  {tp(`level.${lv}`, lv)}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <button
          onClick={() =>
            completeOnboarding({
              uiLocale: ui,
              targetLang: target,
              translationLang: trans,
              level,
            })
          }
          className="mt-6 w-full rounded-full bg-[var(--accent)] py-3 text-sm font-medium text-[var(--text)] shadow-lg transition hover:bg-[var(--accent-hover)]"
        >
          {tp("onboarding.continue", "Let's Begin")}
        </button>
      </div>
    </div>
  );
}
