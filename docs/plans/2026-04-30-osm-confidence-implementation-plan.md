# OSM Confidence & Terrain Audit Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a remote, data-driven audit layer to TrailForge so the app can estimate whether a start area has enough trail-quality OSM data to generate a credible running loop, and communicate uncertainty honestly to the user.

**Architecture:** Build this as a small internal engine module first, independent from the UI. The module will analyze an `EnrichedGraph` and its edge tags, produce a `TerrainAuditReport`, then feed that report into route quality, generation warnings, and eventually UI copy. No external data source beyond OSM/Overpass is added in Phase 1.

**Tech Stack:** TypeScript, Vitest, existing TrailForge graph builder/solver/route-quality modules, OSM tags already present on `EnrichedEdge`.

---

## Implementation principles

This must be implemented incrementally with strict TDD. Each behavior starts with a failing test, then minimal code, then refactor. No UI work until the audit logic is stable and tested.

The goal is not to make TrailForge “always right”. The goal is to make it more honest and more diagnosable: know when the area is promising, when OSM is poorly tagged, when the graph is fragmented, and when the generated route should carry a warning.

---

## Phase 1 — Core OSM terrain audit module

### Task 1: Define the audit types

**Objective:** Create explicit types for terrain audit outputs so later tasks have a stable contract.

**Files:**
- Create: `lib/engine/terrain-audit.ts`
- Test: `tests/terrain-audit.test.ts`

**Step 1: Write failing test**

Create `tests/terrain-audit.test.ts` with a minimal import test:

```ts
import { describe, expect, it } from 'vitest';
import { createEmptyTerrainAuditReport } from '../lib/engine/terrain-audit';

describe('terrain audit', () => {
  it('creates an empty report with conservative defaults', () => {
    const report = createEmptyTerrainAuditReport();

    expect(report.confidence).toBe('low');
    expect(report.trailPotential).toBe('low');
    expect(report.metrics.totalEdges).toBe(0);
    expect(report.warnings).toContain('Aucune donnée routable analysée.');
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
npm run test:run -- tests/terrain-audit.test.ts
```

Expected: FAIL because `lib/engine/terrain-audit.ts` does not exist.

**Step 3: Write minimal implementation**

Create `lib/engine/terrain-audit.ts`:

```ts
export type TerrainAuditConfidence = 'low' | 'medium' | 'high';
export type TrailPotential = 'low' | 'medium' | 'high';

export interface TerrainAuditMetrics {
  totalEdges: number;
  pathLikeEdgeRatio: number;
  naturalSurfaceRatio: number;
  unknownSurfaceRatio: number;
  scenicEdgeRatio: number;
  asphaltRatio: number;
  naturalAreaSignal: number;
  fragmentationScore: number;
}

export interface TerrainAuditReport {
  confidence: TerrainAuditConfidence;
  trailPotential: TrailPotential;
  metrics: TerrainAuditMetrics;
  warnings: string[];
  recommendations: string[];
}

export function createEmptyTerrainAuditReport(): TerrainAuditReport {
  return {
    confidence: 'low',
    trailPotential: 'low',
    metrics: {
      totalEdges: 0,
      pathLikeEdgeRatio: 0,
      naturalSurfaceRatio: 0,
      unknownSurfaceRatio: 1,
      scenicEdgeRatio: 0,
      asphaltRatio: 0,
      naturalAreaSignal: 0,
      fragmentationScore: 1,
    },
    warnings: ['Aucune donnée routable analysée.'],
    recommendations: ['Élargir la zone de recherche ou vérifier la couverture OSM locale.'],
  };
}
```

**Step 4: Run test to verify pass**

Run:

```bash
npm run test:run -- tests/terrain-audit.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add lib/engine/terrain-audit.ts tests/terrain-audit.test.ts
git commit -m "feat: add terrain audit report types"
```

---

### Task 2: Compute basic edge composition metrics

**Objective:** Measure whether a graph is road-heavy, trail-heavy, scenic, asphalt-heavy, or poorly tagged.

