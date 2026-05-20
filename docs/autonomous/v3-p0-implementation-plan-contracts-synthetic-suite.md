# V3-ARCH-A6 — P0 implementation plan: contracts + synthetic suite

> **For Hermes:** Use subagent-driven-development skill only if Clément explicitly demande une exécution multi-agent. Otherwise implement this plan task-by-task in the repo, strict TDD, no push, no merge main.

**Goal:** Créer la fondation P0 du nouvel assembleur V3 mission-driven : contrats TypeScript stables, portfolio candidat inspectable, evidence d’outcome, et suite synthétique RED avant toute modification moteur.

**Architecture:** On ne corrige pas Fontainebleau par une heuristique locale. On pose d’abord les frontières `MissionContract -> StrategyAssembler -> SharedTraversalCore -> CandidatePortfolio -> OutcomeDecider`, puis on force le moteur à satisfaire des graphes synthétiques représentatifs avant de toucher au panel réel. `SharedTraversalCore` reste mécanique; les décisions `generated/adjusted/refused` restent dans `OutcomeDecider`.

**Tech Stack:** TypeScript, Vitest, Next.js repo `/root/work/Tracer`, branche `wip/v3-fontainebleau-loop-quality`, scripts `npm run typecheck`, `npm run lint`, `npm run test:run`, `npm run build`, `npm run benchmark:engine-v3:beta-multiterrain`.

---

## Contraintes non négociables

- Ne pas push.
- Ne pas merge `main`.
- Ne pas baisser les seuils produit.
- Ne jamais reclassifier `asphalt`, `concrete`, `paved`, `scenic_paved` en `trail`.
- Garder `trailRatio`, `naturalWayRatio`, `pavedRatio` séparés dans les types, les métriques, les artifacts et les assertions.
- Un `refused` garde GeoJSON/GPX vides ou explicitement indisponibles.
- Un benchmark qui sort `success: true` n’est pas un verdict produit.
- Si une tâche demande une condition par lieu, coordonnées exactes, ID de benchmark, ville, ou un seuil relaxé pour passer, arrêter et bloquer `criteria-not-met`.

## État source à respecter

Branche attendue : `wip/v3-fontainebleau-loop-quality`.

Dirty state existant observé : nombreux fichiers V3 modifiés et nouveaux docs architecture. L’implémenteur doit d’abord re-vérifier `git status --short --branch` et ne committer que les fichiers de sa mission. Les diffs P5g actuels contiennent des briques utiles (`component-loop-solver`, `multi-cycle`, `trail-spine`, `benchmark-summary`, `edge-semantics`) mais elles ne doivent pas devenir l’architecture finale par accumulation.

Parent architecture A5 : cible `TerrainOpportunityReport -> Intent -> MissionContract -> StrategyAssembler -> SharedTraversalCore -> CandidatePortfolio -> Metrics/Gates -> OutcomeDecider`.

Panel actuel V3 beta-multiterrain : `8/8 refused`, `0 generated`, `0 adjusted`, `0 fake_success`, `0 engine_failure`. Ce résultat est honnête mais non beta-ready.

## Fichiers cibles P0

Créer :

- `lib/engine-v3/contracts/mission-contract.ts`
- `lib/engine-v3/contracts/assembler-result.ts`
- `lib/engine-v3/contracts/candidate-portfolio.ts`
- `lib/engine-v3/contracts/outcome-evidence.ts`
- `lib/engine-v3/contracts/index.ts`
- `lib/engine-v3/testing/synthetic-graphs.ts`
- `tests/engine-v3-contracts.test.ts`
- `tests/engine-v3-synthetic-suite.test.ts`

Modifier :

- `lib/engine-v3/types.ts` : ré-export temporaire ou compatibilité vers les nouveaux contrats, sans casser les imports existants.
- `lib/engine-v3/graph-route-assembler.ts` : seulement quand les contrats et tests RED sont en place; ajouter le point de jonction minimal vers le portfolio/assembler result.
- `lib/engine-v3/outcome-decider.ts` : seulement après contrats; consommer `OutcomeEvidenceV3` ou produire le mapping minimal, sans modifier les seuils.
- `lib/engine-v3/assemblers/forest-loop-assembler.ts`
- `lib/engine-v3/assemblers/transition-to-woods-assembler.ts`
- `lib/engine-v3/assemblers/park-loop-assembler.ts`

À éviter en P0 sauf extraction mécanique strictement nécessaire :

- `lib/engine-v3/assemblers/multi-cycle-dwell-planner.ts`
- `lib/engine-v3/assemblers/trail-spine-selector.ts`
- `lib/engine-v3/assemblers/graph-route-assembly-core.ts`

Ces fichiers peuvent être appelés comme primitives existantes pendant la transition, mais ne doivent pas recevoir de nouvelle politique produit.

## Contrats TypeScript à stabiliser

### MissionContractV3

Créer dans `lib/engine-v3/contracts/mission-contract.ts`.

Le contrat doit remplacer progressivement `CorridorMissionV3` comme frontière opérationnelle. Il fige la mission avant assemblage et ne doit pas être modifié par l’assembleur.

