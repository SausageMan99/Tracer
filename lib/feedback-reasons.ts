export const FEEDBACK_REASON_OPTIONS = [
  {
    code: "too_much_busy_road",
    label: "Trop de grands axes",
    appliesTo: "negative",
  },
  {
    code: "not_enough_nature",
    label: "Pas assez nature",
    appliesTo: "negative",
  },
  {
    code: "distance_off_target",
    label: "Distance éloignée",
    appliesTo: "negative",
  },
  {
    code: "elevation_off_target",
    label: "D+ pas cohérent",
    appliesTo: "negative",
  },
  {
    code: "loop_not_clean",
    label: "Boucle peu propre",
    appliesTo: "negative",
  },
  {
    code: "good_flow",
    label: "Tracé fluide",
    appliesTo: "positive",
  },
  {
    code: "good_nature_ratio",
    label: "Bon ratio nature",
    appliesTo: "positive",
  },
  {
    code: "refusal_clear",
    label: "Refus clair",
    appliesTo: "refusal",
  },
  {
    code: "expected_route",
    label: "J'attendais une route",
    appliesTo: "refusal",
  },
  {
    code: "shorter_distance_ok",
    label: "Distance plus courte OK",
    appliesTo: "refusal",
  },
  {
    code: "bad_terrain_diagnostic",
    label: "Mauvais diagnostic terrain",
    appliesTo: "refusal",
  },
] as const;

export type FeedbackReason = typeof FEEDBACK_REASON_OPTIONS[number]["code"];

const FEEDBACK_REASON_CODES = new Set<string>(
  FEEDBACK_REASON_OPTIONS.map((option) => option.code)
);

export function isFeedbackReason(value: unknown): value is FeedbackReason {
  return typeof value === "string" && FEEDBACK_REASON_CODES.has(value);
}

export function sanitizeFeedbackReasons(value: unknown): FeedbackReason[] {
  if (!Array.isArray(value)) return [];

  return Array.from(new Set(value.filter(isFeedbackReason)));
}
