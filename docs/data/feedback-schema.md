# Feedback Schema

Documentation for the `RouteFeedback` data structure collected when users rate routes with 👍 or 👎.

---

## Purpose

The feedback system collects labelled training data for a future route quality model. Each `RouteFeedback` record is a feature vector paired with a binary label (`"up"` or `"down"`). The intended downstream use is a pairwise ranking model (e.g. XGBoost LambdaRank or LightGBM) that learns to predict which route variant a user will prefer, replacing or supplementing the current hand-crafted scoring weights.

---

## Storage

Feedback records are stored in browser `localStorage` under the key `"tracer_feedbacks"` as a JSON array:

```json
[
  { "timestamp": "2024-11-15T14:32:01.000Z", "rating": "up", ... },
  { "timestamp": "2024-11-15T15:10:44.000Z", "rating": "down", ... }
]
```

The storage is write-append: each new feedback is pushed onto the existing array. Records are never deleted automatically.

---

## JSON Schema

```typescript
interface RouteFeedback {
  timestamp: string;           // ISO 8601 — when the feedback was given
  rating: "up" | "down";       // User's rating

  // ── Route metrics (model input features) ────────────────────────────────
  distanceKm: number;          // Actual route distance in km
  ascendM: number;             // D+ (positive elevation gain) in metres
  descendM: number;            // D− (negative elevation loss) in metres
  durationSeconds: number;     // Estimated duration in seconds
  surfaceScore: number;        // Terrain quality score in [0, 1]
  loopScore: number;           // Loop closure quality in [0, 1]
  totalScore: number;          // Composite score in [0, 1]

  // ── Session context (model conditioning features) ────────────────────────
  profileId: string;           // Active session profile ID
  targetDistanceKm: number;    // User's requested distance target
  targetElevationM: number;    // User's requested D+ target

  // ── Route geometry fingerprint ──────────────────────────────────────────
  startLat: number;            // Start point latitude
  startLng: number;            // Start point longitude
  endLat: number;              // End point latitude (last point of route)
  endLng: number;              // End point longitude
}
```

---

## Field Reference

### Metadata

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| `timestamp` | `string` (ISO 8601) | `"2024-11-15T14:32:01.000Z"` | UTC timestamp of when the feedback was submitted |
| `rating` | `"up"` \| `"down"` | `"up"` | User's thumbs up/down rating |

### Route Metrics

These are the features used to train the ranking model. They describe the actual route that was rated.

| Field | Type | Unit | Description |
|-------|------|------|-------------|
| `distanceKm` | `number` | km | Actual total route distance |
| `ascendM` | `number` | m | Total positive elevation gain (D+) |
| `descendM` | `number` | m | Total negative elevation loss (D−) |
| `durationSeconds` | `number` | seconds | Estimated completion time |
| `surfaceScore` | `number` [0,1] | — | Terrain quality from Overpass OSM scoring |
| `loopScore` | `number` [0,1] | — | Loop closure quality (0 = point-to-point, 1 = perfect loop) |
| `totalScore` | `number` [0,1] | — | Composite weighted score used to rank this route |

### Session Context

These features condition the model on the user's intent — the same route might be rated "up" for a long endurance run but "down" for a short interval session.

| Field | Type | Unit | Description |
|-------|------|------|-------------|
| `profileId` | `string` | — | Session profile at time of generation (e.g. `"running_trail"`) |
| `targetDistanceKm` | `number` | km | User's requested route distance |
| `targetElevationM` | `number` | m | User's requested D+ target |

### Geometry Fingerprint

These allow de-duplication and geographic analysis of feedback. They are not expected to be primary model features but are useful for spatial clustering and debugging.

| Field | Type | Description |
|-------|------|-------------|
| `startLat`, `startLng` | `number` | Start point coordinates (WGS84) |
| `endLat`, `endLng` | `number` | End point coordinates (last route point) |

---

## Example Record

```json
{
  "timestamp": "2024-11-15T14:32:01.000Z",
  "rating": "up",
  "distanceKm": 12.4,
  "ascendM": 385,
  "descendM": 390,
  "durationSeconds": 3960,
  "surfaceScore": 0.74,
  "loopScore": 0.92,
  "totalScore": 0.81,
  "profileId": "running_trail",
  "targetDistanceKm": 12,
  "targetElevationM": 400,
  "startLat": 45.7640,
  "startLng": 4.8357,
  "endLat": 45.7638,
  "endLng": 4.8361
}
```

---

## Derived Features for ML

When training a model, these additional features can be derived from the raw record:

| Derived feature | Formula | Purpose |
|----------------|---------|---------|
| `distanceMissKm` | `abs(distanceKm - targetDistanceKm)` | Absolute miss on distance target |
| `distanceMissPct` | `distanceMissKm / targetDistanceKm` | Relative miss |
| `elevationMissM` | `abs(ascendM - targetElevationM)` | Absolute miss on D+ target |
| `elevationMissPct` | `elevationMissM / targetElevationM` | Relative miss |
| `gradient` | `ascendM / (distanceKm × 10)` | Average gradient in % |
| `loopGapKm` | `haversine(start, end)` | Reconstructed from start/end coords |

---

## Planned ML Model

The intended model is a **pairwise ranking model** (LambdaRank or similar):

1. For each session (`profileId` + `targetDistanceKm` + `targetElevationM`), collect all feedback pairs
2. For each (route_A, route_B) pair from the same session: label as `(A > B)` if `A.rating == "up"` and `B.rating == "down"`
3. Train a gradient boosting model on the route metric features to predict the preference direction
4. Use model scores to replace or augment `totalScore` in the ranking step

**Minimum dataset size:** ~500 feedback records provide enough signal for a simple model. With 1 000+ records, profile-specific models become viable.

---

## Export Format

`exportFeedbacksAsJSON()` triggers a browser download of the full feedback array as a `.json` file named `tracer-feedbacks-<timestamp>.json`.

The exported file is a raw JSON array — no envelope, no schema version header. Load it directly into pandas:

```python
import pandas as pd
df = pd.read_json("tracer-feedbacks-2024-11-15T14-32-01.json")
```

---

## Privacy

Feedback records contain approximate geographic coordinates (start/end of the route, not the user's exact home address) and session parameters. No user identifiers, email addresses, or Strava account data are stored. All data stays in the user's browser `localStorage` until they explicitly export or clear it.