```ts
import type { NormalizedRouteRequestV3, RouteModeV3, RouteStrategyV3, TerrainComponentKindV3 } from '../types';

export type MissionPhaseV3 = 'access' | 'target_dwell' | 'distance_recovery' | 'closure' | 'final_gate';

export type MissionPromiseV3 =
  | 'pure_trail'
  | 'trail_with_connector'
  | 'park_compromise'
  | 'urban_nature'
  | 'best_effort_non_trail'
  | 'impossible';

export interface MissionContractV3 {
  id: string;
  version: 'v3-mission-v1';
  strategy: Exclude<RouteStrategyV3, 'low_trail_potential' | 'unroutable'> | 'poor_osm_rural';
  promise: MissionPromiseV3;
  request: NormalizedRouteRequestV3 & {
    minDistanceKm: number;
    maxDistanceKm: number;
    mode: RouteModeV3;
  };
  phases: MissionPhaseV3[];
  target: {
    componentIds: string[];
    componentKinds: TerrainComponentKindV3[];
    requiredEntry: 'mandatory' | 'preferred' | 'none';
    minNaturalDwellKm: number;
    minContinuousTrailKm: number;
  };
  budgets: {
    maxPavedKm: number;
    maxPavedRatio: number;
    maxBusyRoadRatio: number;
    maxRepeatKm: number;
    maxTargetRepeatKm: number;
    maxConnectorRepeatKm: number;
    maxOverlapRatio: number;
    maxAccessPavedKm: number;
    maxClosurePavedKm: number;
    maxTargetPavedKm: number;
  };
  closure: {
    required: true;
    mode: 'clean_loop' | 'connector_repeat_allowed' | 'relaxed_urban_loop';
    maxClosureKm: number;
  };
  relaxations: Array<{
    id: string;
    allowed: boolean;
    order: number;
    userFacingCompromise: string;
  }>;
  refusalPolicy: {
    refuseIfNoTargetEntry: boolean;
    refuseIfUnderMinDistance: boolean;
    refuseIfDominantPavedTrail: boolean;
    refuseIfMissingGpsGeometry: boolean;
  };
}
```

Tests contractuels attendus :

- `forest_loop` exige `access`, `target_dwell`, `distance_recovery`, `closure`, `final_gate`.
- `transition_to_woods` autorise `connector_repeat_allowed` mais garde `maxTargetRepeatKm` strict.
- `park_loop` peut autoriser `park_compromise` mais ne peut pas promettre `pure_trail` si `target.componentKinds=['park']` et paved park paths dominants.
- `poor_osm_rural` ne doit pas autoriser `generated` sans confiance surface suffisante dans l’evidence.

### CandidatePortfolioV3

Créer dans `lib/engine-v3/contracts/candidate-portfolio.ts`.

Le portfolio doit garder les routes rejetées utiles et empêcher les candidats de diagnostic d’entrer dans la décision utilisateur.

```ts
import type { RouteGeometryV3, RouteMetricsV3, TerrainComponentKindV3 } from '../types';

export type CandidateLaneV3 =
  | 'complete_valid'
  | 'complete_adjustable'
  | 'progress_no_closure'
  | 'dwell_only'
  | 'connector_heavy'
  | 'diagnostic_only'
  | 'negative_evidence';

export type CandidateLifecycleV3 =
  | 'discovered'
  | 'expanded'
  | 'closed'
  | 'metricized'
  | 'gated'
  | 'selected'
  | 'rejected';

export interface CandidateGateV3 {
  id: string;
  status: 'pass' | 'fail' | 'warning';
  severity: 'info' | 'soft' | 'hard';
  reason?: string;
}

export interface RouteCandidateV3 {
  id: string;
  source: 'strategy_assembler' | 'target_component' | 'cycle_chain' | 'park_loop' | 'urban_corridor' | 'fallback' | 'diagnostic';
  lane: CandidateLaneV3;
  lifecycle: CandidateLifecycleV3;
  edgeIds: string[];
  nodeIds: string[];
  geometry: RouteGeometryV3;
  targetComponentIds: string[];
  targetComponentKinds: TerrainComponentKindV3[];
  returned: boolean;
  metrics: RouteMetricsV3;
  gates: CandidateGateV3[];
  selectionScore: number;
  selected: boolean;
  selectedReason?: string;
  rejectedReason?: string;
}

export interface CandidatePortfolioV3 {
  missionId: string;
  candidates: RouteCandidateV3[];
  selectedCandidateId: string | null;
  topRejected: RouteCandidateV3[];
  counts: Record<CandidateLaneV3, number> & {
    discovered: number;
    closed: number;
    inEnvelope: number;
    rejected: number;
  };
  diagnostics: {
    firstDropStage: string | null;
    blocker: string | null;
    phaseBlockers: Record<string, string[]>;
  };
}
```

Règles à tester :

- `diagnostic_only`, `negative_evidence`, `progress_no_closure` ne peuvent jamais être `selected`.
- Un candidat non retourné ne peut jamais être `complete_valid`.
- Un candidat sans géométrie GPS ne peut pas être `complete_valid` ni `complete_adjustable`.
- `topRejected` conserve au moins les meilleurs candidats de progrès avec raisons, même si `selectedCandidateId=null`.

### AssemblerResultV3

Créer dans `lib/engine-v3/contracts/assembler-result.ts`.

L’assembleur retourne un portfolio, pas un outcome produit.

