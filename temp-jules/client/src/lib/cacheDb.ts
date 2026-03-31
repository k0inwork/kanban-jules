import { Session, Activity } from './julesApi';

const DB_NAME = 'jules-chat-cache';
const DB_VERSION = 1;

export interface CachedData<T> {
  data: T;
  timestamp: number;
}

export class CacheDB {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'apiKey' });
        }
        if (!db.objectStoreNames.contains('activities')) {
          db.createObjectStore('activities', { keyPath: 'key' }); // key will be `${apiKey}_${sessionId}`
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event);
        reject(new Error('Failed to initialize IndexedDB'));
      };
    });

    return this.initPromise;
  }

  async getSessions(apiKey: string): Promise<Session[] | null> {
    await this.init();
    if (!this.db) return null;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction('sessions', 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.get(apiKey);

      request.onsuccess = () => {
        const result = request.result as { apiKey: string; sessions: Session[] } | undefined;
        resolve(result?.sessions || null);
      };
      request.onerror = () => resolve(null);
    });
  }

  async saveSessions(apiKey: string, sessions: Session[]): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction('sessions', 'readwrite');
      const store = transaction.objectStore('sessions');
      const request = store.put({ apiKey, sessions });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to save sessions to cache'));
    });
  }

  async getActivities(apiKey: string, sessionId: string): Promise<Activity[] | null> {
    await this.init();
    if (!this.db) return null;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction('activities', 'readonly');
      const store = transaction.objectStore('activities');
      const request = store.get(`${apiKey}_${sessionId}`);

      request.onsuccess = () => {
        const result = request.result as { key: string; activities: Activity[] } | undefined;
        resolve(result?.activities || null);
      };
      request.onerror = () => resolve(null);
    });
  }

  async saveActivities(apiKey: string, sessionId: string, activities: Activity[]): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction('activities', 'readwrite');
      const store = transaction.objectStore('activities');
      const request = store.put({ key: `${apiKey}_${sessionId}`, activities });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to save activities to cache'));
    });
  }
}

export const cacheDb = new CacheDB();
