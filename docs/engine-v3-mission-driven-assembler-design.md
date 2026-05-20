# Engine V3 — RCA assembleur et design mission-driven

Date: 2026-05-19
Branche inspectée: `wip/v3-fontainebleau-loop-quality`
Scope: design architecture uniquement. Aucun patch moteur, aucun push, aucun merge.

## Résumé exécutif

Le panel V3 beta-multiterrain ne montre pas un problème Fontainebleau isolé. Il montre un assembleur qui sait refuser honnêtement, mais qui ne sait pas transformer une opportunité terrain en mission routable. Le signal produit est clair: 8/8 refus, 0 generated, 0 adjusted, 0 fake_success, 0 engine_failure. C’est sain côté garde-fous, mais non beta-ready.

La dette principale est structurelle: les stratégies `forest_loop`, `transition_to_woods`, `park_loop` et `urban_nature_loop` sont dispatchées nominalement, mais elles retombent toutes dans un coeur générique (`assembleGraphRouteWithStrategyV3`) avec quelques options. Les fichiers `forest-loop-assembler.ts`, `transition-to-woods-assembler.ts` et `park-loop-assembler.ts` sont actuellement des wrappers. La vraie logique est concentrée dans `graph-route-assembly-core.ts`, puis dans une chaîne de primitives ajoutées au fil des RCA: frontier beam, target component traversal, component loop solver, natural graph contraction, ordered cycle expansion, multi-cycle dwell, trail spine selector, clean closure recovery.

Cette forme explique l’impasse: on a beaucoup de primitives intéressantes, mais pas de contrat de mission qui impose un ordre de phases différent selon le terrain. Le système choisit, score et rejette des candidats plutôt que d’exécuter explicitement: accéder au bon terrain, y rester assez longtemps, récupérer la distance, fermer proprement, puis décider.

Architecture cible recommandée:

`TerrainOpportunityReport -> Intent -> Mission contract -> StrategyAssembler -> SharedTraversalCore -> CandidatePortfolio -> Metrics/Gates -> OutcomeDecider`

Le but n’est pas de viser 8/8 verts. Le premier seuil sérieux est: Fontainebleau, Meudon, Tourville 8k et Caen doivent produire soit une route exploitable honnête, soit un refus dont la phase bloquante est précise et crédible. Un cas négatif pauvre doit rester refusé sans inventer de trail.

## Sources lues

Artifacts:

- `artifacts/engine-v3-benchmarks/latest-summary.md`
- `artifacts/engine-v3-benchmarks/latest-summary.json`
- `artifacts/engine-v3-benchmarks/beta-multiterrain-summary.md`
- `artifacts/engine-v3-benchmarks/beta-multiterrain-latest.json`
- per-case JSON sous `artifacts/engine-v3-benchmarks/beta-multiterrain-routes/`

Code assembleur inspecté:

- `lib/engine-v3/graph-route-assembler.ts`
- `lib/engine-v3/assemblers/graph-route-assembly-core.ts`
- `lib/engine-v3/assemblers/forest-loop-assembler.ts`
- `lib/engine-v3/assemblers/transition-to-woods-assembler.ts`
- `lib/engine-v3/assemblers/park-loop-assembler.ts`
- `lib/engine-v3/assemblers/component-loop-solver.ts`
- `lib/engine-v3/outcome-decider.ts`
- `lib/engine-v3/types.ts`

## État factuel du panel

