# TrailForge V3 — RFC/ADR architecture assembleur clean-room

Date: 2026-05-19  
Statut: RFC architecture, sans implémentation moteur  
Branche observée: `wip/v3-fontainebleau-loop-quality`  
Contexte benchmark: panel V3 beta-multiterrain = `generated=0`, `adjusted=0`, `refused=8`, `errored=0`, `fake_success=0`.

## Résumé exécutif

V3 a gagné un point important: elle refuse honnêtement au lieu de sortir une fausse route. Les refus gardent GeoJSON/GPX vides, les métriques `trailRatio`, `naturalWayRatio` et `pavedRatio` restent séparées, et le benchmark distingue réussite de commande et réussite produit.

Mais V3 n’est pas beta-ready. Le signal 8/8 refused avec plusieurs terrains à forte capacité naturelle visible prouve que le problème n’est pas seulement Fontainebleau, OSM, ou un seuil trop strict. Le problème probable est architectural: l’assemblage mélange encore opportunité terrain, mission, traversal, heuristiques de réparation, sélection de candidats, métriques et décision produit.

La cible proposée est une reconstruction stricte du pipeline:

```text
Graph Builder
  -> Edge Semantics
  -> TerrainOpportunityReport
  -> Intent
  -> Mission contract
  -> StrategyAssembler
  -> SharedTraversalCore
  -> CandidatePortfolio
  -> Metrics/Gates
  -> OutcomeDecider
  -> Export
```

L’objectif court terme ne doit pas être 8/8 verts. L’objectif sain est d’obtenir quelques routes exploitables et honnêtes sur terrains compatibles — Fontainebleau, Meudon, Tourville 8k, Caen — plus au moins un refus négatif propre. Tant que V3 produit zéro route utilisable, elle reste observability-only.

## Décision de principe

On arrête l’empilement d’heuristiques dans `multi-cycle`, `TrailSpine`, les closures et les fallbacks pour verdir un benchmark. Les heuristiques ne sont acceptables que si elles vivent dans une couche explicitement responsable, avec contrat d’entrée/sortie, diagnostics observation-only, et tests qui prouvent la raison produit.

Un candidat ne devient jamais une route parce qu’il est “moins mauvais”. Il suit un cycle explicite: découvert, évalué, enrichi en métriques, rejeté ou sélectionné avec raison stable, puis seulement accepté/ajusté/refusé par `OutcomeDecider`.

## Frontières strictes par couche

### 1. Graph Builder

Responsabilité: construire un graphe routable réel depuis OSM/Overpass ou une fixture synthétique.

Entrées: requête normalisée, zone, profil de routabilité, contraintes système.  
Sorties: nodes, edges, tags OSM bruts, longueurs, géométrie, accès, sens, restrictions, métadonnées minimales.

Autorisé:

- filtrer les edges non routables ou dangereux au niveau graphe;
- conserver tags surface/highway/access/scenic/natural context;
- exposer connectivité, densité, composants bruts si déjà calculés mécaniquement;
- échouer proprement si Overpass ou le graphe sont insuffisants.

Interdit:

- décider qu’une route est trail, adjusted ou refused;
- maquiller `asphalt`, `concrete`, `paved`, `scenic_paved` en trail;
- élargir aveuglément les rayons pour compenser une stratégie d’assemblage faible;
- porter les budgets produit: dwell naturel, paved ratio, repeat, distance utile.

### 2. Edge Semantics

Responsabilité: transformer les tags OSM d’une edge en vérité de surface et signaux locaux interprétables.

Sorties attendues: `routeSurface`, `componentKind`, `surfaceEvidence`, `strictTrailWeight`, `naturalWayWeight`, `pavedEquivalentWeight`, `candidateNaturalWeight`, `trailConfidence`, drapeaux d’ambiguïté.

Autorisé:

- dire qu’une edge est explicitement paved, explicitement natural, unknown road-like, unknown path/track, scenic connector;
- marquer des candidates naturelles non vérifiées quand OSM est ambigu;
- fournir des poids observationnels pour le ranking et les diagnostics.

Interdit:

- décider du `trailRatio` final sans la géométrie assemblée;
- promouvoir une route scenic asphaltée en trail;
- mélanger vérité métrique et politique de stratégie;
- relâcher la classification pour faire passer un case.

