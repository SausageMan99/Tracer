/**
 * Feedback persistence layer — stores user 👍/👎 ratings in localStorage.
 *
 * Each feedback entry captures both the user's subjective rating and the
 * objective metrics of the route at the time of rating. This data is
 * designed to train a future XGBoost model that replaces the hand-crafted
 * scoring weights with learned preferences.
 *
 * Data is stored as a JSON array under the key `"trailforge-feedbacks"`.
 * The export function downloads the full dataset for offline ML training.
 */

const STORAGE_KEY = "trailforge-feedbacks";

/**
 * A single user feedback entry for a generated route.
 *
 * The fields form the feature vector for a binary classification model
 * (positive vs negative). Algorithm metrics are included so the model
 * can learn which scoring dimensions correlate with user satisfaction.
 */
export interface RouteFeedback {
  /** UUID v4, generated at submission time */
  id: string;
  /** Unix timestamp in milliseconds when the feedback was submitted */
  timestamp: number;
  /** User rating: thumbs up or thumbs down */
  rating: "positive" | "negative";
  /** Session type of the profile used (e.g. `"endurance"`, `"seuil_lactique"`) */
  sessionType: string;
  /** Sport used for generation (e.g. `"running"`, `"cycling_road"`) */
  sport: string;
  /** UI mode at time of generation — affects popularity scoring boost */
  mode: "PERFORMANCE" | "SCENIC";
  /** User-requested distance in km */
  requestedDistanceKm: number;
  /**
   * User-requested D+ in metres. `null` when the slider was at 0
   * (elevation not a constraint for this session type).
   */
  requestedElevationM: number | null;
  /** Actual distance of the generated route in km */
  actualDistanceKm: number;
  /** Actual D+ of the generated route in metres */
  actualElevationM: number;
  /**
   * Multi-criteria algorithmic score in [0, 1].
   * Useful to identify routes that score high algorithmically but rate poorly.
   */
  algorithmicScore: number;
  /**
   * `|actualDistance - requestedDistance| / requestedDistance × 100`.
   * Rounded to integer percent.
   */
  distanceErrorPct: number;
  /**
   * `|actualElevation - requestedElevation| / requestedElevation × 100`.
   * `null` when `requestedElevationM` was null or 0.
   */
  elevationErrorPct: number | null;
}

/**
 * Appends a new feedback entry to the localStorage store and
 * persists it to the server API (fire-and-forget).
 *
 * Silently ignores errors (localStorage full, SSR context, or JSON failures).
 * Feedback loss is acceptable — it must never throw in the UI.
 *
 * @param feedback - The completed feedback entry to persist
 */
export function saveFeedback(feedback: RouteFeedback): void {
  try {
    const existing = loadFeedbacks();
    existing.push(feedback);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // localStorage might be full or unavailable
  }

  // Fire-and-forget API persistence
  try {
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(feedback),
    }).catch(() => { /* non-critical */ });
  } catch {
    // fetch not available (SSR) — ignore
  }
}

/**
 * Loads all stored feedback entries from localStorage.
 * Returns an empty array on any error.
 *
 * @returns Array of stored `RouteFeedback` entries, may be empty
 */
export function loadFeedbacks(): RouteFeedback[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RouteFeedback[];
  } catch {
    return [];
  }
}

/**
 * Triggers a browser download of all stored feedbacks as a formatted JSON file.
 *
 * Intended workflow: collect 500+ entries, export, train XGBoost offline,
 * then replace `scoreRoute()` weights with model predictions.
 *
 * @example
 * exportFeedbacksAsJSON();
 * // → downloads "trailforge-feedbacks-1708776000000.json"
 */
export function exportFeedbacksAsJSON(): void {
  const feedbacks = loadFeedbacks();
  const blob = new Blob([JSON.stringify(feedbacks, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `trailforge-feedbacks-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