| Cas | Strategy actuelle | Opportunité terrain | Meilleur candidat rejeté | Blocage dominant |
| --- | --- | --- | --- | --- |
| Tourville 8k | low_trail_potential | 49.025 km graphe, non-paved 0.191, reachableNP 0 km | 5.261 km, dwell 0, paved 0.881, non retourné | loop closure + mauvais ancrage résidentiel |
| Tourville 12k | low_trail_potential | 97.812 km graphe, non-paved 0.210, reachableNP 0 km | aucun candidat final | pas de mission exploitable |
| Caen Colline 6k | low_trail_potential | 148.624 km graphe, non-paved 0.136, reachableNP 0 km | 3.329 km, dwell 0, paved 0.868, non retourné | park/urban nature traité comme low-trail résidentiel |
| Caen Prairie 8k | low_trail_potential | 256.149 km graphe, non-paved 0.063, reachableNP 0 km | aucun candidat final | pas de stratégie urban_nature dédiée |
| Fontainebleau 15k | transition_to_woods | 260.497 km graphe, reachableNP 306.26 km, anchor field_paths 96.135 km | 7.914 km, dwell 4.504, paved 0.382, non retourné | closure et handoff capacité -> dwell -> boucle |
| Meudon 10k | transition_to_woods | 191.973 km graphe, reachableNP 174.126 km, anchor field_paths 73.719 km | 10.117 km, dwell 7.361, paved 0.259, retourné | `pavedCore`: candidat proche d’acceptable mais noyau cible pavé/scenic mal séparé |
| Paris 19 | low_trail_potential | 607.917 km graphe, non-paved 0.074 | 5.161 km, dwell 0, paved 0.986, non retourné | besoin d’urban_nature/quiet loop, pas trail |
| OSM-poor rural 8k | transition_to_woods | 23.651 km graphe, reachableNP 16.224 km, anchor 4.816 km | 5.928 km, dwell 0.23, paved 0.944, retourné | dwell réel insuffisant + connecteurs pavés dominants |

Lecture: le refus est honnête, mais la raison de haut niveau “poor graph evidence” est trop générique pour les cas à forte capacité. Fontainebleau et Meudon prouvent qu’il y a de la capacité mais que la mission n’est pas correctement exécutée. Tourville/Caen/Paris prouvent un autre problème: la stratégie `low_trail_potential` devient un fourre-tout résidentiel au lieu de produire une alternative produit bornée ou un refus explicable par opportunité.

## Critique de l’assembleur actuel

### 1. Les assembleurs de stratégie ne sont pas de vrais assembleurs

`forest-loop-assembler.ts`, `transition-to-woods-assembler.ts` et `park-loop-assembler.ts` ne font que passer un `mode` et un warning au coeur générique. Cela crée l’illusion d’une séparation stratégique, mais les décisions structurantes restent mutualisées: seeds, beam frontier, target component handoff, closure recovery, scoring final.

Conséquence: `forest_loop`, `transition_to_woods` et `park_loop` diffèrent trop peu dans les phases autorisées. Or une forêt massive, un village avec transition vers bois, un petit parc urbain et un canal parisien ne sont pas le même problème.

### 2. L’assembleur mélange phases, heuristiques et preuves

Dans `graph-route-assembly-core.ts`, `assembleGraphCandidates()` fait plusieurs choses à la fois:

- initialise un frontier beam;
- injecte des seeds vers non-paved target;
- collecte des candidats retournés;
- appelle `buildTargetTraversalCandidates()`;
- tente des clean closures;
- mélange candidats frontier, primitive, closure et frontier résiduelle;
- laisse `selectBestCandidate()` juger après coup.

Ce pipeline est utile pour explorer, mais mauvais comme architecture produit. Il ne dit pas explicitement: “la phase access a réussi, la phase dwell a réussi, la phase closure a échoué”. Il produit plutôt un pool où les candidats échouent sur `loopClosure`, `naturalDwell`, `pavedCore` ou distance.

### 3. Les primitives ajoutées ne sont pas orchestrées par mission

`component-loop-solver.ts` contient déjà des phases (`accessPhase`, `dwellPhase`, `recoveryPhase`, `closurePhase`, `finalGate`) et des diagnostics utiles (`accessKm`, `accessPavedKm`, `naturalDwellKm`, `closurePavedKm`, `targetRepeatKm`). Mais dans l’architecture actuelle, cette primitive est une source de candidat parmi d’autres, pas l’exécuteur d’un contrat mission.