Règle non négociable: `trailRatio`, `naturalWayRatio` et `pavedRatio` restent trois mesures distinctes. Un chemin `path/track` ambigu peut augmenter `naturalWayRatio` ou `candidateNaturalKm` selon contrat, mais ne devient pas automatiquement strict trail.

### 3. TerrainOpportunityReport

Responsabilité: dire ce que le terrain permet avant de planifier une route.

Il ne trace pas de route. Il répond à: “quelles opportunités exploitables existent autour du départ ?”.

Contenu minimal:

```ts
type TerrainOpportunityReport = {
  version: 'v3-terrain-opportunity-v1';
  graphEvidence: {
    edgeCount: number;
    totalLengthKm: number;
    confidence: 'low' | 'medium' | 'high';
  };
  components: Array<{
    id: string;
    kind: 'forest' | 'field_paths' | 'park' | 'urban_green' | 'river_corridor' | 'residential' | 'scenic_paved';
    distanceFromStartKm: number;
    reachableKm: number;
    cleanExploitableKm: number;
    strictTrailKm: number;
    naturalWayKm: number;
    pavedKm: number;
    pavedRatio: number;
    confidence: 'low' | 'medium' | 'high';
    entryNodeIds: string[];
    exitNodeIds: string[];
    blockers: string[];
  }>;
  opportunityClass:
    | 'strong_forest_loop'
    | 'transition_to_woods_possible'
    | 'park_constrained'
    | 'urban_nature_possible'
    | 'poor_osm_or_low_trail_potential';
  warnings: string[];
};
```

Autorisé:

- quantifier capacité naturelle/non-paved reachable;
- exposer les composants et leur coût d’accès;
- signaler “forte capacité visible mais handoff assembleur échoue”;
- produire des diagnostics même quand aucune route n’est retenue.

Interdit:

- choisir une stratégie finale;
- fabriquer une route ou une closure;
- appliquer des gates produit finaux;
- masquer les composants paved/scenic dans une capacité trail.

### 4. Intent

Responsabilité: transformer requête utilisateur + opportunité terrain en stratégie produit.

Exemples de stratégies:

- `forest_loop`: départ déjà dans ou très proche d’un massif forestier/naturel exploitable;
- `transition_to_woods`: accès routier/pavé nécessaire, puis dwell naturel obligatoire;
- `park_loop`: petit parc ou espace vert contraint, compromis paved assumé;
- `urban_nature`: ville dense avec canal/parc/corridor, promesse running nature plutôt que trail pur;
- `poor_osm_rural`: graphe faible ou surface data pauvre, génération prudente ou refus typé.

Autorisé:

- fixer la promesse produit réaliste;
- sélectionner les target component kinds;
- définir budgets globaux: max paved, min natural dwell, distance envelope, repeat policy;
- prévoir relaxations ordonnées et user-facing.

Interdit:

- manipuler les edges directement;
- choisir un candidat route;
- compenser un mauvais assembler par une stratégie plus permissive;
- transformer un refus légitime en adjusted si la promesse trail n’est pas soutenable.

### 5. Mission contract

Responsabilité: figer le contrat opérationnel donné à l’assembleur.

Le contrat Mission est la frontière clé. Une fois construit, l’assembleur ne doit plus inférer la promesse produit à partir de ratios dispersés.

Type minimal proposé:

```ts
type MissionType =
  | 'forest_loop'
  | 'transition_to_woods'
  | 'park_loop'
  | 'urban_nature'
  | 'poor_osm_rural';

type MissionContractV3 = {
  id: string;
  version: 'v3-mission-v1';
  type: MissionType;
  request: {
    start: { lat: number; lng: number };
    targetDistanceKm: number;
    minDistanceKm: number;
    maxDistanceKm: number;
    mode: 'trail' | 'nature_urbaine' | 'boucle_simple';
  };
  target: {
    componentIds: string[];
    componentKinds: string[];
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
};
```

Autorisé:

- encoder la mission testable et stable;
- rendre explicite ce qui est obligatoire versus préférable;
- séparer repeat target et repeat connector;
- rendre les relaxations auditables.

Interdit:

- contenir du code de traversal;
- contenir des seuils cachés non exposés aux tests;
- être modifié par l’assembleur pendant la recherche;
- contenir des diagnostics rétroactifs qui changent la promesse initiale.

### 6. StrategyAssembler

