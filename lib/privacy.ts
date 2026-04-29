import { createHash } from "crypto";

/**
 * Hashes an IP with a daily rotating salt so abuse analysis can still group
 * submissions without storing raw home/work addresses indefinitely.
 */
export function anonymizeIp(ip: string, now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  const salt = process.env.PRIVACY_HASH_SALT ?? "trailforge-local-dev";
  return createHash("sha256")
    .update(`${salt}:${day}:${ip}`)
    .digest("hex")
    .slice(0, 16);
}

export function roundCoordinate(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