**Files:**
- Modify: `lib/engine/terrain-audit.ts`
- Modify: `tests/terrain-audit.test.ts`

**Step 1: Write failing test**

Add a helper in `tests/terrain-audit.test.ts` to create small test edges. Use the existing `EnrichedEdge` type from `lib/types.ts`. Then add:

```ts
import type { EnrichedEdge } from '../lib/types';
import { auditTerrainData } from '../lib/engine/terrain-audit';

function edge(overrides: Partial<EnrichedEdge>): EnrichedEdge {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    from: overrides.from ?? 'a',
    to: overrides.to ?? 'b',
    distance: overrides.distance ?? 1,
    duration: overrides.duration ?? 600,
    coordinates: overrides.coordinates ?? [[0, 0], [0.001, 0.001]],
    tags: overrides.tags ?? {},
    score: overrides.score ?? 0,
    ...overrides,
  } as EnrichedEdge;
}

it('computes path, surface, asphalt and scenic ratios', () => {
  const report = auditTerrainData([
    edge({ tags: { highway: 'path', surface: 'ground' }, scenic: true }),
    edge({ tags: { highway: 'track' } }),
    edge({ tags: { highway: 'residential', surface: 'asphalt' } }),
    edge({ tags: { highway: 'footway', surface: 'concrete' } }),
  ]);

  expect(report.metrics.totalEdges).toBe(4);
  expect(report.metrics.pathLikeEdgeRatio).toBe(0.75);
  expect(report.metrics.naturalSurfaceRatio).toBe(0.25);
  expect(report.metrics.unknownSurfaceRatio).toBe(0.25);
  expect(report.metrics.asphaltRatio).toBe(0.25);
  expect(report.metrics.scenicEdgeRatio).toBe(0.25);
});
```

**Step 2: Run test to verify failure**

Run:

```bash
npm run test:run -- tests/terrain-audit.test.ts
```

Expected: FAIL because `auditTerrainData` does not exist.

**Step 3: Implement minimal metric calculation**

In `lib/engine/terrain-audit.ts`, add:

```ts
import type { EnrichedEdge } from '../types';

const PATH_LIKE_HIGHWAYS = new Set(['path', 'track', 'footway', 'bridleway']);
const NATURAL_SURFACES = new Set(['ground', 'dirt', 'earth', 'grass', 'unpaved', 'gravel', 'fine_gravel', 'sand', 'compacted']);
const ASPHALT_SURFACES = new Set(['asphalt']);

function ratio(count: number, total: number): number {
  if (total === 0) return 0;
  return count / total;
}

export function auditTerrainData(edges: EnrichedEdge[]): TerrainAuditReport {
  if (edges.length === 0) return createEmptyTerrainAuditReport();

  const totalEdges = edges.length;
  const pathLike = edges.filter((edge) => PATH_LIKE_HIGHWAYS.has(String(edge.tags?.highway ?? ''))).length;
  const naturalSurfaces = edges.filter((edge) => NATURAL_SURFACES.has(String(edge.tags?.surface ?? ''))).length;
  const unknownSurfaces = edges.filter((edge) => !edge.tags?.surface).length;
  const asphaltSurfaces = edges.filter((edge) => ASPHALT_SURFACES.has(String(edge.tags?.surface ?? ''))).length;
  const scenicEdges = edges.filter((edge) => edge.scenic === true).length;

  return {
    confidence: 'medium',
    trailPotential: 'medium',
    metrics: {
      totalEdges,
      pathLikeEdgeRatio: ratio(pathLike, totalEdges),
      naturalSurfaceRatio: ratio(naturalSurfaces, totalEdges),
      unknownSurfaceRatio: ratio(unknownSurfaces, totalEdges),
      scenicEdgeRatio: ratio(scenicEdges, totalEdges),
      asphaltRatio: ratio(asphaltSurfaces, totalEdges),
      naturalAreaSignal: ratio(scenicEdges + naturalSurfaces, totalEdges),
      fragmentationScore: 0,
    },
    warnings: [],
    recommendations: [],
  };
}
```