Responsabilité: convertir une mission en portefeuille de candidats de route, pas décider seul du produit final.

Un assembleur est spécifique à une stratégie. Le dispatcher choisit le bon assembleur, puis celui-ci utilise un noyau partagé pour les opérations mécaniques.

Assembleurs attendus:

- `ForestLoopAssembler`;
- `TransitionToWoodsAssembler`;
- `ParkLoopAssembler`;
- `UrbanNatureAssembler`;
- `PoorOsmRuralAssembler`.

Autorisé:

- chercher accès, dwell, expansion, recovery, closure;
- générer plusieurs candidats;
- conserver les meilleurs rejetés avec raisons;
- appeler `SharedTraversalCore` pour shortest path, expansion, closure, cycles;
- produire un `CandidatePortfolio` même si aucun candidat n’est sélectionnable.

Interdit:

- décider `generated/adjusted/refused`;
- changer les métriques de surface;
- sélectionner une route sous-distance comme “moins mauvaise” si le contrat refuse cela;
- enterrer les candidats rejetés dans des diagnostics ad hoc;
- mélanger des politiques de forest_loop avec transition_to_woods dans un generic assembler opaque.

### 7. SharedTraversalCore

Responsabilité: primitives mécaniques réutilisables.

Exemples:

- shortest path avec exclusions;
- expansion beam bounded;
- cycle extraction;
- graph contraction;
- closure search;
- repeat accounting par undirected pair;
- conversion edge traversal -> ordered nodes -> GeoJSON.

Autorisé:

- optimiser traversal;
- retourner diagnostics mécaniques;
- fournir des raisons d’échec bas niveau: no_path, closure_unreachable, capacity_exhausted.

Interdit:

- connaître les promesses produit;
- appliquer les seuils d’acceptation finaux;
- classer un candidat comme generated/adjusted/refused;
- favoriser un terrain autre que celui demandé sans mission explicite.

### 8. CandidatePortfolio

Responsabilité: cycle de vie stable des candidats.

Type minimal proposé:

```ts
type CandidateLifecycle =
  | 'discovered'
  | 'expanded'
  | 'closed'
  | 'metricized'
  | 'gated'
  | 'selected'
  | 'rejected';

type CandidateV3 = {
  id: string;
  source: 'target_component' | 'cycle_chain' | 'trail_spine' | 'park_loop' | 'urban_corridor' | 'fallback';
  lifecycle: CandidateLifecycle;
  edgeIds: string[];
  nodeIds: string[];
  geometry: { type: 'LineString'; coordinates: number[][] };
  targetComponentIds: string[];
  returned: boolean;
  metrics: RouteMetricsV3;
  gates: Array<{
    id: string;
    status: 'pass' | 'fail' | 'warning';
    reason?: string;
  }>;
  selectionScore: number;
  selected: boolean;
  selectedReason?: string;
  rejectedReason?: string;
};

type CandidatePortfolioV3 = {
  missionId: string;
  candidates: CandidateV3[];
  selectedCandidateId: string | null;
  topRejected: CandidateV3[];
  counts: {
    discovered: number;
    closed: number;
    inEnvelope: number;
    rejected: number;
  };
  diagnostics: {
    firstDropStage: string | null;
    blocker: string | null;
  };
};
```

Règle: le portfolio garde les candidats invalides utiles. Sur Fontainebleau/Meudon, un refus avec un candidat 7–10 km rejeté est plus précieux qu’un simple `poor graph evidence`.

### 9. Metrics/Gates

Responsabilité: calculer les métriques depuis la route assemblée réelle et appliquer les gates produit bas niveau.

Autorisé:

- calculer distance, paved, non-paved, strict trail, natural way, dwell, repeat, overlap, busy road, closure;
- séparer target repeat et connector repeat;
- échouer un candidat sous-distance, dominant paved, sans géométrie, sans target entry, sans dwell;
- documenter les seuils.

Interdit:

- modifier les edges ou la géométrie;
- reclasser les surfaces pour faire passer un gate;
- utiliser des diagnostics observation-only comme conditions de réussite;
- confondre benchmark pass et product success.

### 10. OutcomeDecider

Responsabilité: transformer mission + candidat sélectionné + gates en résultat utilisateur.

Type minimal proposé:

