import { promises as fs } from "fs";
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
const WAITLIST_FILE = path.join(DATA_DIR, "waitlist.json");

async function ensureDataDir(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // already exists
  }
}

async function readEntries(): Promise<readonly WaitlistEntry[]> {
  try {
    const raw = await fs.readFile(WAITLIST_FILE, "utf-8");
    return JSON.parse(raw) as WaitlistEntry[];
  } catch {
    return [];
  }
}

async function writeEntries(entries: readonly WaitlistEntry[]): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(WAITLIST_FILE, JSON.stringify(entries, null, 2), "utf-8");
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function addToWaitlist(entry: WaitlistEntry): Promise<{ success: boolean; message: string }> {
  const existing = await readEntries();

  const alreadyExists = existing.some(
    (e) => e.email.toLowerCase() === entry.email.toLowerCase(),
  );
  if (alreadyExists) {
    return { success: true, message: "Déjà inscrit." };
  }

  const updated = [...existing, entry];
  await writeEntries(updated);

  return { success: true, message: "Bienvenue dans la forge." };
}

export async function getWaitlistCount(): Promise<number> {
  const entries = await readEntries();
  return entries.length;
}
