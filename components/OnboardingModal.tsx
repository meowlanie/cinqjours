"use client";

import { useState, type ReactNode } from "react";
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
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-[#6b665e]">{label}</p>
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

export function OnboardingModal() {
  const { onboarded, completeOnboarding, t } = useSettings();
  const [ui, setUi] = useState<LangCode>("fr");
  const [target, setTarget] = useState<LangCode>("fr");
  const [trans, setTrans] = useState<LangCode>("fr");
  const [level, setLevel] = useState<Level>("advanced");

  // Never render during SSR — the persisted `onboarded` flag is only known on
  // the client, so painting the modal server-side would make it flash on every
  // load for returning users (the "language setting" flash). Client renders it
  // normally for first-time visitors.
  if (typeof window === "undefined") return null;
  if (onboarded) return null;

  const tp: TFn = (key, fallback) => t(key, fallback, ui);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#171B22]/90 p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#F4EEE0] p-6 shadow-2xl">
        <h2 className="cj-display text-2xl text-[#262220]">{tp("onboarding.title", "Bienvenue dans Cinq jours")}</h2>
        <p className="mt-1 text-sm text-[#6b665e]">{tp("onboarding.subtitle", "Choisissez vos langues pour commencer")}</p>

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
                      ? "border-[#B08D57] bg-[#B08D5733] text-[#262220]"
                      : "border-[#26222022] text-[#6b665e] hover:border-[#26222044]"
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
          className="mt-6 w-full rounded-full bg-[#5C7A5A] py-3 text-sm font-medium text-white shadow-lg transition hover:bg-[#4f6b4e]"
        >
          {tp("onboarding.continue", "Commencer")}
        </button>
      </div>
    </div>
  );
}
