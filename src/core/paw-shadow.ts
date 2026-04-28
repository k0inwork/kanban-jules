import { LlmLevel } from './llm-levels';

export interface ShadowLogEntry {
  id?: number;
  timestamp: number;
  level: LlmLevel;
  programId: string;
  variantId: string;
  prompt: string;
  localResult: string;
  apiResult: string;
  agree: boolean;
}

const STORE = 'paw_shadow_log';
const MAX_ENTRIES_PER_PROGRAM = 1000;

function getDb(): IDBDatabase | null {
  return (globalThis as any).__pawShadowDb || null;
}

async function ensureDb(): Promise<IDBDatabase> {
  const existing = getDb();
  if (existing) return existing;

  return new Promise((resolve, reject) => {
    const req = indexedDB.open('paw_shadow', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('programId', 'programId');
        store.createIndex('variantId', 'variantId');
        store.createIndex('agree', 'agree');
        store.createIndex('timestamp', 'timestamp');
      }
      // v2: add variantId index if upgrading from v1
      if (db.objectStoreNames.contains(STORE)) {
        const store = req.transaction!.objectStore(STORE);
        if (!store.indexNames.contains('variantId')) {
          store.createIndex('variantId', 'variantId');
        }
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
 * Shadow mode: after a local call completes, also run the API
 * call in the background and log whether they agree. Non-blocking.
 */
export async function shadowLog(
  level: LlmLevel,
  programId: string,
  variantId: string,
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
      variantId,
      prompt: prompt.substring(0, 2000),
      localResult: localResult.substring(0, 500),
      apiResult: apiResult.substring(0, 500),
      agree,
    };

    const db = await ensureDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(entry);

    // GC: prune old entries for this program to cap growth
    pruneProgram(db, programId);
  } catch {
    // Shadow mode failures must never affect the caller
  }
}

/** Keep only the most recent MAX_ENTRIES_PER_PROGRAM entries for a given program */
function pruneProgram(db: IDBDatabase, programId: string): void {
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const index = store.index('programId');
    const countReq = index.count(IDBKeyRange.only(programId));

    countReq.onsuccess = () => {
      if (countReq.result <= MAX_ENTRIES_PER_PROGRAM) return;

      // Collect oldest entries to delete
      const cursorReq = index.openCursor(IDBKeyRange.only(programId));
      let toDelete = countReq.result - MAX_ENTRIES_PER_PROGRAM;
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || toDelete <= 0) return;
        cursor.delete();
        toDelete--;
        cursor.continue();
      };
    };
  } catch {
    // GC failures must never affect the caller
  }
}

/** Query shadow log — filterable by program and/or variant */
export async function getShadowLog(
  programId?: string,
  opts?: { variantId?: string; onlyDisagreements?: boolean; limit?: number }
): Promise<ShadowLogEntry[]> {
  const db = await ensureDb();
  const tx = db.transaction(STORE, 'readonly');
  const store = tx.objectStore(STORE);

  return new Promise((resolve, reject) => {
    const results: ShadowLogEntry[] = [];
    const req = store.openCursor(null, 'prev');

    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(results);
        return;
      }

      const entry = cursor.value as ShadowLogEntry;
      const matchesProgram = !programId || entry.programId === programId;
      const matchesVariant = !opts?.variantId || entry.variantId === opts.variantId;
      const matchesAgreement = !opts?.onlyDisagreements || !entry.agree;

      if (matchesProgram && matchesVariant && matchesAgreement) {
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

/** Get agreement stats for a program, optionally filtered by variant */
export async function getShadowStats(
  programId: string,
  variantId?: string
): Promise<{
  total: number;
  agreements: number;
  disagreements: number;
  agreementRate: number;
}> {
  const entries = await getShadowLog(programId, { variantId });
  const agreements = entries.filter(e => e.agree).length;
  return {
    total: entries.length,
    agreements,
    disagreements: entries.length - agreements,
    agreementRate: entries.length > 0 ? agreements / entries.length : 0,
  };
}

/** Get per-variant breakdown for a program */
export async function getVariantStats(
  programId: string
): Promise<Record<string, { total: number; agreementRate: number }>> {
  const entries = await getShadowLog(programId);
  const byVariant: Record<string, { agreements: number; total: number }> = {};

  for (const entry of entries) {
    const vid = entry.variantId || 'unknown';
    if (!byVariant[vid]) byVariant[vid] = { agreements: 0, total: 0 };
    byVariant[vid].total++;
    if (entry.agree) byVariant[vid].agreements++;
  }

  const result: Record<string, { total: number; agreementRate: number }> = {};
  for (const [vid, s] of Object.entries(byVariant)) {
    result[vid] = {
      total: s.total,
      agreementRate: s.total > 0 ? s.agreements / s.total : 0,
    };
  }
  return result;
}