```ts
import type { MissionContractV3 } from './mission-contract';
import type { CandidatePortfolioV3, RouteCandidateV3 } from './candidate-portfolio';

export interface AssemblyPhaseDiagnosticsV3 {
  access: {
    status: 'success' | 'failure' | 'not_applicable';
    accessKm: number;
    accessPavedKm: number;
    entryNodeId: string | null;
    componentId: string | null;
    rejectedEntryReasons: Record<string, number>;
  };
  dwell: {
    status: 'success' | 'failure' | 'partial' | 'not_applicable';
    targetDwellKm: number;
    requestedTargetDwellKm: number;
    longestTrailSegmentKm: number;
    cleanExploitableKm: number;
    targetRepeatKm: number;
  };
  recovery: {
    status: 'success' | 'failure' | 'not_attempted';
    recoveredDistanceKm: number;
    recoveryPavedKm: number;
    recoveryRejectedReasons: Record<string, number>;
  };
  closure: {
    status: 'success' | 'failure' | 'not_attempted';
    closureKm: number;
    closurePavedKm: number;
    connectorRepeatKm: number;
    targetRepeatKm: number;
    closureRejectedReasons: Record<string, number>;
  };
  finalGate: {
    status: 'candidate_ready' | 'no_selectable_candidate';
    distanceKm: number;
    finalPavedRatioEstimate: number;
    trailRatio: number;
    naturalWayRatio: number;
    pavedRatio: number;
    gateFailures: string[];
  };
}

export interface AssemblerResultV3 {
  mission: MissionContractV3;
  status: 'portfolio_ready' | 'no_candidate';
  portfolio: CandidatePortfolioV3;
  selectedCandidate: RouteCandidateV3 | null;
  phaseDiagnostics: AssemblyPhaseDiagnosticsV3;
  diagnostics: {
    startNodeId: string | null;
    targetEntryAttempted: boolean;
    targetEntrySucceeded: boolean;
    closureAttempted: boolean;
    closureSucceeded: boolean;
    firstDropStage: string | null;
    blocker: string | null;
    observationOnly: Record<string, unknown>;
  };
  warnings: string[];
}
```

Règle clé : ce type ne doit contenir aucun champ `generated`, `adjusted`, `refused`, `productVerdict`, ou `benchmarkSuccess`.

### OutcomeEvidenceV3

Créer dans `lib/engine-v3/contracts/outcome-evidence.ts`.

```ts
export type ProductVerdictV3 = 'good_route' | 'acceptable_adjusted' | 'honest_refusal' | 'fake_success' | 'engine_failure';

export interface OutcomeEvidenceV3 {
  missionId: string;
  selectedCandidateId: string | null;
  productOutcome: 'generated' | 'adjusted' | 'refused';
  primaryReason: string;
  userFacingSummary: string;
  reasons: string[];
  compromises: string[];
  hardGateFailures: string[];
  benchmarkEvidence: {
    commandSucceeded?: boolean;
    productVerdict: ProductVerdictV3;
  };
  exportPolicy: {
    geoJsonAvailable: boolean;
    gpxAvailable: boolean;
    emptyOnRefusal: boolean;
  };
  surfaceEvidence: {
    trailRatio: number;
    naturalWayRatio: number;
    pavedRatio: number;
    pavedKm: number;
    naturalDwellKm: number;
  } | null;
}
```

Tests attendus :

- `refused` implique `selectedCandidateId=null`, `geoJsonAvailable=false`, `gpxAvailable=false`, `emptyOnRefusal=true` sauf cas legacy explicitement marqué non conforme.
- `generated` avec `hardGateFailures.length>0` est interdit.
- `adjusted` exige au moins un compromis user-facing.
- `surfaceEvidence` expose toujours les trois ratios séparés quand une route existe.

---

## Synthetic graph suite avant moteur

Créer `lib/engine-v3/testing/synthetic-graphs.ts` avec des builders déterministes. Le but n’est pas de modéliser OSM exhaustivement; le but est d’avoir cinq graphes qui cassent les mauvaises architectures.

Les helpers doivent réutiliser les types existants `EnrichedGraph`, `EnrichedEdge`, `GraphNode` de `@/lib/types`, avec un mini DSL :

```ts
export interface SyntheticGraphCaseV3 {
  id: string;
  description: string;
  graph: EnrichedGraph;
  mission: MissionContractV3;
  expected: {
    selectableCandidate: boolean;
    expectedOutcome: 'generated' | 'adjusted' | 'refused';
    minDistanceKm?: number;
    minNaturalDwellKm?: number;
    maxPavedRatio?: number;
    requiredPortfolioLane?: CandidateLaneV3;
    forbiddenTrailEdgeIds?: string[];
    requiredBlocker?: string;
  };
}
```

### Case 1 — `large_forest_loop`

Objectif : prouver qu’un large composant forestier exploitable doit produire au moins un candidat `complete_valid` sans passer par scenic paved.

Fixture : départ proche d’un massif; accès court; boucle interne forest/path/track de 8–12 km; decoy scenic paved plus court mais pavé.

RED test :

