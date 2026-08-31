"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { loadResources, saveResources } from "@/lib/supabase";
import { CinqJoursApp } from "@/components/CinqJoursApp";
import { SettingsProvider } from "@/lib/settings";
import { OnboardingModal } from "@/components/OnboardingModal";

const LS_RESOURCES = "cj-resources";
const LS_VOCAB = "cj-vocab";

function readLs<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function Page() {
  const [resources, setResources] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    const local = readLs<Record<string, unknown>[]>(LS_RESOURCES, []);
    if (local.length > 0) {
      setResources(local);
      return;
    }
    (async () => {
      const remote = await loadResources();
      if (remote && remote.length > 0) setResources(remote);
    })();
  }, []);

  const persistResources: Dispatch<SetStateAction<Record<string, unknown>[]>> = (next) => {
    setResources((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      try {
        window.localStorage.setItem(LS_RESOURCES, JSON.stringify(resolved));
      } catch {
        // storage full or blocked
      }
      void saveResources(resolved);
      return resolved;
    });
  };

  return (
    <SettingsProvider>
      <CinqJoursApp
        resources={resources}
        setResources={persistResources}
        lsKey={LS_VOCAB}
      />
      <OnboardingModal />
    </SettingsProvider>
  );
}
