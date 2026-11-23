"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import fr from "@/locales/fr.json";
import en from "@/locales/en.json";
import de from "@/locales/de.json";
import zh from "@/locales/zh.json";
import {
  type LangCode,
  type Level,
  UI_LANGUAGES,
  TARGET_LANGUAGES,
  TRANSLATION_LANGUAGES,
  LEVELS,
} from "@/lib/languages";

type Dict = Record<string, string>;
const DICTS: Partial<Record<LangCode, Dict>> = { fr, en, de, zh };

// Synced copy of the active UI locale so that the standalone `t()` below works
// in any component without requiring each one to subscribe to the context.
let currentUiLocale: LangCode = "en";
let currentTargetLang: LangCode = "en";
let currentTranslationLang: LangCode = "en";

/** Read the active target/translation languages from anywhere (e.g. fetch calls). */
export function getLangCodes(): { targetLang: LangCode; translationLang: LangCode } {
  return { targetLang: currentTargetLang, translationLang: currentTranslationLang };
}

/** Read the active UI locale from anywhere (e.g. date formatting). */
export function getUiLocale(): LangCode {
  return currentUiLocale;
}

const LS = {
  ui: "cj-lang",
  target: "cj-target-lang",
  trans: "cj-translate-lang",
  transOverride: "cj-trans-override",
  level: "cj-level",
  onboarded: "cj-onboarded",
};

function readLs<T extends string>(key: string, valid: T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key);
    if (v && (valid as string[]).includes(v)) return v as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

/**
 * Translate a UI string. `fallback` is the French (or current) source text and
 * is shown when the active locale has no translation — so the UI never breaks.
 * Pass `locale` to override (used by the onboarding preview).
 */
export function t(key: string, fallback: string, locale?: LangCode): string {
  const loc = locale ?? currentUiLocale;
  const dict = DICTS[loc];
  if (dict && typeof dict[key] === "string") return dict[key] as string;
  return fallback;
}

export interface SettingsValue {
  uiLocale: LangCode;
  targetLang: LangCode;
  translationLang: LangCode;
  level: Level;
  onboarded: boolean;
  t: (key: string, fallback: string, locale?: LangCode) => string;
  setUiLocale: (l: LangCode) => void;
  setTargetLang: (l: LangCode) => void;
  setTranslationLang: (l: LangCode) => void;
  setLevel: (l: Level) => void;
  completeOnboarding: (s: {
    uiLocale: LangCode;
    targetLang: LangCode;
    translationLang: LangCode;
    level: Level;
  }) => void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

// Persisted settings live in localStorage, which the server cannot read. If we
// loaded them in a `useState` initializer, the first client render would differ
// from the server render (e.g. French vs English) and React would throw a
// hydration mismatch. Instead, state starts at the same defaults the server
// uses, and the stored values are applied in a layout effect right after
// hydration — before paint, so there is no visible language flash.
function readOnboarded(): boolean {
  try {
    return window.localStorage.getItem(LS.onboarded) === "1";
  } catch {
    return false;
  }
}

// useLayoutEffect logs a warning when a component is server-rendered; on the
// server fall back to useEffect (which never runs there anyway).
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [uiLocale, setUi] = useState<LangCode>("en");
  const [targetLang, setTarget] = useState<LangCode>("en");
  const [translationLang, setTrans] = useState<LangCode>("en");
  const [level, setLvl] = useState<Level>("advanced");
  const [onboarded, setOnboarded] = useState<boolean>(false);

  const hasLoadedRef = useRef(false);
  useIsomorphicLayoutEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    const ui = readLs(LS.ui, UI_LANGUAGES, "en");
    const target = readLs(LS.target, TARGET_LANGUAGES, "en");
    const trans = readLs(LS.trans, TRANSLATION_LANGUAGES, "en");
    // Update the mirrors here (not in a passive effect) so they hold the loaded
    // locale before the re-render these setters trigger; the standalone `t()`
    // then reads the right value. Setters keep the mirrors in sync afterwards.
    currentUiLocale = ui;
    currentTargetLang = target;
    currentTranslationLang = trans;
    setUi(ui);
    setTarget(target);
    setTrans(trans);
    setLvl(readLs(LS.level, LEVELS, "advanced"));
    setOnboarded(readOnboarded());
  }, []);

  useEffect(() => {
    document.documentElement.lang = uiLocale;
  }, [uiLocale]);

  const setUiLocale = useCallback((l: LangCode) => {
    setUi(l);
    currentUiLocale = l;
    try {
      window.localStorage.setItem(LS.ui, l);
      // Translation follows the UI language unless explicitly overridden.
      if (window.localStorage.getItem(LS.transOverride) !== "1") {
        setTrans(l);
        currentTranslationLang = l;
        window.localStorage.setItem(LS.trans, l);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setTargetLang = useCallback((l: LangCode) => {
    setTarget(l);
    currentTargetLang = l;
    try {
      window.localStorage.setItem(LS.target, l);
    } catch {
      /* ignore */
    }
  }, []);

  const setTranslationLang = useCallback((l: LangCode) => {
    setTrans(l);
    currentTranslationLang = l;
    try {
      window.localStorage.setItem(LS.trans, l);
      window.localStorage.setItem(LS.transOverride, "1");
    } catch {
      /* ignore */
    }
  }, []);

  const setLevel = useCallback((l: Level) => {
    setLvl(l);
    try {
      window.localStorage.setItem(LS.level, l);
    } catch {
      /* ignore */
    }
  }, []);

  const completeOnboarding = useCallback(
    (s: {
      uiLocale: LangCode;
      targetLang: LangCode;
      translationLang: LangCode;
      level: Level;
    }) => {
      setUi(s.uiLocale);
      setTarget(s.targetLang);
      setTrans(s.translationLang);
      setLvl(s.level);
      currentUiLocale = s.uiLocale;
      currentTargetLang = s.targetLang;
      currentTranslationLang = s.translationLang;
      setOnboarded(true);
      try {
        window.localStorage.setItem(LS.ui, s.uiLocale);
        window.localStorage.setItem(LS.target, s.targetLang);
        window.localStorage.setItem(LS.trans, s.translationLang);
        window.localStorage.setItem(LS.level, s.level);
        window.localStorage.setItem(LS.onboarded, "1");
        window.localStorage.setItem(
          LS.transOverride,
          s.translationLang === s.uiLocale ? "0" : "1"
        );
      } catch {
        /* ignore */
      }
    },
    []
  );

  return (
    <SettingsContext.Provider
      value={{
        uiLocale,
        targetLang,
        translationLang,
        level,
        onboarded,
        t,
        setUiLocale,
        setTargetLang,
        setTranslationLang,
        setLevel,
        completeOnboarding,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within a SettingsProvider");
  return ctx;
}