Le résultat typique est Fontainebleau: énorme capacité reachable/clean exploitable, mais top final non retourné et sous-distance. Meudon va encore plus loin: un candidat retourné de 10.117 km avec 7.361 km de dwell est rejeté pour `pavedCore`, mais l’architecture ne sait pas dire si c’est un vrai no-go produit, un problème de séparation target/core vs connector, ou une correction de stratégie nécessaire.

### 4. `low_trail_potential` est trop pauvre pour servir Tourville/Caen/Paris

Tourville 8k, Caen Colline, Caen Prairie et Paris 19 retombent sur un ancrage résidentiel, avec `targetComponents: []`. L’assembleur générique essaie quand même de fabriquer une boucle. Cela donne des candidats pavés, courts, souvent non retournés.

Pour un produit beta honnête, `low_trail_potential` ne doit pas être un mode d’assemblage générique. Il doit être une décision produit: soit basculer vers une stratégie dédiée (`urban_nature_loop`, `park_loop`, `poor_osm_rural_best_effort`) avec un contrat de compromis explicite, soit refuser avant assemblage avec preuve d’opportunité insuffisante.

## Familles d’échec observées

### A. Accès composant

Symptôme: le système trouve un composant proche ou massif, mais l’entrée choisie n’est pas forcément la meilleure entrée pour produire une boucle.

Cas: Fontainebleau, Meudon, OSM-poor.

Diagnostic actuel utile: `entryDistanceKm`, `accessKm`, `accessPavedKm`, `selectedTargetComponentIds`, `reachableTargetKm`.

Manque: comparaison des entrées alternatives selon “capacité après entrée”, “probabilité de fermeture”, “pavé de connecteur”, pas seulement coût d’accès et capacité brute.

### B. Dwell insuffisant

Symptôme: route retournée ou partielle, mais `naturalDwellKm` ne satisfait pas `requestedNaturalDwellKm`.

Cas: OSM-poor rural: top rejected 5.928 km, `naturalDwellKm=0.23` contre 3.6 demandés.

Lecture: refus correct. Il ne faut pas chercher à verdir ce cas en maquillant du road-like unknown. Le contrat doit pouvoir dire: “capacité théorique visible, mais dwell naturel propre impossible dans l’enveloppe”.

### C. Closure

Symptôme: bon progrès terrain mais pas de boucle retournée.

Cas: Fontainebleau top rejected 7.914 km, 4.504 km dwell, `returned=false`, gate `loopClosure`. Tourville/Caen/Paris aussi, mais avec mauvais terrain et trop pavé.

Lecture: pour les cas à forte opportunité, closure doit être une phase active, pas une récupération post-hoc. Pour les cas urbains/pauvres, non-retour + pavé dominant doit produire refus ou fallback borné.

### D. Target repeat

Symptôme: le système limite la répétition dans le target, mais peut perdre distance/dwell ou tomber sur des chemins trop courts.

Cas: OSM-poor a `targetRepeatKm=0.329` et beaucoup de connector repeat. Meudon a très peu de repeat mais rejet `pavedCore`.

Lecture: préserver la règle: repeat cible dangereux, repeat connecteur parfois acceptable et doit rester explicite. Ne pas réduire le repeat en abandonnant le terrain naturel.

### E. Paved budget / paved core

Symptôme: route distance+dwell viable mais rejetée car le coeur cible contient du pavé/scenic.

Cas: Meudon: 10.117 km, 7.361 km dwell, pavedRatio 0.259, mais rejet `paved target core 0.936km / 0.111 ratio`.

Lecture: c’est le cas le plus important pour l’architecture. Il ne faut pas transformer scenic paved en trail, mais il faut distinguer clairement: pavé d’accès, pavé de fermeture, pavé dans le coeur cible, pavé urbain dangereux, scenic paved acceptable comme compromis. Un rejet `pavedCore` doit dire quelle limite est franchie et si une route `adjusted` aurait été produit-honnête.

