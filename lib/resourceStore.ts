// IndexedDB-backed store for resources. localStorage has a ~5MB quota that
// fills up fast once video transcripts are stored, silently dropping the newest
// resource on refresh. IndexedDB has a much larger quota, so use it as the
// canonical local store.

const DB_NAME = "cjq";
const DB_VERSION = 1;
const STORE = "resources";
const KEY = "all";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadResourceStore(): Promise<Record<string, unknown>[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as Record<string, unknown>[]) : []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function saveResourceStore(resources: Record<string, unknown>[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(resources, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* storage unavailable */
  }
}