**Step 4: Run test to verify pass**

Run:

```bash
npm run test:run -- tests/terrain-audit.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add lib/engine/terrain-audit.ts tests/terrain-audit.test.ts
git commit -m "feat: compute terrain audit edge metrics"
```

---

### Task 3: Classify trail potential and data confidence

**Objective:** Convert raw metrics into actionable labels: low, medium, high.

**Files:**
- Modify: `lib/engine/terrain-audit.ts`
- Modify: `tests/terrain-audit.test.ts`

**Step 1: Write failing tests**

Add three tests:

```ts
it('classifies high trail potential when path-like and scenic signals are strong', () => {
  const report = auditTerrainData([
    edge({ tags: { highway: 'path', surface: 'ground' }, scenic: true }),
    edge({ tags: { highway: 'track', surface: 'unpaved' }, scenic: true }),
    edge({ tags: { highway: 'path', surface: 'earth' } }),
    edge({ tags: { highway: 'residential', surface: 'asphalt' } }),
  ]);

  expect(report.trailPotential).toBe('high');
});

it('classifies low trail potential when graph is asphalt-road heavy', () => {
  const report = auditTerrainData([
    edge({ tags: { highway: 'residential', surface: 'asphalt' } }),
    edge({ tags: { highway: 'tertiary', surface: 'asphalt' } }),
    edge({ tags: { highway: 'secondary', surface: 'asphalt' } }),
    edge({ tags: { highway: 'footway', surface: 'asphalt' } }),
  ]);

  expect(report.trailPotential).toBe('low');
  expect(report.warnings).toContain('Zone très routière pour une boucle trail.');
});

it('keeps confidence medium when trail potential is good but surfaces are poorly tagged', () => {
  const report = auditTerrainData([
    edge({ tags: { highway: 'path' }, scenic: true }),
    edge({ tags: { highway: 'track' }, scenic: true }),
    edge({ tags: { highway: 'path' } }),
    edge({ tags: { highway: 'residential', surface: 'asphalt' } }),
  ]);

  expect(report.trailPotential).toBe('high');
  expect(report.confidence).toBe('medium');
  expect(report.warnings).toContain('Beaucoup de chemins existent mais les surfaces OSM sont peu renseignées.');
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
npm run test:run -- tests/terrain-audit.test.ts
```

Expected: FAIL because classification is still hardcoded.

**Step 3: Implement classification helpers**

Add private helpers in `terrain-audit.ts`:

```ts
function classifyTrailPotential(metrics: TerrainAuditMetrics): TrailPotential {
  if (metrics.asphaltRatio >= 0.65 && metrics.scenicEdgeRatio < 0.2) return 'low';
  if (metrics.pathLikeEdgeRatio >= 0.6 && metrics.naturalAreaSignal >= 0.35) return 'high';
  if (metrics.pathLikeEdgeRatio >= 0.4 || metrics.naturalAreaSignal >= 0.25) return 'medium';
  return 'low';
}

function classifyConfidence(metrics: TerrainAuditMetrics, trailPotential: TrailPotential): TerrainAuditConfidence {
  if (metrics.totalEdges < 20) return 'low';
  if (metrics.unknownSurfaceRatio >= 0.5 && trailPotential !== 'low') return 'medium';
  if (metrics.unknownSurfaceRatio >= 0.7) return 'low';
  if (trailPotential === 'high') return 'high';
  return 'medium';
}

function buildTerrainWarnings(metrics: TerrainAuditMetrics): string[] {
  const warnings: string[] = [];
  if (metrics.asphaltRatio >= 0.65 && metrics.scenicEdgeRatio < 0.2) {
    warnings.push('Zone très routière pour une boucle trail.');
  }
  if (metrics.unknownSurfaceRatio >= 0.5 && metrics.pathLikeEdgeRatio >= 0.4) {
    warnings.push('Beaucoup de chemins existent mais les surfaces OSM sont peu renseignées.');
  }
  return warnings;
}
```