### F. Candidate selection

Symptôme: le top final est un candidat de progrès, pas une route produit.

Cas: Fontainebleau `source=seed`, non retourné; Meudon `source=component-loop`, retourné mais rejet `pavedCore`; Tourville/Caen/Paris frontier pavé et non retourné.

Lecture: il faut un `CandidatePortfolio` avec lanes typées et gates par phase, pas un ranking final qui mélange candidats de progrès, diagnostics et routes complètes.

## Architecture cible

### 1. TerrainOpportunityReport

Créer/renforcer une couche observation-only avant l’intent. Elle doit décrire ce que le terrain rend réellement possible, sans promettre de route.

Champs recommandés:

- `totalGraphKm`
- `reachableNonPavedKm`
- `reachableStrictTrailKm`
- `reachableNaturalWayKm`
- `reachableParkKm`
- `reachableUrbanGreenKm`
- `components[]`: kind, distanceFromStartKm, totalKm, cleanExploitableKm, pavedRatio, nonPavedRatio, entryCandidates[]
- `negativeEvidence`: noTargetComponent, tooSmallPark, pavedDominant, disconnectedNatural, highBusyRoadRisk, weakOsmSurfaceConfidence
- `recommendedStrategy`: forest_loop, transition_to_woods, park_loop, urban_nature_loop, poor_osm_rural, refuse

Important: ce rapport ne doit pas changer les seuils. Il sert à choisir la bonne mission et à expliquer le refus.

### 2. Intent

L’intent ne doit pas seulement dire `strategy`. Il doit poser la promesse produit:

- `promise`: pureTrail, trailWithConnector, urbanNature, parkCompromise, quietPavedLoop, impossible
- `maxPavedRatio`
- `minNaturalDwellKm`
- `minContinuousTrailKm`
- `allowedCompromises`
- `hardNoGos`
- `fallbackPolicy`: adjustedAllowed, refusedOnly, bestEffortAllowed

Exemple: Paris 19 en `nature_urbaine` ne doit pas être jugé comme Fontainebleau trail. L’intent devrait être `urbanNature` ou `quietPavedLoop`, avec warning clair, ou refus si la promesse demandée est “trail”.

### 3. Mission contract

Le `CorridorMissionV3` actuel est trop compact. Il faut un contrat par phases.

Contrat minimal:

```ts
interface MissionContractV3 {
  strategy: RouteStrategyV3;
  targetDistanceKm: number;
  phases: MissionPhaseV3[];
  budgets: {
    totalPavedKm: number;
    accessPavedKm: number;
    closurePavedKm: number;
    targetPavedKm: number;
    targetRepeatKm: number;
    connectorRepeatKm: number;
    busyRoadKm: number;
  };
  requirements: {
    minTargetDwellKm: number;
    minContinuousTrailKm: number;
    minDistanceRatioForAdjusted: number;
    minDistanceRatioForGenerated: number;
    mustReturnToStart: boolean;
  };
  diagnosticsRequired: PhaseDiagnosticKey[];
}
```

Phases possibles:

- `access`: atteindre une entrée viable;
- `target_dwell`: marcher dans le terrain cible;
- `distance_recovery`: compléter la distance sans dégrader la promesse;
- `closure`: revenir au départ;
- `final_gate`: métriques et décision produit.

### 4. StrategyAssembler

Chaque stratégie doit avoir un fichier qui exécute son contrat, pas un wrapper.

Fichiers cibles:

- `forest-loop-assembler.ts`
- `transition-to-woods-assembler.ts`
- `park-loop-assembler.ts`
- `urban-nature-assembler.ts`
- `poor-osm-rural-assembler.ts` ou stratégie de refus/fallback dédiée

Le dispatcher (`graph-route-assembler.ts`) doit appeler ces assembleurs. Le coeur commun ne doit plus connaître `mode: forest_loop | transition_to_woods | park_loop | generic` comme pivot de politique; il doit fournir des primitives mécaniques.

