import { openDB } from "idb";
import type { CacheAdapter, CachedGraph } from "./cache-adapter";

const DB_NAME = "trailforge-cache";
const STORE_NAME = "graphs";
const DB_VERSION = 1;

export class IndexedDBCache implements CacheAdapter {
  constructor(private readonly ttlMs: number) {}

  private async getDB() {
    return openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }

  async load(key: string): Promise<CachedGraph | null> {
    const db = await this.getDB();
    const data: CachedGraph | undefined = await db.get(STORE_NAME, key);
    if (!data) return null;
    if (Date.now() - data.cachedAt > this.ttlMs) {
      await db.delete(STORE_NAME, key);
      return null;
    }
    return data;
  }

  async save(key: string, data: CachedGraph): Promise<void> {
    const db = await this.getDB();
    await db.put(STORE_NAME, data, key);
  }
}
