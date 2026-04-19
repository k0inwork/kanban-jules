/**
 * VFS — direct IndexedDB access to v86's IDBFS overlay.
 *
 * v86 uses cowfs (copy-on-write) with an IDBFS overlay on top of a tarfs base.
 * This service reads/writes the IDBFS overlay directly from JS, skipping
 * the Go WASM bridge for simple operations.
 *
 * IDBFS database: "wanix-env"
 * Object store:   "files"
 * Record format:  { path, data (Uint8Array), isDir, mode, modTime, symlinkTarget? }
 *
 * Path format: IDB records use fs.ValidPath format (no leading /).
 *   JS "/tmp/foo" → IDB key "tmp/foo"
 *   JS "/home/user/file" → IDB key "home/user/file"
 *
 * For reads that MISS (file only in tarfs base, not in overlay),
 * falls back to boardVM.fsBridge.
 */

type IDBRecord = {
  path: string;
  data?: Uint8Array | string;
  isDir: boolean;
  mode: number;
  modTime: number;
  symlinkTarget?: string;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('wanix-env', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'path' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    req.onblocked = () => {
      dbPromise = null;
      reject(new Error('IDB open blocked'));
    };
  });
  return dbPromise;
}

function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDB().then(db => db.transaction('files', mode).objectStore('files'));
}

function awaitRequest<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

/** Get a raw record from IDBFS overlay */
async function getRecord(path: string): Promise<IDBRecord | undefined> {
  const store = await tx('readonly');
  const result = await awaitRequest<IDBRecord | undefined>(store.get(path));
  return result ?? undefined;
}

/** Put a record into IDBFS overlay */
async function putRecord(rec: IDBRecord): Promise<void> {
  const store = await tx('readwrite');
  await awaitRequest<void>(store.put(rec));
}

/** Get the boardVM.fsBridge (Go WASM bridge) for fallback reads */
function getBridge(): any {
  const b = (globalThis as any).boardVM?.fsBridge;
  if (!b) throw new Error('boardVM.fsBridge not available');
  return b;
}

/**
 * Convert a JS path (with leading /) to an IDBFS key (no leading /).
 * Matches fs.ValidPath format used by Go's idbfs.go.
 *
 * Routing:
 *   "/"           → "."   (root)
 *   "/workspace"  → "."   (Yuan/almostnode agent root → v86 root)
 *   "/workspace/X"→ "X"   (Yuan path → v86 path)
 *   "/tmp/foo"    → "tmp/foo"
 *   "/home/user"  → "home/user"
 */
function resolvePath(p: string): string {
  if (p === '/' || p === '') return '.';
  if (p[0] === '/') p = p.slice(1);
  // Strip trailing slashes
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  // Yuan/almostnode routing: /workspace is the agent root, maps to v86 root
  if (p === 'workspace') return '.';
  if (p.startsWith('workspace/')) return p.slice(10) || '.';
  return p || '.';
}

// ── Public API ──────────────────────────────────────────────