### 5. SharedTraversalCore

Ce qui doit être commun:

- construction adjacency et directed traversal;
- classification de surface via `edge-semantics`, sans maquillage;
- shortest path pondéré pour accès/closure;
- extraction de composants par kind/surface;
- calcul de métriques à partir d’edgeIds ordonnés;
- détection repeat target vs connector;
- génération GeoJSON/GPX depuis une polyline canonique;
- helpers de diagnostics phase;
- portfolio/candidate normalization.

Ce qui ne doit pas être commun:

- ordre des phases;
- choix de l’anchor;
- acceptabilité d’un connecteur pavé;
- moment où la closure est autorisée;
- budgets paved/dwell/repeat;
- statut generated vs adjusted vs refused;
- fallback urbain ou rural pauvre;
- scoring final par stratégie.

## Design par stratégie

### forest_loop

Promesse: boucle majoritairement dans un composant forest/natural prouvé, avec connecteur minimal si départ en bordure.

Phases:

1. Sélectionner un composant `forest` prioritaire, sinon `field_paths` seulement si l’opportunité forest est absente mais naturalWay solide.
2. Choisir une entrée qui maximise boucle interne + fermeture, pas seulement capacité brute.
3. Accumuler dwell naturel/strict trail dans le composant cible avant toute sortie.
4. Chercher une boucle interne ou semi-interne. Closure par connecteur pavé autorisée seulement si courte et métrée.
5. Refuser si la seule route exploitable dépend d’un coeur paved/scenic au-delà du budget.

Diagnostics obligatoires:

- `accessKm`
- `accessPavedKm`
- `selectedComponentKind`
- `selectedComponentCleanKm`
- `targetDwellKm`
- `longestTrailSegmentKm`
- `targetRepeatKm`
- `closureKm`
- `closurePavedKm`
- `finalPavedRatioEstimate`
- `pavedCoreKm`

Meudon doit être traité ici ou comme `transition_to_woods` selon distance au composant, mais le cas montre une question produit: si 10.117 km / 7.361 dwell / paved 0.259 est rejeté, le diagnostic doit prouver pourquoi `pavedCore` rend la route inacceptable plutôt que simplement refuser.

### transition_to_woods

Promesse: accepter une transition routière honnête pour rejoindre du vrai terrain naturel, puis y rester.

Phases:

1. Access: trouver plusieurs entrées vers composants non-paved viables; autoriser paved/residential/service mais le compter comme `accessPavedKm`.
2. Target dwell: interdire retour/closure tant que `targetDwellKm < requestedNaturalDwellKm`.
3. Distance recovery: compléter dans ou autour du composant cible; préserver dwell et éviter repeat cible.
4. Closure: retour au départ; autoriser repeat connecteur si nécessaire, mais le séparer de `targetRepeatKm`.
5. Final gate: generated si distance/dwell/paved/repeat respectés, adjusted si compromis explicite acceptable, refused sinon.

Spécifique Fontainebleau:

- Ne pas prendre la capacité brute `reachableTargetKm=110km+` comme preuve de route; exiger preuve d’une séquence ordonnée edgeIds qui atteint dwell puis fermeture.
- Le top rejected 7.914 km / 4.504 dwell / returned=false doit devenir un diagnostic de phase: `target_dwell_partial_success`, `closure_failed`, `distance_recovery_failed`, ou `entry_selection_failed`.

Spécifique Tourville:

- Si le mode reste `low_trail_potential`, ne pas essayer de fabriquer une boucle résidentielle. S’il existe une vraie transition vers bois avec faible capacité, la mission doit dire: access OK, dwell insuffisant, adjusted impossible ou refus.

### park_loop

Promesse: boucle parc/nature urbaine honnête, souvent plus courte ou plus pavée, jamais vendue comme pur trail.

Phases:

