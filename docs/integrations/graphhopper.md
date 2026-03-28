# GraphHopper Integration

Reference for the GraphHopper Directions API integration used for running route generation.

---

## Overview

GraphHopper is used exclusively for **running** routes in the **legacy engine**. The V2 engine (`lib/engine/`) uses Overpass/OSM directly and does not depend on GraphHopper. GraphHopper's `round_trip` algorithm generates looped routes of a specified distance from a given start point, using a seed to vary the initial heading.

**API documentation:** [docs.graphhopper.com](https://docs.graphhopper.com/#operation/postRoute)

**Relevant file:** `lib/route-generator-legacy.ts` — `fetchCandidateRoutes()`

---

## Request Format

TrailForge sends POST requests to the GraphHopper Routing API:

```
POST https://graphhopper.com/api/1/route?key=<API_KEY>
Content-Type: application/json
```

**Request body:**

```json
{
  "points": [[4.835, 45.764]],
  "profile": "foot",
  "algorithm": "round_trip",
  "round_trip.distance": 15000,
  "round_trip.seed": 3,
  "points_encoded": false,
  "elevation": false,
  "details": []
}
```

| Field | Value | Notes |
|-------|-------|-------|
| `points` | `[[lng, lat]]` | Single origin point — no destination for round trips |
| `profile` | `"foot"` or `"hike"` | Set per session profile in `session-profiles.ts` |
| `algorithm` | `"round_trip"` | Required for looped routes |
| `round_trip.distance` | metres | `targetDistanceKm × 1000` |
| `round_trip.seed` | 0–5 | Controls the initial heading direction |
| `points_encoded` | `false` | Return decoded `[lng, lat]` arrays, not encoded polyline |
| `elevation` | `false` | Elevation is fetched separately via Open-Meteo |

### Why `elevation: false`?

GraphHopper's free tier returns elevation for some profiles but not others, and the data quality varies by region. Open-Meteo provides uniform global elevation coverage at no cost. Using Open-Meteo for elevation decouples routing from elevation, making the pipeline more predictable.

### Why `details: []`?

GraphHopper can return per-segment details (surface, road class, etc.) but parsing them adds complexity and the data is fetched more reliably from Overpass anyway. Empty array keeps the response small.

---

## Seed Strategy

TrailForge requests 6 candidates in parallel using seeds 0–5:

```typescript
const seeds = [0, 1, 2, 3, 4, 5];
const requests = seeds.map(seed =>
  fetch(url, { body: JSON.stringify({ ...params, "round_trip.seed": seed }) })
);
const results = await Promise.all(requests);
```

Each seed causes GraphHopper to bias the initial segment of the route in a different direction. In practice, seeds produce distinctly different routes — a seed-0 route might head north-east while seed-3 heads south-west.

**Why 6 seeds?** 6 provides good directional coverage (roughly every 60°) while keeping the GraphHopper API cost at 6 requests per user action. With 6 candidates, there is usually at least one route that scores well for any combination of target and terrain.

---

## Response Format

GraphHopper returns a `GraphHopperResponse` with a `paths` array:

```json
{
  "paths": [
    {
      "distance": 15240.3,
      "time": 4872000,
      "ascend": 0,
      "descend": 0,
      "points": {
        "type": "LineString",
        "coordinates": [[4.835, 45.764], [4.836, 45.765], ...]
      }
    }
  ]
}
```

| Field | Unit | Notes |
|-------|------|-------|
| `distance` | metres | Total route distance |
| `time` | milliseconds | Estimated duration |
| `ascend` | metres | Not used (Open-Meteo is used instead) |
| `points.coordinates` | `[lng, lat]` | Route geometry as GeoJSON LineString |

### Point density

GraphHopper returns roughly 1 point per 5–15 m, depending on road complexity. A 15 km route typically has 1 000–3 000 points. TrailForge subsamples to a maximum of 500 points before including the route in the API response (to keep JSON payload size reasonable for the client).

---

## Profiles

| GraphHopper profile | TrailForge sport | When used |
|---------------------|-----------------|-----------|
| `foot` | `running` | Standard road/path running |
| `hike` | `running` | Trail running — prefers off-road paths |

The `hike` profile produces routes with more off-road segments (forest paths, mountain trails) at the cost of occasionally finding longer detours around private land.

**Future:** A `running` profile (distinct from `foot`) may be added to GraphHopper's commercial tier; this would improve running-specific road selection (e.g. prefer running tracks, avoid motorway hard shoulders).

---

## Known Limitations

### No elevation data on free tier

The `ascend`/`descend` fields in the response are always 0 on the free tier. This is why Open-Meteo enrichment is required as a separate step.

### Seed routing is not guaranteed

GraphHopper's round-trip algorithm uses the seed as a soft hint, not a hard constraint. Two different seeds can sometimes produce very similar routes if the road network limits available directions. This typically happens in dense urban grids or on peninsulas.

### Maximum distance limit

GraphHopper's free tier has an undocumented limit on the number of route points it returns. Very long routes (> 50 km) may be returned with fewer points than expected. TrailForge does not validate this — the route will still display correctly but may appear less detailed.

### Rate limits

GraphHopper's free tier allows 500 requests/day. TrailForge generates 6 GraphHopper requests per user action (one per seed). At 500 requests/day, this allows ~83 route generation requests per day before the free quota is exhausted.

If you hit the rate limit, GraphHopper returns a `429 Too Many Requests` response. TrailForge surfaces this as a generic 502 error. Consider upgrading to a paid plan for production use.

---

## Error Handling

| GraphHopper status | TrailForge response |
|--------------------|---------------------|
| 200 with `paths: []` | Route discarded; if all 6 paths are empty → `"NO_ROAD_NETWORK"` |
| 400 Bad Request | Route discarded (bad coordinate) |
| 429 Too Many Requests | Route discarded; counted against available candidates |
| Network timeout (5 s) | Route discarded |
| All 6 requests discarded | Throw `"NO_ROAD_NETWORK"` |

The `"NO_ROAD_NETWORK"` error is also thrown when the start coordinates snap to a location with no routable ways (e.g. middle of a lake, private estate with no mapped roads).
