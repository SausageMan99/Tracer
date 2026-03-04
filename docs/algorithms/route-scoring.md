# Route Scoring Algorithm

Mathematical specification of the `scoreRoute()` function in `lib/route-generator.ts`.

---

## Overview

Every route candidate is assigned a `totalScore` in [0, 1] that reflects how well it matches the user's targets and the profile's preferences. The score is a weighted sum of five components:

```
totalScore = w_elev × elevationMatch
           + w_dist × distanceMatch
           + w_surf × surfaceQuality
           + w_loop × loopQuality
           + (scenicMode ? 0.25 × popularityScore : 0)
```

The weights `w_elev`, `w_dist`, `w_surf`, `w_loop` come from the active session profile's `weights` object. They are normalised at call time so that they always sum to 1.0 (before the optional popularity term).

---

## Component Definitions

### 1. Elevation Match — `elevationMatch`

Measures how close the route's D+ (positive elevation gain) is to the user's target.

**Formula:**

```
elevationMatch = exp( −0.5 × ((actual_D+ − target_D+) / σ_elev)² )
```

Where `σ_elev = 0.20 × target_D+` (20% of the target).

**Behaviour:**

| Deviation from target | Score |
|-----------------------|-------|
| 0 % | 1.000 |
| 10 % | 0.882 |
| 20 % | 0.607 |
| 40 % | 0.135 |
| 60 % | 0.011 |
| ≥ 80 % | ≈ 0 |

**Why Gaussian?** A hard threshold (e.g. "within ±20 % scores 1, else 0") creates a cliff that makes the algorithm sensitive to small differences near the boundary. The Gaussian decay gives smooth, continuous feedback — a route 25 % over target is noticeably worse than one 5 % over, but not disqualified.

**Why σ = 20 %?** Empirically, users tolerate roughly ±15 % deviation before noticing the mismatch. 20 % provides a comfortable margin while still penalising large deviations.

### 2. Distance Match — `distanceMatch`

Same Gaussian formula applied to distance:

```
distanceMatch = exp( −0.5 × ((actual_km − target_km) / σ_dist)² )
```

Where `σ_dist = 0.20 × target_km`.

Distance is typically weighted more heavily than elevation for endurance and speed profiles (where hitting the target volume matters), and less heavily for hills/trail profiles (where the D+ matters more than the exact distance).

### 3. Surface Quality — `surfaceQuality`

Measures how well the route's terrain matches the profile's preferred surface type. Computed by `computeTerrainScore()`.

**Computation:**

1. For each route segment (consecutive pair of points), look up the OSM highway/surface tags for the way at the segment midpoint within the Overpass result set.
2. Assign a quality score for each tag match:

   | Match | Contribution |
   |-------|-------------|
   | `route=running` or `route=bicycle` relation | +1.0 (official mapped route) |
   | `natural=wood`, `natural=scrub`, `leisure=park` | +0.7 (scenic environment) |
   | `highway=path`, `highway=track`, `surface=gravel` | +0.8 (for trail profiles) |
   | `highway=footway`, `highway=cycleway` | +0.6 (dedicated infrastructure) |
   | `highway=residential`, `highway=unclassified` | +0.4 (quiet road) |
   | `highway=primary`, `highway=secondary` | +0.1 (busy road, penalised) |
   | No match | +0.3 (neutral) |

3. Average across all segments → `surfaceQuality` in [0, 1].

**Why Overpass instead of routing engine tags?** GraphHopper and ORS expose some surface data in their response, but the coverage is incomplete and varies by API version. Overpass gives the raw OSM data — more complete and more stable.

### 4. Loop Quality — `loopQuality`

Measures how close the route end is to its start.

**Formula:**

```
loopQuality = max(0,  1 − (gap_km / 5.0))
```

Where `gap_km` is the great-circle distance between the last point and the first point of the route.

**Behaviour:**

| End-to-start gap | Score |
|-----------------|-------|
| 0.0 km | 1.000 |
| 0.5 km | 0.900 |
| 1.0 km | 0.800 |
| 2.5 km | 0.500 |
| 5.0 km | 0.000 |
| > 5.0 km | 0.000 |

**Why 5 km as the zero point?** For a 10 km route, a 5 km gap means the user has to retrace half the route or find alternative transport back. Routes with a gap above 5 km are essentially point-to-point routes, which some users explicitly want (A→B mode) but which should score low in loop-preferring profiles.

### 5. Popularity Score — `popularityScore`

Measures how popular the route area is on Strava (i.e. how many athletes have recorded activities there). Only active when Scenic mode is enabled.

**Computation:** see [docs/integrations/strava-heatmap.md](../integrations/strava-heatmap.md) and `lib/heatmap-scorer.ts`.

**Weight:** fixed at `0.25` regardless of the active profile. This is additive — the other four weights are renormalised before adding the popularity term.

**Why 0.25?** Popularity is a useful secondary signal but should not dominate. A highly popular but otherwise poor-quality route (wrong distance, bad terrain) should not rank first. 0.25 gives popularity the same weight as a weak profile component without letting it override the primary signals.

---

## Full Numeric Example

**User request:** running trail, target 15 km / 600 m D+, Scenic mode ON.

**Profile weights** (trail): elevation=0.25, distance=0.25, surface=0.30, loop=0.20.

**Candidate:** 14.2 km, 580 m D+, surfaceQuality=0.78, loopQuality=0.92, popularityScore=0.65.

```
σ_dist = 0.20 × 15 = 3.0 km
σ_elev = 0.20 × 600 = 120 m

distanceMatch  = exp(-0.5 × ((14.2 - 15) / 3.0)²) = exp(-0.5 × 0.0711) = 0.965
elevationMatch = exp(-0.5 × ((580 - 600) / 120)²) = exp(-0.5 × 0.0278) = 0.986

totalScore = 0.25 × 0.986  +  0.25 × 0.965  +  0.30 × 0.78  +  0.20 × 0.92
           + 0.25 × 0.65

           = 0.247  +  0.241  +  0.234  +  0.184  +  0.163

           = 0.869   (87%)
```

This is a strong match: the route is very close to the target and has good trail terrain.

---

## Sensitivity Analysis

The two most influential parameters are:

1. **σ (tolerance width):** Increasing σ from 0.20 to 0.30 makes the algorithm more tolerant of mismatches — useful for areas with sparse road networks where exact targets are hard to hit. Decreasing it to 0.15 makes the algorithm stricter — useful when the user has hard targets (e.g. race preparation).

2. **Profile weights:** The trail profile's high `surface` weight (0.30) means that a route with excellent terrain but mediocre distance match can outscore a route with perfect distance but poor terrain. This is intentional — trail runners care more about the path quality than hitting an exact distance.

---

## Relationship to Candidate Ranking

After all candidates are scored, they are sorted by `totalScore` descending. The first candidate becomes `best`. The full sorted list becomes `candidates` (up to 6 items). The UI pre-selects `best` but allows the user to switch to any candidate via the variant selector.
