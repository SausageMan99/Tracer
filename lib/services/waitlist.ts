import { promises as fs } from "fs";
import { appendFile } from "fs/promises";
import path from "path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WaitlistEntry {
  readonly email: string;
  readonly sport?: "running" | "cycling" | "both";
  readonly source: "landing" | "post-generation";
  readonly createdAt: string;
}

// ── Storage ──────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), ".data");
const WAITLIST_FILE = path.join(DATA_DIR, "waitlist.jsonl");

// Simple async mutex — serializes all writes to prevent race conditions
let writeLock = Promise.resolve();

async function readEntries(): Promise<readonly WaitlistEntry[]> {
  try {
    const raw = await fs.readFile(WAITLIST_FILE, "utf-8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as WaitlistEntry);
  } catch {
    return [];
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function addToWaitlist(
  entry: WaitlistEntry,
): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve, reject) => {
    writeLock = writeLock.then(async () => {
      try {
        const existing = await readEntries();

        const alreadyExists = existing.some(
          (e) => e.email.toLowerCase() === entry.email.toLowerCase(),
        );
        if (alreadyExists) {
          resolve({ success: true, message: "Déjà inscrit." });
          return;
        }

        await fs.mkdir(DATA_DIR, { recursive: true });
        await appendFile(
          WAITLIST_FILE,
          JSON.stringify(entry) + "\n",
          "utf-8",
        );

        resolve({ success: true, message: "Bienvenue dans la forge." });
      } catch (err) {
        reject(err);
      }
    });
  });
}

export async function getWaitlistCount(): Promise<number> {
  const entries = await readEntries();
  return entries.length;
}