Then use these helpers in `auditTerrainData`.

**Step 4: Run tests to verify pass**

Run:

```bash
npm run test:run -- tests/terrain-audit.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add lib/engine/terrain-audit.ts tests/terrain-audit.test.ts
git commit -m "feat: classify terrain audit confidence"
```

---

## Phase 2 — Fragmentation and natural corridor continuity

### Task 4: Detect fragmented natural graph signals

**Objective:** Distinguish a real trail corridor from isolated natural fragments.

**Files:**
- Modify: `lib/engine/terrain-audit.ts`
- Modify: `tests/terrain-audit.test.ts`

**Step 1: Write failing test**

Add two graph-like test cases. Use repeated `from`/`to` node IDs to model connected corridors.

```ts
it('detects low fragmentation when natural edges form a continuous corridor', () => {
  const report = auditTerrainData([
    edge({ from: 'a', to: 'b', tags: { highway: 'path', surface: 'ground' }, scenic: true }),
    edge({ from: 'b', to: 'c', tags: { highway: 'path', surface: 'ground' }, scenic: true }),
    edge({ from: 'c', to: 'd', tags: { highway: 'track', surface: 'unpaved' }, scenic: true }),
  ]);

  expect(report.metrics.fragmentationScore).toBeLessThan(0.35);
});

it('detects high fragmentation when natural edges are isolated', () => {
  const report = auditTerrainData([
    edge({ from: 'a', to: 'b', tags: { highway: 'path', surface: 'ground' }, scenic: true }),
    edge({ from: 'c', to: 'd', tags: { highway: 'path', surface: 'ground' }, scenic: true }),
    edge({ from: 'e', to: 'f', tags: { highway: 'track', surface: 'unpaved' }, scenic: true }),
  ]);

  expect(report.metrics.fragmentationScore).toBeGreaterThan(0.65);
  expect(report.warnings).toContain('Les chemins naturels semblent fragmentés autour du départ.');
});
```

**Step 2: Run tests to verify failure**

Run:

```bash
npm run test:run -- tests/terrain-audit.test.ts
```

Expected: FAIL because `fragmentationScore` is still static.

**Step 3: Implement connected component calculation**

Add helpers:

```ts
function isNaturalLikeEdge(edge: EnrichedEdge): boolean {
  const highway = String(edge.tags?.highway ?? '');
  const surface = String(edge.tags?.surface ?? '');
  return edge.scenic === true || PATH_LIKE_HIGHWAYS.has(highway) || NATURAL_SURFACES.has(surface);
}

function calculateFragmentationScore(edges: EnrichedEdge[]): number {
  const naturalEdges = edges.filter(isNaturalLikeEdge);
  if (naturalEdges.length === 0) return 1;

  const adjacency = new Map<string, Set<string>>();
  for (const edge of naturalEdges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set());
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }

  const visited = new Set<string>();
  let largestComponentNodes = 0;

  for (const node of adjacency.keys()) {
    if (visited.has(node)) continue;
    const stack = [node];
    let componentNodes = 0;
    visited.add(node);

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      componentNodes += 1;
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }

    largestComponentNodes = Math.max(largestComponentNodes, componentNodes);
  }

  const totalNodes = adjacency.size;
  if (totalNodes === 0) return 1;
  return 1 - largestComponentNodes / totalNodes;
}
```

Use this value in `auditTerrainData`. Add warning when score >= 0.65.

**Step 4: Run tests to verify pass**

Run:

```bash
npm run test:run -- tests/terrain-audit.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add lib/engine/terrain-audit.ts tests/terrain-audit.test.ts
git commit -m "feat: detect fragmented natural corridors"
```

---

### Task 5: Add Tourville-style audit regression case

**Objective:** Encode the exact remote insight from Tourville: many paths/woods exist, but missing surfaces lower data confidence.

**Files:**
- Modify: `tests/terrain-audit.test.ts`
- Modify: `docs/feedback-terrain-tourville-sur-odon.md`