1. Détecter capacité parc réelle: `parkKm`, `urbanGreenKm`, boucle possible, nombre de tours raisonnable.
2. Si la distance cible dépasse la capacité parc, autoriser un adjusted plus court ou refuser; ne pas étirer par résidentiel pavé.
3. Paved park paths autorisés comme `paved`, pas `trail`.
4. Closure doit être simple, sûre, sans busy road dominant.

Diagnostics obligatoires:

- `parkCapacityKm`
- `usableParkLoopKm`
- `lapsOrReusedSegments`
- `pavedParkKm`
- `busyRoadKm`
- `adjustedDistanceReason`

Caen Colline 6k ne devrait pas sortir en `low_trail_potential` résidentiel si la demande est `nature_urbaine`. Il faut soit `park_loop` ajusté, soit refus “parc trop petit / boucle honnête trop courte”.

### urban_nature_loop

Promesse: running urbain agréable, canal/parc/river corridor/quiet streets, pas trail.

Phases:

1. Identifier corridors urbains: river_corridor, urban_green, scenic_paved, quiet residential.
2. Générer une boucle propre avec priorité sécurité/continuité/distance.
3. Accepter pavedRatio élevé si la promesse est `nature_urbaine`, mais l’expliquer: route urbaine, pas trail.
4. Refuser seulement si busy road, absence de closure, ou distance trop courte.

Diagnostics obligatoires:

- `urbanGreenKm`
- `riverCorridorKm`
- `quietPavedKm`
- `busyRoadKm`
- `crossingRiskEstimate`
- `loopClosureKm`
- `finalPavedRatioEstimate`

Paris 19 ne doit pas échouer avec “low trail potential” s’il est demandé en nature urbaine. Il doit soit produire une boucle running urbaine ajustée, soit refuser pour sécurité/closure, pas pour manque de trail.

### poor_osm_rural

Promesse: terrain rural avec données faibles. Ne pas inventer. Offrir best-effort seulement si route sûre et métriques honnêtes.

Phases:

1. Évaluer surface confidence et natural evidence.
2. Si dwell strict impossible, produire refus typé ou adjusted best-effort non-trail selon politique beta.
3. Ne pas compter road-like unknown comme trail.
4. Connector repeat acceptable uniquement comme compromis explicite.

OSM-poor rural actuel est un refus correct: 5.928 km retournés mais 0.23 km dwell et paved 0.944. Ce cas doit rester un garde-fou anti-fake-success.

## CandidatePortfolio

Remplacer le ranking final unique par un portfolio typé.

Lanes proposées:

- `complete_valid`: candidat retourné, distance dans enveloppe, exigences dures OK;
- `complete_adjustable`: retourné, compromis explicite possible;
- `progress_no_closure`: bon dwell/distance mais pas retourné;
- `dwell_only`: bon dwell mais distance/closure insuffisantes;
- `connector_heavy`: route potentielle mais connecteur/pavé dominant;
- `diagnostic_only`: preuve utile, jamais sélectionnable;
- `negative_evidence`: impossibilité produit.

Règle clé: un candidat `diagnostic_only` ne doit jamais être sélectionné comme route. Un candidat `progress_no_closure` peut guider la prochaine phase, mais pas passer au `OutcomeDecider` comme route.

## Diagnostics de phase obligatoires

Chaque artifact V3 doit inclure un bloc stable, même en refus:

```ts
interface AssemblyPhaseDiagnosticsV3 {
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
    status: 'generated' | 'adjusted' | 'refused';
    distanceKm: number;
    finalPavedRatioEstimate: number;
    trailRatio: number;
    naturalWayRatio: number;
    pavedRatio: number;
    gateFailures: string[];
  };
}
```

Les champs minimaux demandés par la mission doivent être toujours présents: `accessKm`, `accessPavedKm`, `targetDwellKm`, `targetRepeatKm`, `closurePavedKm`, `finalPavedRatioEstimate`.

## Anti-patterns à interdire