```ts
type OutcomeEvidenceV3 = {
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
    productVerdict: 'good_route' | 'acceptable_adjusted' | 'honest_refusal' | 'fake_success' | 'engine_failure';
  };
  exportPolicy: {
    geoJsonAvailable: boolean;
    gpxAvailable: boolean;
    emptyOnRefusal: boolean;
  };
};
```

Autorisé:

- retourner `generated` si tous les gates obligatoires sont bons;
- retourner `adjusted` si le compromis est explicitement autorisé par la mission et exportable;
- retourner `refused` si aucun candidat ne respecte la promesse;
- expliquer l’écart terrain/distance/surface en français utilisateur.

Interdit:

- accepter une route sous-distance silencieuse;
- accepter une route sans GPS geometry;
- convertir un `refused` en `adjusted` pour améliorer le benchmark;
- laisser un benchmark `success: true` masquer zéro route utilisable.

### 11. Export

Responsabilité: produire GeoJSON/GPX depuis la même polyline canonique.

Autorisé:

- exporter uniquement une route générée ou ajustée avec géométrie utilisable;
- garantir cohérence GeoJSON/GPX: même départ, même arrivée, distance compatible, ordre `[lng, lat]`;
- garder exports vides sur refus.

Interdit:

- générer un GPX depuis une géométrie synthétique ou segment-level;
- exporter les meilleurs rejetés comme route utilisateur;
- avoir des sources divergentes pour carte et GPX.

## Contrat `AssemblerResult` minimal

```ts
type AssemblerResultV3 = {
  mission: MissionContractV3;
  status: 'portfolio_ready' | 'no_candidate';
  portfolio: CandidatePortfolioV3;
  selectedCandidate: CandidateV3 | null;
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
};
```

Le résultat assembleur n’a pas le droit de contenir `generated`, `adjusted` ou `refused`. Il ne retourne qu’un portfolio et, éventuellement, un candidat sélectionnable selon les gates de mission.

## Violations actuelles probables dans les diffs P5g

Ces points sont des risques d’architecture observés dans le dirty state, pas un jugement de bug ligne par ligne.

### 1. Fichier assembleur central trop massif

`lib/engine-v3/assemblers/graph-route-assembly-core.ts` concentre dispatcher interne, candidate expansion, target handoff, closure recovery, ranking, diagnostics, sélection finale et construction de route. La taille et la diversité des responsabilités rendent difficile de savoir si un refus vient de l’opportunité terrain, de la mission, du traversal, de la closure, du ranking ou du gate final.

Risque: continuer à corriger Fontainebleau en ajoutant une branche de plus au même noyau opaque.

Décision RFC: extraire les politiques par stratégie et réduire `SharedTraversalCore` à des primitives mécaniques.

### 2. `multi-cycle-dwell-planner.ts` porte trop de politique produit

Le fichier contient des phases, raisons de rejet, alternatives, score, paved estimates, spine coverage, rotation, closure, pareto, dominated candidates. Ce sont des notions utiles, mais elles mélangent politique de mission, portfolio, diagnostics, et sélection.

Risque: le moteur devient un système de réparation de cas particuliers. Chaque nouveau terrain ajoute une raison de rejet ou une alternative au lieu de clarifier le contrat.

Décision RFC: `multi-cycle` peut devenir une primitive ou un assembler spécialisé, mais son output doit être un `CandidatePortfolio`, pas une décision produit implicite.

### 3. `TrailSpine` ressemble à une heuristique d’ancrage non contractualisée

`trail-spine-selector.ts` introduit un concept potentiellement utile: sélectionner une colonne vertébrale de sentier. Mais il possède ses propres scores, seuils implicites, fallback d’adjacence, risques de connecteur, repeat risk, min distance et explications.

Risque: sélectionner une spine pour forcer la continuité apparente, puis traiter l’échec de couverture comme un cas spécial plutôt que comme une violation de mission.

Décision RFC: si `TrailSpine` survit, il devient un signal de `TerrainOpportunityReport` ou une source de candidat dans le portfolio, jamais un contournement direct des gates.

### 4. Diagnostics et acceptance semblent encore couplés

Les diagnostics P5g sont riches: top candidates, rejected reasons, paved comparison, final paved equivalent, best rejected. C’est sain tant qu’ils restent observation-only. Mais leur proximité avec sélection/ranking dans les mêmes fichiers rend probable une dérive où un diagnostic devient une condition de passage ou un substitut à une route exploitable.

