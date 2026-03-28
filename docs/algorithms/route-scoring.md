# Route Scoring Algorithm

Mathematical specification of the scoring systems used in TrailForge.

---

## Overview

TrailForge uses two scoring systems depending on which engine generates the route:

1. **V2 Edge Scoring** — scores individual graph edges during beam-search traversal
2. **Legacy Candidate Ranking** — scores complete route candidates after generation

---

## 1. V2 Edge Scoring

Used by the V2 engine (`lib/engine/edge-scorer.ts`) during beam-search traversal. Each edge in the OSM graph is scored on four dimensions.

### Weight Derivation

`deriveWeights(profile, scenicMode)` computes normalized weights based on sport, session type, and scenic mode:

| Dimension | Description |
|-----------|-------------|
| `surface` | How well the edge surface matches the sport (paved for road cycling, unpaved for MTB/trail) |
| `elevation` | Gradient desirability (varies by session type — low for intervals, high for gran fondo) |
| `nature` | Proximity to natural areas (woods, parks, water) and scenic way membership |
| `quietness` | Road tranquility — quiet residential/path vs busy primary/secondary + safety (lit, access tags) |

### Base Weights by Sport

| Sport | surface | elevation | nature | quietness |
|-------|---------|-----------|--------|-----------|
| Running | 0.30 | 0.15 | 0.25 | 0.30 |
| Road cycling | 0.35 | 0.20 | 0.10 | 0.35 |
| Gravel | 0.25 | 0.20 | 0.35 | 0.20 |
| MTB | 0.15 | 0.30 | 0.40 | 0.15 |

### Session Type Adjustments

- **Intervals**: elevation → 0.05, surface += 0.10
- **Gran Fondo / Sortie Longue**: elevation → 0.30, nature += 0.05
- **Recuperation**: elevation → 0.05, quietness += 0.10

### Scenic Mode

When scenic mode is active:
- surface −= 0.10, elevation −= 0.10 (min 0.05)
- nature += 0.15, quietness += 0.05

All weights are normalized to sum to 1.0 after adjustments.

### Edge Score Components

**Surface Score** (`scoreSurface`):
- Paved surfaces (asphalt, concrete) score high for road cycling, lower for MTB
- Unpaved surfaces (gravel, dirt, grass) score high for MTB/gravel, lower for road

**Elevation Score**: Based on edge gradient relative to session type preferences.

**Nature Score**: Presence of scenic way tags (natural=wood, natural=scrub, leisure=park, waterway=*).

**Quietness Score** (`scoreQuietness` + `scoreSafety`):
- Highway type: path/footway/cycleway score high; primary/secondary score low
- Safety blending: `lit=yes`, `access=yes` boost the score

### Edge Total Score

```
edgeScore = w_surface × surfaceScore
          + w_elevation × elevationScore
          + w_nature × natureScore
          + w_quietness × quietnessScore
```

This score guides the beam-search solver's edge selection during route construction.

---

## 2. Legacy Candidate Ranking

Used by the legacy engine (`lib/route-generator-legacy.ts`). Scores complete route candidates after generation.

### Formula

Every route candidate is assigned a `totalScore` in [0, 1]:

```
totalScore = w_elev × elevationMatch
           + w_dist × distanceMatch
           + w_surf × surfaceQuality
           + w_loop × loopQuality
```

The weights come from the active session profile's `weights` object (elevationMatch, distanceMatch, surfaceQuality, loopQuality). They are normalised to sum to 1.0.

---

### Component Definitions

#### 2.1 Elevation Match — `elevationMatch`

Measures how close the route's D+ is to the user's target.

```
elevationMatch = exp( −0.5 × ((actual_D+ − target_D+) / σ_elev)² )
```

Where `σ_elev = 0.20 × target_D+` (20% of the target).

| Deviation from target | Score |
|-----------------------|-------|
| 0 % | 1.000 |
| 10 % | 0.882 |
| 20 % | 0.607 |
| 40 % | 0.135 |
| 60 % | 0.011 |
| ≥ 80 % | ≈ 0 |

**Why Gaussian?** Smooth, continuous feedback — avoids cliff effects from hard thresholds.

**Why σ = 20%?** Users tolerate roughly ±15% deviation; 20% provides margin while penalising large deviations.

#### 2.2 Distance Match — `distanceMatch`

Same Gaussian formula applied to distance:

```
distanceMatch = exp( −0.5 × ((actual_km − target_km) / σ_dist)² )
```

Where `σ_dist = 0.20 × target_km`.

#### 2.3 Surface Quality — `surfaceQuality`

Computed by `computeTerrainScore()` using Overpass OSM data.

For each route segment, OSM tags are looked up:

| Match | Contribution |
|-------|-------------|
| `route=running` or `route=bicycle` relation | +1.0 |
| `natural=wood`, `natural=scrub`, `leisure=park` | +0.7 |
| `highway=path`, `highway=track`, `surface=gravel` | +0.8 (trail profiles) |
| `highway=footway`, `highway=cycleway` | +0.6 |
| `highway=residential`, `highway=unclassified` | +0.4 |
| `highway=primary`, `highway=secondary` | +0.1 |
| No match | +0.3 |

Averaged across all segments → `surfaceQuality` in [0, 1].

#### 2.4 Loop Quality — `loopQuality`

```
loopQuality = max(0, 1 − (gap_km / 5.0))
```

| End-to-start gap | Score |
|-----------------|-------|
| 0.0 km | 1.000 |
| 0.5 km | 0.900 |
| 1.0 km | 0.800 |
| 2.5 km | 0.500 |
| 5.0 km | 0.000 |

---

## Full Numeric Example (Legacy Scoring)

**User request:** running sortie longue, target 28 km / 300 m D+.

**Profile weights** (sortie_longue): elevationMatch=0.25, distanceMatch=0.35, surfaceQuality=0.20, loopQuality=0.20.

**Candidate:** 26.5 km, 280 m D+, surfaceQuality=0.72, loopQuality=0.95.

```
σ_dist = 0.20 × 28 = 5.6 km
σ_elev = 0.20 × 300 = 60 m

distanceMatch  = exp(-0.5 × ((26.5 - 28) / 5.6)²) = exp(-0.5 × 0.0714) = 0.965
elevationMatch = exp(-0.5 × ((280 - 300) / 60)²)   = exp(-0.5 × 0.1111) = 0.946

totalScore = 0.25 × 0.946  +  0.35 × 0.965  +  0.20 × 0.72  +  0.20 × 0.95
           = 0.237  +  0.338  +  0.144  +  0.190
           = 0.909   (91%)
```

---

## Sensitivity Analysis

The two most influential parameters are:

1. **σ (tolerance width):** Increasing σ from 0.20 to 0.30 makes the algorithm more tolerant. Decreasing to 0.15 makes it stricter.

2. **Profile weights:** The weight distribution determines which dimension dominates. Trail profiles prioritize surface quality; intervals profiles prioritize distance accuracy.

---

## Relationship to Candidate Ranking

After all candidates are scored, they are sorted by `totalScore` descending. The first candidate becomes `best`; all candidates (up to 6) are returned in `candidates`. The UI pre-selects `best` but allows the user to switch to any candidate via the variant selector.