1. Verdir Fontainebleau en ajoutant une heuristique de plus dans `multi-cycle` ou `TrailSpine` sans contrat de mission.
2. Utiliser `low_trail_potential` comme assembleur générique résidentiel.
3. Mélanger candidats de diagnostic et candidats sélectionnables.
4. Laisser un candidat non retourné entrer dans la sélection finale autrement que comme preuve de progression.
5. Compter asphalt/concrete/scenic paved comme trail ou strict natural.
6. Masquer `pavedCore` dans `pavedRatio` global sans phase `targetPavedKm` / `closurePavedKm` / `accessPavedKm`.
7. Réduire le repeat en abandonnant le terrain naturel ou en sélectionnant une route plus pavée.
8. Faire de `SharedTraversalCore` une nouvelle boîte noire avec des options `mode` qui pilotent la politique.
9. Chercher 8/8 verts avant d’avoir 4 cas représentatifs correctement diagnostiqués et au moins 2 routes exploitables.
10. Baisser les seuils produit ou élargir les budgets paved pour transformer des refus honnêtes en succès.
11. Utiliser `success: true` du benchmark comme preuve produit.
12. Produire GPX/GeoJSON sur refus autrement que vides/diagnostic-safe.

## Plan d’exécution recommandé

### P0 — Architecture contractuelle et diagnostics

Créer les types `TerrainOpportunityReport`, `MissionContract`, `AssemblyPhaseDiagnostics` et `CandidatePortfolio`. D’abord observation-only. Aucun changement de résultat attendu.

Critère: les 8 artifacts du panel indiquent la phase bloquante exacte au lieu d’un refus générique.

### P1 — Extraire SharedTraversalCore mécanique

Isoler les fonctions communes: adjacency, shortest path, component extraction, edge semantics, metrics, repeat split, closure helper. Aucune stratégie produit dans ce core.

Critère: tests synthétiques prouvent que le core ne décide pas generated/adjusted/refused.

### P2 — Implémenter vrais assembleurs stratégie par stratégie

Ordre conseillé:

1. `transition_to_woods` sur Fontainebleau + Tourville 8k;
2. `forest_loop` sur Meudon;
3. `park_loop` sur Caen Colline;
4. `urban_nature_loop` sur Paris 19/Caen Prairie;
5. `poor_osm_rural` comme garde-fou négatif.

Critère: ne pas chercher 8/8. Chercher progression mesurable: route complète ou phase blocker crédible.

### P3 — OutcomeDecider mission-aware

Le decider doit lire les phase diagnostics et le portfolio. Il ne doit pas seulement inspecter les métriques finales. Un adjusted doit être possible uniquement quand le contrat l’autorise.

Critère: Meudon peut être tranché proprement: generated/adjusted/refused avec raison vérifiable sur `pavedCore`, pas verdict implicite.

## Décisions proposées

À garder:

- refus honnêtes;
- séparation `trailRatio`, `naturalWayRatio`, `pavedRatio`;
- GPX/GeoJSON vides sur refus;
- edge semantics strictes;
- diagnostics `topFinalCandidates` et target/connector repeat split.

À changer:

- remplacer les wrappers de stratégie par de vrais assembleurs;
- déplacer la politique hors du coeur générique;
- rendre les phases explicites;
- classer les candidats par lane;
- différencier pavé access/closure/core.

À refuser:

- threshold lowering;
- maquillage paved/scenic paved;
- heuristique Fontainebleau-only;
- sélection d’un candidat non retourné;
- “low trail potential” comme fallback universel.

## Conclusion

Le prochain travail moteur ne doit pas être “corriger Fontainebleau”. Il doit être “rendre l’assembleur mission-driven”. Les artifacts actuels prouvent que les briques existent partiellement, mais l’orchestration est mauvaise: trop de primitives concurrentes, pas assez de contrat de phase. Tant que cette séparation n’est pas faite, chaque amélioration locale risque d’être une dette de plus pour verdir un cas au détriment des autres terrains.