```ts
it('large_forest_loop builds a complete forest candidate and ignores scenic paved trap', () => {
  const scenario = syntheticLargeForestLoop();
  const result = assembleMissionV3(scenario.graph, scenario.mission);

  expect(result.portfolio.selectedCandidateId).not.toBeNull();
  expect(result.selectedCandidate?.lane).toBe('complete_valid');
  expect(result.selectedCandidate?.metrics.naturalDwellKm).toBeGreaterThanOrEqual(scenario.expected.minNaturalDwellKm!);
  expect(result.selectedCandidate?.metrics.pavedRatio).toBeLessThanOrEqual(scenario.expected.maxPavedRatio!);
  expect(result.selectedCandidate?.metrics.trailRatio).toBeGreaterThan(0);
  expect(result.selectedCandidate?.edgeIds).not.toEqual(expect.arrayContaining(scenario.expected.forbiddenTrailEdgeIds!));
});
```

Expected RED : fail car `assembleMissionV3` ou `MissionContractV3` n’existe pas encore.

### Case 2 — `transition_woods_connector_then_dwell`

Objectif : accepter une transition pavée honnête, puis interdire closure/retour avant dwell naturel suffisant.

Fixture : départ village; connecteur pavé 0.8–1.2 km; composant field_paths/forest; fermeture possible par le même connecteur; decoy petite boucle résidentielle retournée mais 0 dwell.

Assertions :

- `access.status='success'`.
- `dwell.status='success'` avant `closure.status='success'`.
- `targetRepeatKm` reste sous budget.
- `connectorRepeatKm` peut être > 0 si la mission autorise `connector_repeat_allowed`.
- La boucle résidentielle retournée va en `diagnostic_only` ou `negative_evidence`, jamais `complete_valid`.

### Case 3 — `park_small_adjusted_or_refused`

Objectif : un petit parc ne doit pas être étiré en boucle résidentielle pavée vendue comme trail.

Fixture : parc de 1.8–2.5 km utilisables, demande 6 km, chemins éventuellement paved mais dans parc, routes résidentielles autour.

Assertions :

- Si la mission autorise `park_compromise`, outcome `adjusted` avec distance réduite et compromis clair.
- Si la mission demande `pure_trail`, outcome `refused`.
- Aucun edge résidentiel pavé ne doit être compté comme trail.
- `pavedRatio` peut être élevé mais reste explicitement paved.

### Case 4 — `rural_poor_surface_confidence_refusal`

Objectif : données OSM pauvres, surfaces unknown/road-like, pas de dwell fiable. Le moteur doit refuser proprement ou best-effort non-trail uniquement si contrat l’autorise.

Fixture : rural connecté, quelques tracks inconnus, beaucoup de routes paved/unknown road-like, faible confidence.

Assertions :

- `selectedCandidateId=null` pour promesse trail.
- `phaseDiagnostics.finalGate.gateFailures` contient une raison type `weak_surface_confidence` ou `insufficient_target_dwell`.
- `OutcomeEvidenceV3.productOutcome='refused'`.
- `exportPolicy.emptyOnRefusal=true`.
- `naturalWayRatio` peut refléter les chemins inconnus, mais `trailRatio` reste bas.

### Case 5 — `scenic_paved_trap`

Objectif : empêcher la triche la plus dangereuse : route asphaltée scenic en forêt qui ressemble jolie mais n’est pas trail.

Fixture : deux alternatives de même distance :

- option A : scenic asphalt/service roads en forêt, fermée, facile;
- option B : path/track naturel partiel avec meilleure promesse mais fermeture plus dure.

Assertions :

- Les edges asphalt/concrete/scenic paved contribuent à `pavedKm` et `pavedRatio`.
- Elles ne contribuent pas à `strictTrailKm` ni à `trailRatio`.
- Si l’option A est la seule route complète, elle ne peut être que `adjusted` non-trail ou `refused`, jamais `generated` trail.
- `OutcomeEvidenceV3.primaryReason` doit nommer `dominant_paved_scenic_core` ou équivalent.

---

## Ordre d’implémentation P0

### Task 1: Préflight repo et gel de portée

**Objective:** Vérifier branche, dirty state et scripts disponibles avant d’écrire une ligne.

**Files:** Aucun fichier modifié.

**Step 1: Vérifier branche et dirty state**

Run:

```bash
cd /root/work/Tracer
git status --short --branch
git branch --show-current
```

Expected: branch `wip/v3-fontainebleau-loop-quality`. Dirty state possible, mais il faut noter les fichiers déjà modifiés avant la mission.

**Step 2: Vérifier scripts**

Run:

```bash
node -e "const p=require('./package.json'); console.log(p.scripts.typecheck, p.scripts.lint, p.scripts['benchmark:engine-v3:beta-multiterrain'])"
```

Expected: affiche `tsc --noEmit`, `eslint .`, et la commande benchmark V3.

**Step 3: Commit**

Pas de commit.

### Task 2: Écrire les tests RED des contrats

**Objective:** Verrouiller la forme des contrats avant de créer les types.

**Files:**

- Create: `tests/engine-v3-contracts.test.ts`

**Step 1: Write failing test**

Créer les tests suivants :

