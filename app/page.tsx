"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { loadResources, saveResources, supabaseConfigured } from "@/lib/supabase";
import { loadResourceStore, saveResourceStore } from "@/lib/resourceStore";
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
    let cancelled = false;
    (async () => {
      // Primary local store is IndexedDB (large quota). Migrate any legacy
      // localStorage data once so existing resources aren't lost.
      let local = await loadResourceStore();
      if (local.length === 0) {
        const legacy = readLs<Record<string, unknown>[]>(LS_RESOURCES, []);
        if (legacy.length > 0) {
          local = legacy;
          await saveResourceStore(legacy);
          try {
            window.localStorage.removeItem(LS_RESOURCES);
          } catch {
            /* ignore */
          }
        }
      }
      const remote = supabaseConfigured ? await loadResources() : null;
      if (cancelled) return;
      if (remote && remote.length > 0) {
        // Supabase is canonical. Merge any local-only entries (e.g. added while
        // offline) so nothing is lost on refresh.
        const byId = new Map<string, Record<string, unknown>>();
        for (const r of remote) byId.set(String(r.video_id), r);
        for (const r of local) {
          const id = String(r.video_id);
          if (!byId.has(id)) byId.set(id, r);
        }
        setResources(Array.from(byId.values()));
      } else if (local.length > 0) {
        setResources(local);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistResources: Dispatch<SetStateAction<Record<string, unknown>[]>> = (next) => {
    setResources((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      void saveResourceStore(resolved);
      try {
        window.localStorage.setItem(LS_RESOURCES, JSON.stringify(resolved));
      } catch {
        /* best-effort cache only; IndexedDB is the source of truth */
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
