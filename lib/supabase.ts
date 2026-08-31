"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;
if (url && anonKey) {
  client = createClient(url, anonKey);
}

export function getSupabase(): SupabaseClient | null {
  return client;
}

export const supabaseConfigured = Boolean(client);

export async function saveResource(record: Record<string, unknown>) {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from("resources").upsert(record, { onConflict: "video_id" });
  return !error;
}

export async function saveResources(records: Record<string, unknown>[]) {
  const sb = getSupabase();
  if (!sb) return false;
  if (records.length === 0) return true;
  const { error } = await sb.from("resources").upsert(records, { onConflict: "video_id" });
  return !error;
}

export async function loadResources(): Promise<Record<string, unknown>[] | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from("resources").select("*").order("date", { ascending: false });
  if (error) return null;
  return data;
}

export async function saveVocab(records: string[]) {
  const sb = getSupabase();
  if (!sb) return false;
  if (records.length === 0) return true;
  const { error } = await sb.from("vocab").upsert(
    records.map((json, i) => {
      let id = `vocab-${i}`;
      try {
        const parsed = JSON.parse(json) as { word?: string };
        if (parsed?.word) id = `vocab-${String(parsed.word).toLowerCase()}`;
      } catch {
        // keep position-based id
      }
      return { id, payload: json, position: i };
    })
  );
  return !error;
}