```ts
import { describe, expect, it } from 'vitest';
import type { AssemblerResultV3, CandidatePortfolioV3, MissionContractV3, OutcomeEvidenceV3 } from '@/lib/engine-v3/contracts';

describe('V3 mission-driven contracts', () => {
  it('keeps assembler result separate from product outcome', () => {
    const result = {} as AssemblerResultV3;
    expect('productOutcome' in result).toBe(false);
    expect('generated' in result).toBe(false);
    expect('adjusted' in result).toBe(false);
    expect('refused' in result).toBe(false);
  });

  it('represents trail surface metrics separately in outcome evidence', () => {
    const evidence = {
      productOutcome: 'generated',
      hardGateFailures: [],
      compromises: [],
      exportPolicy: { geoJsonAvailable: true, gpxAvailable: true, emptyOnRefusal: false },
      surfaceEvidence: { trailRatio: 0.42, naturalWayRatio: 0.67, pavedRatio: 0.24, pavedKm: 2.4, naturalDwellKm: 6.7 },
    } satisfies Partial<OutcomeEvidenceV3>;

    expect(evidence.surfaceEvidence?.trailRatio).not.toBe(evidence.surfaceEvidence?.naturalWayRatio);
    expect(evidence.surfaceEvidence?.pavedRatio).toBeGreaterThan(0);
  });

  it('forbids selecting diagnostic-only candidates', () => {
    const portfolio = {
      selectedCandidateId: null,
      candidates: [{ id: 'diag-1', lane: 'diagnostic_only', selected: false, returned: false }],
    } satisfies Partial<CandidatePortfolioV3>;

    expect(portfolio.candidates[0]?.selected).toBe(false);
    expect(portfolio.selectedCandidateId).toBeNull();
  });

  it('mission contract exposes phase budgets instead of hidden strategy flags', () => {
    const mission = {
      version: 'v3-mission-v1',
      phases: ['access', 'target_dwell', 'distance_recovery', 'closure', 'final_gate'],
      budgets: { maxPavedRatio: 0.32, maxTargetRepeatKm: 0.1, maxConnectorRepeatKm: 2 },
      refusalPolicy: { refuseIfDominantPavedTrail: true },
    } satisfies Partial<MissionContractV3>;

    expect(mission.phases).toContain('target_dwell');
    expect(mission.budgets.maxPavedRatio).toBeLessThan(0.5);
    expect(mission.refusalPolicy.refuseIfDominantPavedTrail).toBe(true);
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
npm run test:run -- tests/engine-v3-contracts.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/engine-v3/contracts'`.

**Step 3: Commit**

Ne pas commit si RED seul et repo déjà dirty multi-mission. Laisser pour Task 3 ou commit local si le workflow courant accepte les commits intermédiaires.

### Task 3: Créer les contrats TypeScript minimaux

**Objective:** Faire passer les tests contractuels sans brancher le moteur.

**Files:**

- Create: `lib/engine-v3/contracts/mission-contract.ts`
- Create: `lib/engine-v3/contracts/candidate-portfolio.ts`
- Create: `lib/engine-v3/contracts/assembler-result.ts`
- Create: `lib/engine-v3/contracts/outcome-evidence.ts`
- Create: `lib/engine-v3/contracts/index.ts`
- Modify: `lib/engine-v3/types.ts` only if needed for temporary exports.

**Step 1: Minimal implementation**

Ajouter les interfaces décrites dans la section contrats. `index.ts` doit ré-exporter uniquement :

```ts
export * from './mission-contract';
export * from './candidate-portfolio';
export * from './assembler-result';
export * from './outcome-evidence';
```

**Step 2: Run test to verify pass**

Run:

```bash
npm run test:run -- tests/engine-v3-contracts.test.ts
```

Expected: PASS.

**Step 3: Run typecheck scoped enough to catch aliases**

Run:

```bash
npm run typecheck
```

Expected: PASS or fail only on pre-existing dirty work. If fail, inspect whether the new contracts introduced the error. Do not modify unrelated files.

**Step 4: Commit**

Commit only if allowed by the current human workflow. If committing:

```bash
git add lib/engine-v3/contracts tests/engine-v3-contracts.test.ts
git commit -m "feat: add V3 mission-driven contracts"
```

### Task 4: Écrire les builders synthétiques en RED minimal

**Objective:** Créer la suite de graphes synthétiques comme API de test, avant tout moteur.

**Files:**

- Create: `tests/engine-v3-synthetic-suite.test.ts`
- Create later: `lib/engine-v3/testing/synthetic-graphs.ts`

**Step 1: Write failing test imports**

Dans `tests/engine-v3-synthetic-suite.test.ts`, importer les fixtures attendues :

```ts
import { describe, expect, it } from 'vitest';
import {
  syntheticLargeForestLoop,
  syntheticParkSmall,
  syntheticRuralPoorSurfaceConfidence,
  syntheticScenicPavedTrap,
  syntheticTransitionWoodsConnectorThenDwell,
} from '@/lib/engine-v3/testing/synthetic-graphs';

describe('V3 synthetic graph suite fixtures', () => {
  it('defines five product-critical synthetic cases', () => {
    const cases = [
      syntheticLargeForestLoop(),
      syntheticTransitionWoodsConnectorThenDwell(),
      syntheticParkSmall(),
      syntheticRuralPoorSurfaceConfidence(),
      syntheticScenicPavedTrap(),
    ];

    expect(cases.map((item) => item.id)).toEqual([
      'large_forest_loop',
      'transition_woods_connector_then_dwell',
      'park_small_adjusted_or_refused',
      'rural_poor_surface_confidence_refusal',
      'scenic_paved_trap',
    ]);
    expect(cases.every((item) => item.graph.nodes.size > 0)).toBe(true);
    expect(cases.every((item) => item.graph.edges.size > 0)).toBe(true);
    expect(cases.every((item) => item.mission.version === 'v3-mission-v1')).toBe(true);
  });
});
```