**Step 1: Write failing test**

Add:

```ts
it('classifies Tourville-like data as high potential with medium confidence when surfaces are missing', () => {
  const report = auditTerrainData([
    edge({ from: 'a', to: 'b', tags: { highway: 'path' }, scenic: true }),
    edge({ from: 'b', to: 'c', tags: { highway: 'path' }, scenic: true }),
    edge({ from: 'c', to: 'd', tags: { highway: 'track' }, scenic: true }),
    edge({ from: 'd', to: 'e', tags: { highway: 'path' } }),
    edge({ from: 'e', to: 'f', tags: { highway: 'track' } }),
    edge({ from: 'f', to: 'g', tags: { highway: 'residential', surface: 'asphalt' } }),
    edge({ from: 'g', to: 'h', tags: { highway: 'residential', surface: 'asphalt' } }),
    edge({ from: 'h', to: 'i', tags: { highway: 'footway' } }),
  ]);

  expect(report.trailPotential).toBe('high');
  expect(report.confidence).toBe('medium');
  expect(report.recommendations).toContain('Traiter les chemins sans surface comme des candidats trail si leur contexte est boisé ou rural.');
});
```

**Step 2: Run test to verify failure**

Run:

```bash
npm run test:run -- tests/terrain-audit.test.ts
```

Expected: FAIL if recommendation does not exist yet.

**Step 3: Add recommendation logic**

Add:

```ts
function buildTerrainRecommendations(metrics: TerrainAuditMetrics): string[] {
  const recommendations: string[] = [];
  if (metrics.unknownSurfaceRatio >= 0.45 && metrics.pathLikeEdgeRatio >= 0.5) {
    recommendations.push('Traiter les chemins sans surface comme des candidats trail si leur contexte est boisé ou rural.');
  }
  if (metrics.fragmentationScore >= 0.65) {
    recommendations.push('Favoriser les corridors naturels connectés plutôt que les fragments isolés.');
  }
  return recommendations;
}
```

Use it in `auditTerrainData`.

**Step 4: Update docs**

Append a short section to `docs/feedback-terrain-tourville-sur-odon.md`:

```md
## Remote OSM audit interpretation

Remote audit shows the area is not empty in OSM: there are many `path`, `track`, and `footway` ways near the start. The weak point is tag quality, especially missing `surface` values. TrailForge should not automatically treat missing surface as low trail quality when the edge is path-like and near scenic/natural context.
```

**Step 5: Run tests to verify pass**

Run:

```bash
npm run test:run -- tests/terrain-audit.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add tests/terrain-audit.test.ts lib/engine/terrain-audit.ts docs/feedback-terrain-tourville-sur-odon.md
git commit -m "test: capture Tourville terrain audit signal"
```

---

## Phase 3 — Integrate terrain audit into route quality and warnings

### Task 6: Surface audit warnings in route quality output

**Objective:** Let generated routes carry audit-driven warnings when the underlying data is uncertain.

**Files:**
- Modify: `lib/engine/route-quality.ts`
- Modify: `tests/route-quality.test.ts`
- Possibly modify: `lib/types.ts` if `RouteQuality` needs a new optional field

**Step 1: Write failing test**

In `tests/route-quality.test.ts`, add a test that builds a route with many path-like edges with missing surfaces and expects a warning like:

```ts
expect(quality.warnings).toContain('Données terrain moyennes : beaucoup de chemins sans surface renseignée dans OSM.');
```

Use existing route quality test helpers if available.

**Step 2: Run test to verify failure**

Run:

```bash
npm run test:run -- tests/route-quality.test.ts
```

Expected: FAIL because route quality does not use `auditTerrainData` yet.

**Step 3: Integrate audit**

In `lib/engine/route-quality.ts`, call `auditTerrainData(route.edges)` or equivalent edge list inside `calculateRouteQuality`. Map relevant audit warnings to user-facing route warnings.

Use conservative mapping:

```ts
if (audit.confidence === 'medium' && audit.metrics.unknownSurfaceRatio >= 0.45) {
  warnings.push('Données terrain moyennes : beaucoup de chemins sans surface renseignée dans OSM.');
}
```

Do not expose all internal audit warnings yet.

**Step 4: Run test to verify pass**

Run:

```bash
npm run test:run -- tests/route-quality.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add lib/engine/route-quality.ts tests/route-quality.test.ts
git commit -m "feat: expose terrain data warnings in route quality"
```

---

### Task 7: Penalize low-confidence, road-heavy generated routes

**Objective:** Prevent TrailForge from ranking a mostly-road loop as acceptable when audit says the area should have trail potential.

**Files:**
- Modify: `lib/engine/route-quality.ts`
- Modify: `tests/route-quality.test.ts`

**Step 1: Write failing test**

Add a test with a route that has high asphalt ratio and low scenic/natural ratio. Expect lower `overallScore` and a warning:

```ts
expect(quality.overallScore).toBeLessThan(0.6);
expect(quality.warnings).toContain('Boucle trop routière pour une sortie trail.');
```

**Step 2: Run test to verify failure**

Run:

```bash
npm run test:run -- tests/route-quality.test.ts
```

Expected: FAIL if current score is too generous.

**Step 3: Adjust route quality scoring**

In `calculateRouteQuality`, apply a mild penalty when:

```ts
const roadHeavyPenalty = audit.metrics.asphaltRatio >= 0.65 && audit.metrics.scenicEdgeRatio < 0.2 ? 0.15 : 0;
```

Subtract this from overall score after existing score calculation, clamped to `[0, 1]`.

**Step 4: Run test to verify pass**

Run:

```bash
npm run test:run -- tests/route-quality.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add lib/engine/route-quality.ts tests/route-quality.test.ts
git commit -m "fix: penalize road-heavy trail loops"
```

---

## Phase 4 — Integrate terrain audit into solver/scoring behavior

### Task 8: Treat unknown-surface path/track as trail candidates in rural/scenic context

**Objective:** Avoid incorrectly downgrading path-like edges simply because OSM lacks `surface`.

**Files:**
- Modify: `lib/engine/edge-scorer.ts`
- Modify: `tests/edge-scorer.test.ts`

**Step 1: Write failing test**

Add a test where:
- Edge A: `highway: path`, no `surface`, `scenic: true`
- Edge B: `highway: residential`, `surface: asphalt`

Expected: Edge A gets stronger nature/trail score than Edge B.

**Step 2: Run test to verify failure**

Run:

```bash
npm run test:run -- tests/edge-scorer.test.ts
```

Expected: FAIL if unknown surface path is underweighted.

**Step 3: Adjust edge scoring**

In `lib/engine/edge-scorer.ts`, update natural scoring logic:

```ts
const isUnknownSurfacePathLike = PATH_LIKE_HIGHWAYS.has(highway) && !surface;
const hasRuralOrScenicContext = edge.scenic === true || highway === 'track' || highway === 'path';

if (isUnknownSurfacePathLike && hasRuralOrScenicContext) {
  score += UNKNOWN_SURFACE_PATHLIKE_NATURE_BONUS;
}
```

Use a modest constant so it helps but does not overpower known bad surfaces.

**Step 4: Run test to verify pass**

Run:

```bash
npm run test:run -- tests/edge-scorer.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add lib/engine/edge-scorer.ts tests/edge-scorer.test.ts
git commit -m "feat: score unknown-surface paths as trail candidates"
```

---

### Task 9: Add solver regression for unknown-surface scenic corridor

**Objective:** Ensure the solver prefers a connected unknown-surface wooded corridor over a clean asphalt perimeter loop.

**Files:**
- Modify: `tests/orienteering-solver.test.ts`
- Modify: `lib/engine/orienteering-solver.ts` only if test fails

**Step 1: Write failing test**

Create a small graph similar to existing `makeMappedWoodRoadVsOpenRoadGraph`, but with scenic/path edges lacking `surface`. The expected best route should include the scenic corridor.