Risque: appeler “amélioration” une meilleure explication du refus sans amélioration distance/dwell/closure.

Décision RFC: diagnostics observation-only; les gates produit restent dans `Metrics/Gates` + `OutcomeDecider`.

### 5. `poor graph evidence` est trop générique pour des cas avec capacité visible

Le résumé benchmark montre des refus `poor graph evidence` alors que certains meilleurs rejetés atteignent 5–10 km, et les runs précédents indiquaient une capacité non-paved très élevée près du départ sur Fontainebleau. Cette raison peut être correcte pour un vrai graphe pauvre, mais elle est trompeuse quand la cause est un handoff assembleur.

Risque: confondre “pas de route sélectionnée” avec “pas de graphe exploitable”.

Décision RFC: séparer `poor_osm_or_low_trail_potential` et `assembler_handoff_failure`. Un refus honnête doit nommer le bon étage.

### 6. Generic fallback encore trop présent

`graph-route-assembler.ts` dispatch déjà `forest_loop`, `transition_to_woods`, `park_loop`, mais tombe encore sur `assembleGraphRouteWithStrategyV3(..., { mode: 'generic' })` pour d’autres stratégies. Pour `urban_nature`, `simple_quiet_loop`, `low_trail_potential` et `poor_osm_rural`, un generic opaque peut cacher des compromis produit distincts.

Risque: un même mode générique tente de résoudre des promesses incompatibles.

Décision RFC: chaque stratégie beta doit avoir un assembler explicite ou refuser avec raison `strategy_not_supported_yet`.

### 7. Benchmark summary utile mais encore trop près du moteur

`benchmark-summary.ts` améliore le verdict CTO, notamment `fake_success`. C’est sain. Mais le benchmark ne doit jamais devenir une couche métier appelée par l’engine pour décider une route.

Risque: optimiser les labels benchmark au lieu de la route.

Décision RFC: benchmark = consommateur externe d’artifacts, jamais product logic.

## ADR proposés

### ADR-001 — Honest metrics non-negotiable

Décision: les métriques de surface sont des vérités produit, pas des leviers d’optimisation.

Conséquences:

- `asphalt`, `concrete`, `paved`, `scenic_paved` restent paved;
- `trailRatio`, `naturalWayRatio`, `pavedRatio` restent séparés dans route, diagnostics, artifacts, API;
- les unknown path/track peuvent être candidats naturels avec confiance faible/moyenne, mais pas strict trail sans preuve;
- aucun benchmark ne justifie de baisser un seuil ou maquiller une surface.

### ADR-002 — Diagnostics observation-only

Décision: diagnostics, summaries, best rejected candidates, opportunity reports et benchmark artifacts expliquent; ils ne font pas passer un candidat.

Conséquences:

- un diagnostic plus riche sans meilleure route reste observability progress, pas product progress;
- `success: true` d’un script signifie commande réussie, pas route réussie;
- les gates produit lisent les métriques et le contrat Mission, pas des labels narratifs.

### ADR-003 — Candidate lifecycle first-class

Décision: chaque route potentielle doit exister comme candidat traçable avec état de cycle de vie.

Conséquences:

- aucun candidat ne disparaît sans `rejectedReason`;
- `topRejected` est obligatoire sur refus quand des candidats existaient;
- la sélection doit expliquer pourquoi le candidat choisi bat les autres;
- les meilleurs rejetés doivent exposer distance, dwell, paved, repeat, closure, target entry.

### ADR-004 — Benchmark success != product success

Décision: les rapports séparent toujours quatre niveaux.

Niveaux:

1. commande exécutée;
2. benchmark case pass/fail;
3. outcome moteur: generated/adjusted/refused/errored;
4. verdict produit après lecture métriques/artifacts: good_route/acceptable_adjusted/honest_refusal/fake_success/engine_failure.

Conséquences:

- 8 refus honnêtes prouvent l’absence de fake success, pas la beta readiness;
- zéro route exploitable sur huit impose un rework assembleur;
- une route générée sans distance, sans géométrie ou majoritairement paved devient fake_success/engine_failure.

### ADR-005 — Strategy assemblers over generic assembler

Décision: les promesses produit divergentes nécessitent des assembleurs séparés.

Conséquences:

- `forest_loop`, `transition_to_woods`, `park_loop`, `urban_nature`, `poor_osm_rural` ont chacun un contrat et des tests;
- le core partagé ne contient que traversal mécanique;
- un strategy non implémenté refuse explicitement au lieu de passer par generic;
- les tests synthétiques doivent prouver que deux stratégies sur le même graphe peuvent choisir des routes différentes.

### ADR-006 — Refusal reason must identify the failing layer

Décision: un refus doit dire quel étage a échoué.

Raisons types:

- `terrain_opportunity_insufficient`;
- `strategy_not_supported_yet`;
- `mission_impossible_under_constraints`;
- `assembler_target_entry_failed`;
- `assembler_dwell_failed`;
- `assembler_closure_failed`;
- `candidate_gates_failed`;
- `export_geometry_missing`;
- `poor_osm_or_low_confidence`.

Conséquence: `poor graph evidence` ne doit pas être utilisé quand le graphe contient une capacité cible reachable mais que l’assembleur ne sait pas l’exploiter.

## Plan de rework recommandé

### P0 — Stabiliser les contrats sans changer l’algorithme

Livrables:

- documenter `MissionContractV3`, `AssemblerResultV3`, `CandidatePortfolioV3`, `OutcomeEvidenceV3`;
- ajouter ou adapter les types sans brancher toute la logique;
- faire émettre les raisons d’échec par couche dans les artifacts;
- garder les exports vides sur refus.

Succès: le prochain refus Fontainebleau/Meudon dit précisément s’il échoue à target entry, dwell, closure ou gates, pas seulement `poor graph evidence`.

### P1 — Extraire les assembleurs par stratégie

Livrables:

- `forest_loop` pour massif naturel proche;
- `transition_to_woods` pour accès + dwell obligatoire;
- `park_loop` pour parc contraint;
- `urban_nature` pour corridor urbain;
- `poor_osm_rural` pour graphes faibles.

Succès: tests synthétiques prouvent des comportements distincts, sans changement de seuil produit.

### P2 — CandidatePortfolio comme vérité d’assemblage

Livrables:

- portfolio stable dans les artifacts;
- selected/topRejected obligatoires;
- gates explicites par candidat;
- aucun candidat sous-distance/paved-dominant ne peut devenir generated.

Succès: sur le panel beta-multiterrain, chaque refus a un meilleur rejeté compréhensible ou une preuve d’absence réelle de candidat.

### P3 — Reprendre les cas réels un par un

Ordre proposé:

1. Fontainebleau: forte capacité naturelle, boucle forestière;
2. Meudon: candidat 10.117 km rejeté, vérifier pourquoi il est invalide;
3. Tourville 8k: transition_to_woods avec accès pavé assumé puis dwell réel;
4. Caen Colline: park_loop / soft urban park;
5. un négatif honnête: poor_osm_rural ou petit parc trop long.

Succès beta minimal: quelques routes exploitables + refus négatif honnête, pas 8/8 verts forcés.

## Critères de succès architecture

Le rework est sain si:

- une route générée/ajustée a géométrie GPS et exports cohérents;
- un refus conserve portfolio/topRejected quand des candidats existaient;
- les raisons d’échec nomment la couche exacte;
- `pavedRatio`, `naturalWayRatio`, `trailRatio` restent honnêtes;
- un benchmark vert ne peut pas masquer une route produit faible;
- aucun fichier assembleur unique ne redevient le lieu où tout se décide.

Le rework échoue si:

- un nouveau heuristic layer est ajouté pour verdir Fontainebleau;
- `TrailSpine` ou `multi-cycle` deviennent des raccourcis d’acceptation;
- un refus massif continue à dire `poor graph evidence` malgré capacité reachable;
- une route adjusted cache un trail promise non tenu;
- les diagnostics progressent mais 0 route exploitable reste l’état produit.

## Décision finale RFC

V3 doit rester hors beta tant que l’assembleur n’a pas une architecture contractuelle claire. L’état actuel est préférable à un fake success, mais insuffisant: 8 refus honnêtes prouvent l’intégrité, pas la valeur utilisateur.

La prochaine étape ne doit pas être un patch Fontainebleau supplémentaire. Elle doit être un rework limité mais structurel: Mission contract stable, assembleurs par stratégie, portfolio de candidats first-class, et OutcomeDecider indépendant. Ensuite seulement, reprendre Fontainebleau/Meudon/Tourville/Caen comme preuves produit.