export const vfs = {
  /**
   * Read file content. Checks IDBFS overlay first (fast, no Go bridge).
   * Falls back to boardVM.fsBridge if file is only in tarfs base.
   */
  async readFile(path: string): Promise<string> {
    const resolved = await resolvePath(path);

    // Try IDBFS overlay first
    const rec = await getRecord(resolved);
    if (rec && !rec.isDir) {
      if (rec.data instanceof Uint8Array) {
        return new TextDecoder().decode(rec.data);
      }
      if (typeof rec.data === 'string') {
        return rec.data;
      }
      // Empty file
      return '';
    }

    // Fallback: file might be in tarfs base image, read via Go bridge
    const bridge = getBridge();
    const content = await bridge.readFile(path);
    if (content instanceof Error) throw content;

    // Backfill IDBFS overlay so next read is fast
    const bytes = typeof content === 'string'
      ? new TextEncoder().encode(content)
      : new Uint8Array(content);
    await putRecord({
      path: resolved,
      data: bytes,
      isDir: false,
      mode: 0o644,
      modTime: Date.now(),
    });

    return typeof content === 'string' ? content : new TextDecoder().decode(content);
  },

  /**
   * Write file content directly to IDBFS overlay.
   * v86 will see this on next read (same IndexedDB).
   */
  async writeFile(path: string, content: string): Promise<void> {
    const resolved = await resolvePath(path);
    const data = new TextEncoder().encode(content);
    await putRecord({
      path: resolved,
      data,
      isDir: false,
      mode: 0o644,
      modTime: Date.now(),
    });
  },

  /**
   * Check if path exists. Checks IDBFS overlay first.
   * Falls back to fsBridge for tarfs base files.
   */
  async exists(path: string): Promise<boolean> {
    const resolved = await resolvePath(path);
    const rec = await getRecord(resolved);
    if (rec) return true;

    // Check implicit directory (has children in overlay)
    const store = await tx('readonly');
    const allKeys = await awaitRequest<string[]>(store.getAllKeys());
    if (allKeys.some(k => k.startsWith(resolved + '/'))) return true;

    // Fallback to bridge for tarfs base
    try {
      const bridge = getBridge();
      return await bridge.exists(path);
    } catch {
      return false;
    }
  },

  /**
   * Stat a path. Checks IDBFS overlay first, falls back to fsBridge.
   * Returns same fields as v86's fsBridge.stat: {exists, isDir, size, mode, mtime}
   */
  async stat(path: string): Promise<{ exists: boolean; isDir: boolean; size: number; mode: number; mtime: number }> {
    const resolved = await resolvePath(path);
    const rec = await getRecord(resolved);
    if (rec) {
      return {
        exists: true,
        isDir: rec.isDir,
        size: rec.data ? (rec.data instanceof Uint8Array ? rec.data.length : (rec.data as string).length) : 0,
        mode: rec.mode,
        mtime: rec.modTime,
      };
    }

    // Check implicit directory (children exist in overlay)
    const store = await tx('readonly');
    const allKeys = await awaitRequest<string[]>(store.getAllKeys());
    if (allKeys.some(k => k.startsWith(resolved + '/'))) {
      return { exists: true, isDir: true, size: 0, mode: 0o755, mtime: Date.now() };
    }

    // Fallback to bridge — returns {exists, isDir, size, mode, mtime}
    try {
      const bridge = getBridge();
      const info = await bridge.stat(path);
      return {
        exists: info.exists ?? false,
        isDir: info.isDir ?? false,
        size: info.size ?? 0,
        mode: info.mode ?? 0,
        mtime: info.mtime ?? 0,
      };
    } catch {
      return { exists: false, isDir: false, size: 0, mode: 0, mtime: 0 };
    }
  },

  /**
   * Create directory directly in IDBFS overlay.
   */
  async mkdir(path: string): Promise<void> {
    const resolved = await resolvePath(path);
    await putRecord({
      path: resolved,
      isDir: true,
      mode: 0o755,
      modTime: Date.now(),
    });
  },

  /**
   * Create directory and all parents in IDBFS overlay.
   */
  async mkdirp(path: string): Promise<void> {
    const resolved = await resolvePath(path);
    const parts = resolved.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      const existing = await getRecord(dir);
      if (!existing) {
        await putRecord({
          path: dir,
          isDir: true,
          mode: 0o755,
          modTime: Date.now(),
        });
      }
    }
  },

  /**
   * List directory entries. Reads from IDBFS overlay keys + falls back
   * to fsBridge for tarfs base entries.
   */
  async readdir(path: string): Promise<string[]> {
    const resolved = await resolvePath(path);
    const prefix = resolved + '/';
    const entries = new Set<string>();

    // Collect entries from IDBFS overlay
    const store = await tx('readonly');
    const allKeys = await awaitRequest<string[]>(store.getAllKeys());
    for (const k of allKeys) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      const slashIdx = rest.indexOf('/');
      entries.add(slashIdx >= 0 ? rest.slice(0, slashIdx) : rest);
    }

    // Also get entries from tarfs base via bridge
    try {
      const bridge = getBridge();
      const baseEntries = await bridge.readdir(path);
      if (Array.isArray(baseEntries)) {
        for (const e of baseEntries) entries.add(e);
      }
    } catch {
      // tarfs may not have this dir
    }

    // Remove empty string (can happen with path="")
    entries.delete('');
    return Array.from(entries).sort();
  },

  /**
   * Remove a file from IDBFS overlay.
   */
  async unlink(path: string): Promise<void> {
    const resolved = await resolvePath(path);
    const store = await tx('readwrite');
    await awaitRequest<void>(store.delete(resolved));
  },

  /**
   * Remove all entries under a prefix from IDBFS overlay.
   */
  async rmrf(path: string): Promise<void> {
    const resolved = await resolvePath(path);
    const store = await tx('readwrite');
    const allKeys = await awaitRequest<string[]>(store.getAllKeys());
    for (const k of allKeys) {
      if (k === resolved || k.startsWith(resolved + '/')) {
        store.delete(k);
      }
    }
  },

  /**
   * Clear the entire IDBFS overlay. Next reads fall through to tarfs base.
   */
  async clear(): Promise<void> {
    const store = await tx('readwrite');
    await awaitRequest<void>(store.clear());
  },

  /**
   * Read first N lines of a file.
   */
  async headFile(path: string, lines: number = 3): Promise<string> {
    const content = await vfs.readFile(path);
    return content.split('\n').slice(0, lines).join('\n');
  },

  /**
   * Get the resolved IDBFS path for a JS path (useful for debugging).
   */
  async resolvePath(path: string): Promise<string> {
    return resolvePath(path);
  },
};