Test name:

```ts
it('prefers connected scenic path corridor even when OSM surface tags are missing', () => {
  // Build graph
  // solve
  // expect selected path edge IDs to include unknown-surface scenic corridor
});
```

**Step 2: Run test to verify failure or current pass**

Run:

```bash
npm run test:run -- tests/orienteering-solver.test.ts
```

Expected: ideally FAIL before solver adjustment. If it already passes, keep the test as regression coverage and do not change production code.

**Step 3: Implement only if needed**

If failing, update `isNaturalCorridorEdge` in `lib/engine/orienteering-solver.ts` so `highway=path/track` with missing `surface` and `scenic=true` counts as a valid natural corridor.

**Step 4: Run test to verify pass**

Run:

```bash
npm run test:run -- tests/orienteering-solver.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/orienteering-solver.test.ts lib/engine/orienteering-solver.ts
git commit -m "test: prefer unknown-surface scenic corridors"
```

---

## Phase 5 — Developer-facing audit command

### Task 10: Add internal CLI script for OSM area audit

**Objective:** Allow quick remote audits for any address/coordinate without opening the UI.

**Files:**
- Create: `scripts/audit-osm-area.ts`
- Modify: `package.json`
- Test: optionally create `tests/audit-osm-area.test.ts` only if script logic is factored into testable functions

**Step 1: Factor pure formatting logic first**

If the script will format audit reports, create a pure function in `lib/engine/terrain-audit.ts`:

```ts
export function formatTerrainAuditSummary(report: TerrainAuditReport): string {
  return [
    `Confiance: ${report.confidence}`,
    `Potentiel trail: ${report.trailPotential}`,
    `Chemins path-like: ${Math.round(report.metrics.pathLikeEdgeRatio * 100)}%`,
    `Surfaces inconnues: ${Math.round(report.metrics.unknownSurfaceRatio * 100)}%`,
  ].join('\n');
}
```

Write failing test first for this formatter.

**Step 2: Add script**

The script should accept either coordinates or an address already geocoded by the app. Keep first version coordinate-only to avoid adding geocoding scope.

Command target:

```bash
npm run audit:osm -- --lat 49.139 --lon -0.503 --radius 2500
```

Script behavior:
- calls existing graph building logic if safe in Node context, or a small Overpass query wrapper if graph builder is not convenient;
- builds/analyzes edges;
- prints a concise report.

**Step 3: Add package script**

In `package.json`:

```json
"audit:osm": "tsx scripts/audit-osm-area.ts"
```

If `tsx` is not installed, either use existing project tooling or add it only if the project already uses it. Do not add a new dependency if avoidable.

**Step 4: Run command manually**

Run:

```bash
npm run audit:osm -- --lat 49.139 --lon -0.503 --radius 2500
```

Expected output includes:
- confidence
- trail potential
- path-like ratio
- unknown surface ratio
- warnings
- recommendations

**Step 5: Commit**

```bash
git add scripts/audit-osm-area.ts package.json lib/engine/terrain-audit.ts tests/terrain-audit.test.ts
git commit -m "feat: add OSM terrain audit script"
```

---

## Phase 6 — Product/UI honesty layer

### Task 11: Add terrain confidence copy to route result

**Objective:** Show uncertainty honestly after generation without scaring users prematurely.

**Files:**
- Modify: `components/sidebar/RouteResult.tsx`
- Modify: route result data type if needed in `lib/types.ts`
- Modify: tests if component tests exist

**Step 1: Find current route warning display**

Read:

```bash
components/sidebar/RouteResult.tsx
lib/types.ts
```

Use existing warning rendering if possible. Do not add a new UI section unless warnings are currently invisible.

**Step 2: Add minimal display**

If route quality warnings already render, ensure the new warning text is readable and not hidden behind generic language.

Preferred copy:

```txt
Données terrain moyennes : certains chemins OSM sont peu renseignés. Vérifie le tracé avant sortie.
```

**Step 3: Visual verification**

Run:

```bash
npm run dev
```

