import type { CacheAdapter, CachedGraph } from "./cache-adapter";
import * as fs from "fs";
import * as path from "path";

export class FilesystemCache implements CacheAdapter {
  constructor(
    private readonly cacheDir: string,
    private readonly ttlMs: number
  ) {}

  async load(key: string): Promise<CachedGraph | null> {
    const filePath = path.join(this.cacheDir, `${key}.json`);
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const data: CachedGraph = JSON.parse(raw);
      if (Date.now() - data.cachedAt > this.ttlMs) {
        fs.unlinkSync(filePath);
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  async save(key: string, data: CachedGraph): Promise<void> {
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const filePath = path.join(this.cacheDir, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data));
  }
}