**Step 2: Run test to verify failure**

Run:

```bash
npm run test:run -- tests/engine-v3-synthetic-suite.test.ts
```

Expected: FAIL — missing `synthetic-graphs` module.

### Task 5: Implémenter le DSL synthétique sans moteur

**Objective:** Fournir des graphes déterministes exploitables par les prochains tests assembleur.

**Files:**

- Create: `lib/engine-v3/testing/synthetic-graphs.ts`

**Step 1: Minimal implementation**

Créer helpers :

- `makeNode(id, index)`
- `makeEdge({ id, from, to, lengthKm, surface, highway, componentKind, landcoverClass, scenic })`
- `makeGraph(edges)`
- `makeMission(overrides)`

Puis exposer les cinq fixtures.

Chaque fixture doit renseigner :

- `id`
- `description`
- `graph`
- `mission`
- `expected`

**Step 2: Run fixture test**

Run:

```bash
npm run test:run -- tests/engine-v3-synthetic-suite.test.ts
```

Expected: PASS pour les tests de forme uniquement.

**Step 3: Add semantic fixture assertions**

Ajouter dans le même fichier :

- large forest contient au moins 8 km de `ground/path|track` et au moins un decoy `asphalt` scenic.
- transition woods contient au moins un connecteur paved et une cible natural.
- park small a `targetDistanceKm` supérieur à la capacité park.
- rural poor a confidence faible ou warnings mission.
- scenic trap contient une route complète asphalt scenic et une alternative natural.

Run à nouveau, expected PASS.

### Task 6: Écrire les RED tests assembleur contre les fixtures

**Objective:** Créer les tests qui échoueront tant que l’architecture mission-driven n’existe pas.

**Files:**

- Modify: `tests/engine-v3-synthetic-suite.test.ts`

**Step 1: Add expected API import**

Importer une API cible volontaire :

```ts
import { assembleMissionV3 } from '@/lib/engine-v3/assemblers/mission-dispatcher';
```

**Step 2: Add five RED behaviors**

Ajouter un `describe('V3 mission dispatcher synthetic behavior')` avec :

1. `large_forest_loop builds complete_valid and rejects scenic paved trap`
2. `transition_woods_connector_then_dwell delays closure until dwell succeeds`
3. `park_small returns adjusted/refused but never generated trail`
4. `rural_poor_surface_confidence refuses with empty exports policy evidence`
5. `scenic_paved_trap keeps scenic asphalt out of trailRatio`

**Step 3: Run test to verify failure**

Run:

```bash
npm run test:run -- tests/engine-v3-synthetic-suite.test.ts
```

Expected: FAIL — missing `mission-dispatcher`. This is the correct RED state.

### Task 7: Créer le dispatcher mission skeleton

**Objective:** Introduire l’entrée architecture sans déplacer de politique dans le core.

**Files:**

- Create: `lib/engine-v3/assemblers/mission-dispatcher.ts`
- Modify: `lib/engine-v3/assemblers/forest-loop-assembler.ts`
- Modify: `lib/engine-v3/assemblers/transition-to-woods-assembler.ts`
- Modify: `lib/engine-v3/assemblers/park-loop-assembler.ts`

**Step 1: Minimal implementation**

`assembleMissionV3(graph, mission): AssemblerResultV3` doit dispatcher par `mission.strategy` :

- `forest_loop` -> `assembleForestLoopMissionV3`
- `transition_to_woods` -> `assembleTransitionToWoodsMissionV3`
- `park_loop` -> `assembleParkLoopMissionV3`
- `urban_nature_loop` -> pour P0, retour `no_candidate` avec blocker `strategy_not_supported_yet` si non implémenté.
- `poor_osm_rural` -> retour refus/negative evidence portfolio, sans generated.

Les assembleurs stratégie peuvent d’abord retourner un portfolio vide typé, avec `phaseDiagnostics` complète. Ce squelette doit faire passer les tests contractuels, pas les cinq comportements.

**Step 2: Run tests**

Run:

```bash
npm run test:run -- tests/engine-v3-contracts.test.ts tests/engine-v3-synthetic-suite.test.ts
```

Expected: contracts PASS; synthetic behavior still FAIL on assertions métier. C’est normal.

### Task 8: Brancher CandidatePortfolio normalization

**Objective:** Garantir qu’aucun candidat non retourné/diagnostic/sans geometry ne peut être sélectionné.

**Files:**

- Create: `lib/engine-v3/assemblers/candidate-portfolio.ts` or `lib/engine-v3/contracts/candidate-portfolio.ts` helpers if preferred.
- Modify: `tests/engine-v3-contracts.test.ts`

**Step 1: Write failing tests for helpers**

Tester :

- `normalizeCandidatePortfolioV3` force `selected=false` sur `diagnostic_only`.
- `selectCandidateFromPortfolioV3` ignore `progress_no_closure`.
- `complete_valid` exige `returned=true`, geometry non vide, hard gates pass.

**Step 2: Run RED**

Run:

```bash
npm run test:run -- tests/engine-v3-contracts.test.ts
```

Expected: FAIL — helpers missing.