Open `/app`, generate or mock a route with the warning, and verify visually.

**Step 4: Commit**

```bash
git add components/sidebar/RouteResult.tsx lib/types.ts
git commit -m "feat: show terrain confidence in route result"
```

---

### Task 12: Add pre-generation area quality hint only if cheap

**Objective:** Before generation, tell the user if the area is likely trail-friendly, but only if this can reuse existing graph data without adding slow calls.

**Files:**
- Modify: `components/sidebar/SessionForm.tsx` only if data is already available
- Modify: app state in `lib/store.ts` if needed
- Avoid this task if it requires an extra Overpass call before every generation

**Step 1: Decide based on performance**

If adding this requires an extra OSM/Overpass request before generation, skip Phase 6 Task 12 for now. It is not worth slowing down the product.

**Step 2: If cheap, display a small hint**

Copy options:

```txt
Zone prometteuse pour trail
Données terrain moyennes
Zone probablement routière
```

Keep it small and non-blocking.

**Step 3: Verify UI**

Run:

```bash
npm run lint
npm run test:run
npm run build
```

**Step 4: Commit only if implemented**

```bash
git add components/sidebar/SessionForm.tsx lib/store.ts
git commit -m "feat: preview terrain confidence before generation"
```

---

## Phase 7 — Documentation and validation

### Task 13: Document the audit model

**Objective:** Make the data-confidence logic understandable for future iterations.

**Files:**
- Create: `docs/terrain-audit-confidence.md`

**Content to include:**

```md
# Terrain Audit Confidence

## Why it exists
TrailForge needs to know when a route is bad because the solver is weak versus when OSM data is incomplete or poorly tagged.

## Metrics
- path-like edge ratio
- natural surface ratio
- unknown surface ratio
- scenic edge ratio
- asphalt ratio
- fragmentation score

## Labels
- high confidence
- medium confidence
- low confidence

## Product behavior
- high potential + medium confidence: generate but warn
- low potential + high asphalt: warn or reduce score
- fragmented natural graph: prefer connected corridors

## Tourville lesson
Tourville shows a common rural OSM pattern: many paths exist, but surfaces are missing. Missing surface must not automatically mean low trail quality.
```

**Step 1: Write doc**

Create `docs/terrain-audit-confidence.md`.

**Step 2: Commit**

```bash
git add docs/terrain-audit-confidence.md
git commit -m "docs: explain terrain audit confidence"
```

---

### Task 14: Full verification and push

**Objective:** Prove the implementation is clean before merging/pushing.

**Files:**
- All modified files

**Step 1: Run targeted tests**

```bash
npm run test:run -- tests/terrain-audit.test.ts tests/edge-scorer.test.ts tests/route-quality.test.ts tests/orienteering-solver.test.ts
```

Expected: all pass.

**Step 2: Run full suite**

```bash
npm run lint
npm run test:run
npm run build
```

Expected: all pass.

**Step 3: Check git diff**

```bash
git status --short
git diff --stat
```

Review that only expected files changed.

**Step 4: Push**

```bash
git push origin main
```

Expected: push succeeds.

---

## Suggested implementation order

Do not start with UI. The order should be:

1. `terrain-audit.ts` core types and metrics.
2. Classification of trail potential/confidence.
3. Fragmentation/corridor continuity.
4. Tourville-like regression case.
5. Route quality warnings and penalties.
6. Edge scoring for unknown-surface path-like roads.
7. Solver regression for unknown-surface scenic corridors.
8. Internal CLI script.
9. UI warning copy.
10. Documentation and full verification.

This sequence keeps risk low. Each step either improves observability or route quality. UI only comes after the engine knows what it is saying.

## Product guardrails

Avoid overpromising. The labels should not say “bonne boucle garantie”. Use language like:

- “Zone prometteuse pour trail”
- “Données terrain moyennes”
- “Vérifie le tracé avant sortie”
- “Zone probablement routière”

TrailForge’s differentiator should become: better loops, but also more honest uncertainty.
