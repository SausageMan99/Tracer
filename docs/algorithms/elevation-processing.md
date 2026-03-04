# Elevation Processing

How TrailForge obtains, enriches, and computes elevation metrics for route candidates.

---

## Overview

Elevation data flows differently for running and cycling routes because the two routing engines provide different levels of elevation support:

| Engine | Elevation in response? | TrailForge approach |
|--------|----------------------|---------------------|
| GraphHopper (running) | No (free tier) | Fetch separately from Open-Meteo after routing |
| OpenRouteService (cycling) | Yes (always) | Extract directly from ORS GeoJSON coordinates |

---

## Open-Meteo Elevation Enrichment (running)

GraphHopper's free-tier round-trip API returns route points as `[longitude, latitude]` pairs with no altitude. TrailForge enriches them by calling the [Open-Meteo Elevation API](https://open-meteo.com/en/docs/elevation-api).

### API Contract

```
GET https://api.open-meteo.com/v1/elevation
  ?latitude=45.764,45.772,...
  &longitude=4.835,4.837,...
```

The API accepts comma-separated coordinate lists and returns a matching `elevation` array:

```json
{
  "elevation": [168.0, 172.3, 180.1, ...]
}
```

Open-Meteo uses the [SRTM 90 m DEM](https://srtm.csi.cgiar.org/) globally, which has:
- 90 m horizontal resolution
- ±16 m vertical accuracy (1σ) in mountainous terrain
- Better accuracy on flat terrain (~±5 m)

### Batching Strategy

The API limits requests to **100 coordinate pairs** per call. `fetchElevations()` splits long routes into batches:

```typescript
const ELEVATION_BATCH_SIZE = 100;

for (let i = 0; i < coords.length; i += ELEVATION_BATCH_SIZE) {
  const batch = coords.slice(i, i + ELEVATION_BATCH_SIZE);
  // POST request with batch
}
```

Batches are fetched **sequentially** (not in parallel) to avoid triggering Open-Meteo rate limits. For a 20 km route with ~400 points, this means 4 sequential requests. The typical latency per request is ~200 ms, so elevation enrichment adds ~800 ms to the pipeline for long routes.

**Why not parallel?** Open-Meteo's free tier has undocumented rate limits. Sequential batching is robust against rate limiting at the cost of a few hundred milliseconds. For the typical 6–15 km routes in TrailForge, 1–2 batches are needed, so the latency impact is minimal.

### Merging Elevation Back

After fetching, elevation values are merged onto the route points by index:

```typescript
points[i].elevation = elevationValues[i];
```

Points where the API returns `null` (offshore, unmapped areas) keep `elevation: undefined`. The elevation chart and D+ computation skip points with undefined elevation.

---

## ORS Elevation Extraction (cycling)

OpenRouteService includes elevation in its GeoJSON response — every coordinate triple is `[longitude, latitude, elevation_m]`.

`fetchCandidateRoutesORS()` extracts elevation directly during coordinate parsing:

```typescript
const [lng, lat, ele] = coord;  // ele is metres above sea level
points.push({ lat, lng, elevation: ele ?? undefined });
```

ORS uses its own elevation model (also SRTM-derived) with similar accuracy to Open-Meteo. No additional API call is needed.

---

## D+ / D− Computation

`computeAscent()` takes an array of elevation values and returns `{ ascendM, descendM }`.

### Algorithm

```
ascendM  = 0
descendM = 0

for i in 1..n-1:
    delta = elevation[i] - elevation[i-1]
    if delta > NOISE_THRESHOLD:
        ascendM  += delta
    elif delta < -NOISE_THRESHOLD:
        descendM += |delta|
```

Where `NOISE_THRESHOLD = 0.5 m`.

**Why 0.5 m threshold?** GPS tracks and elevation model grids contain noise — two adjacent interpolated elevation values can differ by ±0.3 m even on flat ground. Without a threshold, D+ would be significantly inflated. 0.5 m removes noise while still capturing genuine small climbs.

**Why not smoothing?** A Gaussian or moving-average smoothing approach would require choosing a window size, which depends on the route's point density. The threshold approach is simpler, parameter-free, and produces results consistent with what GPS devices (Garmin, Wahoo) report.

### Numeric Example

```
Elevations (m): [100, 101, 103, 102, 105, 104, 104, 108]
Deltas:              +1   +2   -1   +3   -1    0   +4

With threshold 0.5:
  +1  → ascend += 1   (1 > 0.5)
  +2  → ascend += 2
  -1  → descend += 1  (|-1| > 0.5)
  +3  → ascend += 3
  -1  → descend += 1
   0  → ignored
  +4  → ascend += 4

ascendM  = 1 + 2 + 3 + 4 = 10 m
descendM = 1 + 1 = 2 m
```

---

## Elevation Feasibility Check

Before scoring, `generateRoute()` checks whether the requested D+ is achievable in the area around the start address.

**Heuristic:**

```
maxAchievableElev = max(D+ across all candidates)

if requestedD+ > maxAchievableElev × 1.20:
    throw "IMPOSSIBLE_ELEVATION:<maxAchievableElev>"
```

The 1.20 factor provides a 20 % buffer — the generator may not have found the optimal route on the first 6 seeds, so the true maximum may be slightly higher than what the candidates show.

**Why this check?** Without it, users in flat terrain (coastal cities, plains) could request 1 000 m D+ and receive a route that achieves 80 m — a 92 % mismatch that looks like a bug. The check surfaces an explicit, actionable error: "Maximum estimé : 85 m" tells the user exactly what they can expect.

---

## Elevation Profile Display

`ElevationProfile.tsx` renders the elevation curve as an SVG `<polyline>`. The Y axis is scaled to the route's actual min/max elevation range (`maxElev − minElev`), which means a flat route shows gentle undulations rather than a flat line.

**Grid lines** are drawn at three Y positions: min, mid, max elevation. This avoids cluttering the chart with too many grid lines while still providing reference points.

**Hover interpolation:** The cursor's X position (0–100 %) is mapped to an array index by linear interpolation. The elevation at that index is displayed in the bubble tooltip.
