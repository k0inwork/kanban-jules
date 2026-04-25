import { LlmLevel } from './llm-levels';

export interface ShadowLogEntry {
  id?: number;
  timestamp: number;
  level: LlmLevel;
  programId: string;
  prompt: string;
  localResult: string;
  apiResult: string;
  agree: boolean;
}

const STORE = 'paw_shadow_log';

function getDb(): IDBDatabase | null {
  return (globalThis as any).__pawShadowDb || null;
}

async function ensureDb(): Promise<IDBDatabase> {
  const existing = getDb();
  if (existing) return existing;

  return new Promise((resolve, reject) => {
    const req = indexedDB.open('paw_shadow', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('programId', 'programId');
        store.createIndex('agree', 'agree');
        store.createIndex('timestamp', 'timestamp');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      (globalThis as any).__pawShadowDb = db;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Shadow mode: after a local (PAW/WebLLM) call completes, also run the API
 * call in the background and log whether they agree. Non-blocking, fire-and-forget.
 */
export async function shadowLog(
  level: LlmLevel,
  programId: string,
  prompt: string,
  localResult: string,
  apiCaller: (prompt: string, jsonMode?: boolean) => Promise<string>
): Promise<void> {
  try {
    const apiResult = await apiCaller(prompt);
    const agree = localResult.trim().toLowerCase() === apiResult.trim().toLowerCase();

    const entry: ShadowLogEntry = {
      timestamp: Date.now(),
      level,
      programId,
      prompt: prompt.substring(0, 2000), // cap size
      localResult: localResult.substring(0, 500),
      apiResult: apiResult.substring(0, 500),
      agree,
    };

    const db = await ensureDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(entry);
  } catch {
    // Shadow mode failures must never affect the caller
  }
}

/** Query shadow log for a program — returns disagreements first */
export async function getShadowLog(
  programId?: string,
  opts?: { onlyDisagreements?: boolean; limit?: number }
): Promise<ShadowLogEntry[]> {
  const db = await ensureDb();
  const tx = db.transaction(STORE, 'readonly');
  const store = tx.objectStore(STORE);

  return new Promise((resolve, reject) => {
    const results: ShadowLogEntry[] = [];
    const req = store.openCursor(null, 'prev'); // newest first

    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(results);
        return;
      }

      const entry = cursor.value as ShadowLogEntry;
      const matchesProgram = !programId || entry.programId === programId;
      const matchesAgreement = !opts?.onlyDisagreements || !entry.agree;

      if (matchesProgram && matchesAgreement) {
        results.push(entry);
      }

      if (opts?.limit && results.length >= opts.limit) {
        resolve(results);
        return;
      }

      cursor.continue();
    };

    req.onerror = () => reject(req.error);
  });
}

/** Get agreement stats for a program */
export async function getShadowStats(programId: string): Promise<{
  total: number;
  agreements: number;
  disagreements: number;
  agreementRate: number;
}> {
  const entries = await getShadowLog(programId);
  const agreements = entries.filter(e => e.agree).length;
  return {
    total: entries.length,
    agreements,
    disagreements: entries.length - agreements,
    agreementRate: entries.length > 0 ? agreements / entries.length : 0,
  };
}