**Step 3: Implement minimal helper**

Implémenter sans connaissance produit fine, uniquement règles structurelles.

**Step 4: Run GREEN**

Run:

```bash
npm run test:run -- tests/engine-v3-contracts.test.ts
```

Expected: PASS.

### Task 9: Premier comportement large forest

**Objective:** Faire passer seulement `large_forest_loop`, sans heuristique par lieu.

**Files:**

- Modify: `lib/engine-v3/assemblers/forest-loop-assembler.ts`
- Modify: `lib/engine-v3/assemblers/mission-dispatcher.ts` if needed.
- Modify: `tests/engine-v3-synthetic-suite.test.ts` only to tighten assertions, jamais pour les relâcher.

**Step 1: Verify RED**

Run:

```bash
npm run test:run -- tests/engine-v3-synthetic-suite.test.ts -t "large_forest_loop"
```

Expected: FAIL on missing selected complete candidate or scenic paved selected.

**Step 2: Minimal implementation**

Le `ForestLoopAssembler` doit :

- lire `mission.target.componentKinds`;
- ignorer explicitement `surface=asphalt|concrete|paved` pour strict trail;
- construire un candidat complet depuis edges naturelles du composant;
- créer un candidat scenic paved en `connector_heavy` ou `diagnostic_only` avec `rejectedReason='dominant_paved_scenic_core'`;
- passer par `CandidatePortfolio`.

**Step 3: Run GREEN**

Run:

```bash
npm run test:run -- tests/engine-v3-synthetic-suite.test.ts -t "large_forest_loop"
```

Expected: PASS.

### Task 10: Premier comportement transition-to-woods

**Objective:** Prouver access -> dwell -> closure avec connecteur honnête.

**Files:**

- Modify: `lib/engine-v3/assemblers/transition-to-woods-assembler.ts`

**Step 1: Verify RED**

Run:

```bash
npm run test:run -- tests/engine-v3-synthetic-suite.test.ts -t "transition_woods"
```

Expected: FAIL.

**Step 2: Minimal implementation**

- Le connecteur pavé compte dans `accessPavedKm`.
- La closure ne devient sélectionnable qu’après `targetDwellKm >= mission.target.minNaturalDwellKm`.
- `connectorRepeatKm` peut être > 0 si `mission.closure.mode='connector_repeat_allowed'`.
- `targetRepeatKm` reste gate hard.

**Step 3: Run GREEN**

Run:

```bash
npm run test:run -- tests/engine-v3-synthetic-suite.test.ts -t "transition_woods"
```

Expected: PASS.

### Task 11: Park small et rural poor comme garde-fous anti-fake-success

**Objective:** Empêcher le moteur de sortir une fausse route sur terrains contraints ou données faibles.

**Files:**

- Modify: `lib/engine-v3/assemblers/park-loop-assembler.ts`
- Create or Modify: `lib/engine-v3/assemblers/poor-osm-rural-assembler.ts` if the dispatcher gets a separate file.

**Step 1: Verify RED**

Run:

```bash
npm run test:run -- tests/engine-v3-synthetic-suite.test.ts -t "park_small|rural_poor"
```

Expected: FAIL.

**Step 2: Minimal implementation**

Park :

- Si distance parc exploitable < min distance generated, produire `complete_adjustable` seulement si mission relaxation autorisée.
- Sinon `no_candidate` avec `blocker='park_capacity_below_requested_distance'`.

Rural poor :

- Si surface confidence faible et dwell strict absent, produire `negative_evidence` + `OutcomeEvidence` refus.
- Ne pas compter road-like unknown en strict trail.

**Step 3: Run GREEN**

Run:

```bash
npm run test:run -- tests/engine-v3-synthetic-suite.test.ts -t "park_small|rural_poor"
```

Expected: PASS.

### Task 12: Scenic paved trap final

**Objective:** Verrouiller la séparation paved/scenic/trail avant benchmark réel.

**Files:**

- Modify: `lib/engine-v3/edge-semantics.ts` only if the bug est dans la sémantique.
- Modify: `lib/engine-v3/route-metrics.ts` only if le calcul mélange ratios.
- Modify: relevant assembler only if le bug est dans la sélection.

**Step 1: Verify RED**

Run:

```bash
npm run test:run -- tests/engine-v3-synthetic-suite.test.ts -t "scenic_paved_trap"
```

Expected: FAIL until scenic paved cannot be generated trail.

**Step 2: Minimal implementation**

- `asphalt/concrete/paved/scenic_paved` => `pavedKm`, `pavedRatio`.
- `strictTrailKm` reste 0 sur scenic paved.
- Si scenic paved est sélectionnable, seulement `complete_adjustable` avec promise non-trail ou refus.

**Step 3: Run GREEN**

Run:

```bash
npm run test:run -- tests/engine-v3-synthetic-suite.test.ts -t "scenic_paved_trap"
```

Expected: PASS.

### Task 13: OutcomeEvidence mapping minimal

**Objective:** Rendre l’outcome inspectable sans déplacer la décision dans le benchmark.

**Files:**

- Modify: `lib/engine-v3/outcome-decider.ts`
- Modify: `tests/engine-v3-contracts.test.ts`

**Step 1: Write failing tests**

Ajouter :

