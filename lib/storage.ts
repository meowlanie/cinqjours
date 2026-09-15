// Shared localStorage plumbing. localStorage has a ~5MB per-origin quota; once
// it fills up, setItem() throws QuotaExceededError and the write is dropped.
// Historically every call site swallowed that error, so data could silently
// "vanish" after the quota was hit. This module centralises writing, cache
// recovery and notification so a full store is visible to the user instead of
// failing in silence.

export const STORAGE_FULL_KEY = "cj-storage-full";
export const STORAGE_ERROR_EVENT = "cj-storage-error";

export const DICT_CACHE_KEY = "cj-dict-cache";
export const TRANS_CACHE_KEY = "cj-trans-cache";

// Keys confirmed dead (nothing in the codebase reads them). Removed once.
export const LS_CLEANUP_V1 = "cj-cleanup-v1";
const DEAD_KEYS = ["cj-text-journal", "cj-carnet-lang-migrated", "cj-frdic-enabled"];
const DAYSTATE_PREFIX = "cj-daystate-";
const DAYSTATE_ACTIVE = "cj-daystate-migrated";

export function isQuotaError(e: unknown): boolean {
  const name = e instanceof Error ? e.name : (e as { name?: string } | null)?.name;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
}

/** Drop regenerable caches to make room. Safe: they rebuild from the network. */
export function recoverStorageSpace() {
  for (const k of [DICT_CACHE_KEY, TRANS_CACHE_KEY]) {
    try { window.localStorage.removeItem(k); } catch { /* ignore */ }
  }
}

export function markStorageFull() {
  try { window.localStorage.setItem(STORAGE_FULL_KEY, "1"); } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(STORAGE_ERROR_EVENT)); } catch { /* ignore */ }
}

export function readStorageFullFlag(): boolean {
  try { return !!window.localStorage.getItem(STORAGE_FULL_KEY); } catch { return false; }
}

export function clearStorageFullFlag() {
  try { window.localStorage.removeItem(STORAGE_FULL_KEY); } catch { /* ignore */ }
}

/**
 * Persist a raw string. On a quota error it drops the disposable caches and
 * retries once; if it still fails the store is flagged as full so the UI can
 * warn the user instead of losing the write silently.
 */
export function writeLs(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (!isQuotaError(e)) return false;
    recoverStorageSpace();
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e2) {
      if (isQuotaError(e2)) markStorageFull();
      return false;
    }
  }
}

export function removeLs(key: string) {
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
}

/** Keep only the `max` oldest-inserted entries of a string-keyed map. */
export function capEntries<T>(obj: Record<string, T>, max: number): Record<string, T> {
  const keys = Object.keys(obj);
  if (keys.length <= max) return obj;
  const out: Record<string, T> = {};
  for (const k of keys.slice(0, max)) out[k] = obj[k];
  return out;
}

/** One-time removal of confirmed-dead keys and orphaned day-state blobs. */
export function cleanupDeadKeys() {
  try {
    if (window.localStorage.getItem(LS_CLEANUP_V1)) return;
    for (const k of DEAD_KEYS) removeLs(k);
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(DAYSTATE_PREFIX) && k !== DAYSTATE_ACTIVE) removeLs(k);
    }
    window.localStorage.setItem(LS_CLEANUP_V1, "1");
  } catch { /* ignore */ }
}

/* ---------------------------------------------------------------
   BACKUP — export / import everything the app stores locally.
   localStorage plus the two IndexedDB stores (resources + journal audio).
--------------------------------------------------------------- */

export interface BackupPayload {
  version: 1;
  exportedAt: string;
  localStorage: Record<string, string>;
  resources: Record<string, unknown>[];
  journalAudio: Record<string, string>;
}

function openDb(name: string, store: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function collectBackup(): Promise<BackupPayload> {
  const localStorage: Record<string, string> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k === null) continue;
      localStorage[k] = window.localStorage.getItem(k) ?? "";
    }
  } catch { /* ignore */ }

  let resources: Record<string, unknown>[] = [];
  try {
    const db = await openDb("cjq", "resources");
    resources = await new Promise((resolve) => {
      const tx = db.transaction("resources", "readonly");
      const req = tx.objectStore("resources").get("all");
      req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as Record<string, unknown>[]) : []);
      req.onerror = () => resolve([]);
    });
    db.close();
  } catch { /* ignore */ }

  let journalAudio: Record<string, string> = {};
  try {
    const db = await openDb("cj-journal-audio", "audio");
    journalAudio = await new Promise((resolve) => {
      const out: Record<string, string> = {};
      const tx = db.transaction("audio", "readonly");
      const cursor = tx.objectStore("audio").openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          out[String(c.key)] = typeof c.value === "string" ? c.value : "";
          c.continue();
        }
      };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => resolve(out);
      tx.onabort = () => resolve(out);
    });
    db.close();
  } catch { /* ignore */ }

  return { version: 1, exportedAt: new Date().toISOString(), localStorage, resources, journalAudio };
}

export async function restoreBackup(payload: BackupPayload): Promise<void> {
  if (!payload || typeof payload !== "object" || !payload.localStorage) return;

  for (const [k, v] of Object.entries(payload.localStorage)) {
    if (typeof v !== "string") continue;
    try { window.localStorage.setItem(k, v); } catch { /* ignore */ }
  }
  clearStorageFullFlag();

  if (Array.isArray(payload.resources)) {
    try {
      const db = await openDb("cjq", "resources");
      await new Promise<void>((resolve) => {
        const tx = db.transaction("resources", "readwrite");
        tx.objectStore("resources").put(payload.resources, "all");
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
      db.close();
    } catch { /* ignore */ }
  }

  const audio = payload.journalAudio ?? {};
  if (Object.keys(audio).length > 0) {
    try {
      const db = await openDb("cj-journal-audio", "audio");
      await new Promise<void>((resolve) => {
        const tx = db.transaction("audio", "readwrite");
        const store = tx.objectStore("audio");
        for (const [k, v] of Object.entries(audio)) store.put(v, k);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
      db.close();
    } catch { /* ignore */ }
  }
}
