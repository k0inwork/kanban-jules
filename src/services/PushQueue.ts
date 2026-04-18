import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import FS from '@isomorphic-git/lightning-fs';
import { db, PushQueueItem } from './db';

const fs = new FS('git-repos');

/**
 * PushQueue — defers git pushes when offline or when tasks want local-only commits.
 * Stores pending pushes in IndexedDB and flushes them on connectivity.
 */
class PushQueueService {
  private flushing = false;

  /** Enqueue a push for later execution */
  async enqueue(item: Omit<PushQueueItem, 'id' | 'status' | 'timestamp'>): Promise<number> {
    const id = await db.pushQueue.add({
      ...item,
      status: 'pending',
      timestamp: Date.now(),
    });
    console.log(`[PushQueue] Enqueued push for ${item.branch} (id: ${id})`);
    return id as number;
  }

  /** Flush all pending pushes sequentially */
  async flush(): Promise<{ succeeded: number; failed: number }> {
    if (this.flushing) return { succeeded: 0, failed: 0 };
    this.flushing = true;

    let succeeded = 0;
    let failed = 0;

    try {
      const pending = await db.pushQueue.where('status').equals('pending').toArray();
      if (pending.length === 0) return { succeeded: 0, failed: 0 };

      console.log(`[PushQueue] Flushing ${pending.length} pending pushes...`);

      for (const item of pending) {
        try {
          await db.pushQueue.update(item.id!, { status: 'pushing' });

          await git.push({
            fs, http,
            dir: item.dir,
            ref: item.branch,
            corsProxy: 'https://cors.isomorphic-git.org',
            onAuth: () => ({ username: item.token })
          });

          await db.pushQueue.delete(item.id!);
          succeeded++;
          console.log(`[PushQueue] Pushed ${item.branch} from ${item.dir}`);
        } catch (e: any) {
          await db.pushQueue.update(item.id!, {
            status: 'failed',
            error: e?.message || String(e)
          });
          failed++;
          console.error(`[PushQueue] Push failed for ${item.branch}:`, e?.message);
        }
      }
    } finally {
      this.flushing = false;
    }

    return { succeeded, failed };
  }

  /** Get all pending/failed items */
  async getPending(): Promise<PushQueueItem[]> {
    return db.pushQueue.where('status').anyOf(['pending', 'failed']).toArray();
  }

  /** Get count of pending items */
  async pendingCount(): Promise<number> {
    return db.pushQueue.where('status').equals('pending').count();
  }

  /** Remove a specific item (e.g., after manual resolution) */
  async remove(id: number): Promise<void> {
    await db.pushQueue.delete(id);
  }

  /** Retry all failed items */
  async retryFailed(): Promise<{ succeeded: number; failed: number }> {
    const failed = await db.pushQueue.where('status').equals('failed').toArray();
    for (const item of failed) {
      await db.pushQueue.update(item.id!, { status: 'pending' });
    }
    return this.flush();
  }

  /** Wire up online event listener */
  startAutoFlush(): () => void {
    const handler = () => {
      console.log('[PushQueue] Online — flushing pending pushes');
      this.flush();
    };
    window.addEventListener('online', handler);

    // Also flush on load if online
    if (navigator.onLine) {
      this.flush();
    }

    return () => window.removeEventListener('online', handler);
  }
}

export const pushQueue = new PushQueueService();
