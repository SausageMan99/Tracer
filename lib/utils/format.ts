/**
 * Format a duration in seconds to a human-readable string.
 *
 * @param seconds - Total duration in seconds.
 * @returns "Xh0M" for durations ≥ 1 hour, "M min" otherwise.
 *
 * @example
 * formatDuration(3720) // "1h02"
 * formatDuration(540)  // "9 min"
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m.toString().padStart(2, "0")}`;
  return `${m} min`;
}