- generated + hard gate fail => refused/fake_success prevention.
- adjusted sans compromise => refused.
- refused => exports unavailable.
- route exists => surface evidence ratios séparés.

**Step 2: Run RED**

Run:

```bash
npm run test:run -- tests/engine-v3-contracts.test.ts -t "OutcomeEvidence"
```

Expected: FAIL.

**Step 3: Implement minimal mapping**

Créer une fonction pure, par exemple `buildOutcomeEvidenceV3({ mission, portfolio, selectedCandidate, outcome })`.

**Step 4: Run GREEN**

Run:

```bash
npm run test:run -- tests/engine-v3-contracts.test.ts -t "OutcomeEvidence"
```

Expected: PASS.

### Task 14: Compatibilité ancienne API V3

**Objective:** Conserver l’API existante pendant la migration.

**Files:**

- Modify: `lib/engine-v3/graph-route-assembler.ts`
- Modify: `lib/engine-v3/route-generator.ts` only if compile demands it.
- Modify: `lib/engine-v3/types.ts` only for adapters.

**Step 1: Run existing tests before patch**

Run:

```bash
npm run test:run -- tests/engine-v3-graph-assembler.test.ts tests/engine-v3-target-component-traversal.test.ts tests/engine-v3-export.test.ts
```

Expected: current baseline. If fail pre-existing, record it before modifications.

**Step 2: Add adapter not rewrite**

- `assembleGraphRouteV3` peut continuer à retourner `AssembledRouteV3`.
- Le nouveau `assembleMissionV3` retourne `AssemblerResultV3`.
- Aucun appel public ne doit perdre GeoJSON/GPX semantics.

**Step 3: Run existing tests after patch**

Run same command.

Expected: no new regression.

### Task 15: Full validation gates

**Objective:** Vérifier que P0 est implémentable et non régressif.

**Files:** Aucun nouveau fichier sauf corrections nécessaires.

Run in order:

```bash
git diff --check
npm run typecheck
npm run lint
npm run test:run
npm run build
npm run benchmark:engine-v3:beta-multiterrain
```

Expected:

- `git diff --check`: PASS.
- `typecheck/lint/test/build`: PASS or documented pre-existing failure from before Task 1. Ne pas ignorer un échec introduit.
- `benchmark:engine-v3:beta-multiterrain`: le résultat produit n’a pas besoin d’être 8/8 green en P0 contracts, mais doit rester `0 fake_success`, `0 engine_failure`, sans seuil relaxé ni paved maquillé.

Après benchmark, lire l’aggregate :

```bash
node -e "const r=require('./artifacts/engine-v3-benchmarks/beta-multiterrain-latest.json'); console.log(JSON.stringify({generated:r.generated, adjusted:r.adjusted, refused:r.refused, fake_success:r.fake_success, engine_failure:r.engine_failure}, null, 2))"
```

Si le shape JSON diffère, inspecter manuellement l’artifact et reporter les vrais compteurs.

---

## Critères de blocage immédiat

Bloquer `criteria-not-met` au lieu de continuer si :

- un test ou une implémentation exige de baisser `maxPavedRatio`, `minNaturalDwellKm`, distance min, closure ou repeat gates pour passer;
- une solution dépend d’un ID benchmark, nom de ville, coordonnées exactes, ou cas Fontainebleau/Tourville hardcodé;
- `asphalt/concrete/paved/scenic_paved` est compté dans `trailRatio` ou `strictTrailKm`;
- un candidat non retourné ou sans geometry devient `generated` ou `adjusted`;
- `diagnostic_only`, `progress_no_closure` ou `negative_evidence` devient sélectionnable;
- `OutcomeDecider` lit `benchmarkSummary` pour décider une route;
- `SharedTraversalCore` prend des options produit opaques type `mode: generic` pour choisir la politique;
- le benchmark sort un `fake_success` ou un `engine_failure` nouveau;
- GeoJSON/GPX sont produits sur refus;
- la migration détruit la compatibilité de `assembleGraphRouteV3` sans adapter explicite.

## Critères de réussite P0

P0 est terminé quand :

- les quatre contrats existent et sont exportés via `lib/engine-v3/contracts/index.ts`;
- les tests contractuels prouvent la séparation assembler/outcome/portfolio/evidence;
- les cinq fixtures synthétiques existent et sont déterministes;
- les cinq comportements synthétiques sont en RED puis GREEN, un par un;
- les strategy assemblers ne sont plus de simples wrappers pour au moins `forest_loop`, `transition_to_woods`, `park_loop`;
- le dispatcher `assembleMissionV3` retourne `AssemblerResultV3` sans outcome produit direct;
- `OutcomeEvidenceV3` conserve les ratios séparés et les policies d’export;
- les gates `git diff --check`, `typecheck`, `lint`, `test:run`, `build` passent ou les seuls échecs sont prouvés préexistants;
- le benchmark ciblé beta-multiterrain reste honnête : `0 fake_success`, `0 engine_failure`, pas de seuil relax, pas de paved-to-trail.

## Ce que P0 ne doit pas promettre

P0 ne promet pas encore la beta V3.

P0 ne promet pas 8/8 generated/adjusted.

P0 ne promet pas que Fontainebleau est corrigé.

P0 promet une architecture testable qui empêche l’empilement d’heuristiques : tout progrès réel devra passer par mission, portfolio, evidence et gates produit explicites.
