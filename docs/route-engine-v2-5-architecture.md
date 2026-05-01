# TrailForge — Route Engine V2.5 Architecture

Date : 2026-05-01  
Statut : direction architecture, pas une implémentation  
Portée : Phase 1 trail/running, boucles 5–15 km, export GPX fiable

## Résumé exécutif

La recommandation est de garder V2 comme socle, mais d’arrêter de faire porter l’intelligence route par une accumulation d’heuristiques locales dans `edge-scorer.ts`, `orienteering-solver.ts` et le post-processing. V2.5 doit introduire une couche explicite `Terrain / Route Intent Planner` entre l’audit terrain et le solver. Son rôle n’est pas de tracer la route : il lit le graphe, qualifie le terrain, choisit une stratégie de boucle, fixe des objectifs mesurables et donne au solver une intention claire.

Le moteur doit évoluer vers une architecture en objectifs séparés : score edge-level, contraintes route-level, contraintes terrain, anti-overlap/clean return et ranking final. Les métriques qui décident de la release deviennent first-class : `pavedRatio`, continuité non revêtue, dwell time en zone naturelle, aire de boucle, overlap géométrique, match avec l’intention, timings par stage. V2.5 n’est pas un projet de recherche : c’est une architecture pour produire plus vite des boucles courables, mesurables, refusables proprement et validables par testeurs.

Décision principale : le problème dominant Tourville n’est plus seulement la fermeture de boucle. Le clean return a réduit le backtracking, mais `pavedRatio` reste rouge parce que le solver accepte des corridors boisés goudronnés et ne reste pas assez longtemps sur les vrais chemins non revêtus. V2.5 doit donc planifier l’intention terrain avant d’optimiser localement les edges.

## Diagnostic V2 actuel

### Forces

V2 a une bonne base modulaire : `graph-builder.ts` construit un graphe OSM routable, `edge-scorer.ts` enrichit les edges avec surface, nature, quietness, sécurité et élévation, `orienteering-solver.ts` génère plusieurs chemins par beam search, et `route-post-processor.ts` ranke les candidats avec des métriques produit. Cette séparation est saine et doit rester.

La boucle de validation a aussi fortement progressé. `lib/route-benchmarks-data.json` centralise 12 cas Phase 1, `scripts/run-route-benchmarks.mjs` échoue sur les seuils qualité, et les tests couvrent les cas structurels : Tourville, Caen, Clécy, Fontainebleau, Meudon, Lille, Paris 19 et Nanterre. Les métriques actuelles ne se limitent plus à un HTTP 200 : distance, D+, score production, fermeture, grands axes, nature, bitume, longest trail segment, corridor naturel, repeat edges, U-turn, confiance OSM et durée sont déjà présents.

Les correctifs récents vont dans le bon sens. Le solver tente maintenant une fermeture propre qui évite les edges déjà utilisées avant de retomber sur A*. Le post-processing pénalise mieux les repeat edges, U-turns et le pavement élevé. Les tests `orienteering-solver.test.ts` capturent déjà des intentions importantes : viser un massif naturel, préférer un corridor continu, entrer dans le bois plutôt que tourner autour, garder les scenic corridors sans surface, traiter certaines routes en bois comme corridors naturels quand OSM est incomplet.

### Faiblesses

Le moteur reste trop implicite. Aujourd’hui, l’intention trail est dispersée dans des coefficients, des bonus et des pénalités : score de surface, scenic/nature, anchor pull, corridor streak, forced closure, shortlist post-process, pavement penalty. Chaque patch corrige un symptôme, mais augmente le risque d’un moteur illisible où personne ne sait si une route a échoué à cause du scoring, du solver, de la fermeture, du ranking ou d’OSM.

Le solver est encore opportuniste. Il choisit des edges prometteuses localement, puis force une fermeture à partir de 65–85 % de progression. Cela peut générer une boucle valide mathématiquement mais faible produit : elle touche un bois sans y rester, longe des corridors goudronnés, ferme proprement mais avec une forme médiocre, ou respecte la distance au prix d’un `pavedRatio` trop élevé.

La classification terrain manque de nuance exploitable par stratégie. `terrain-audit.ts` sait produire `confidence`, `trailPotential`, `unknownSurfaceRatio`, `asphaltRatio`, `fragmentationScore`, etc. Mais ces résultats restent surtout diagnostiques. Ils ne pilotent pas encore explicitement une stratégie : rejoindre un massif, rester dans un corridor, accepter une boucle périurbaine mixte, refuser le trail et proposer running nature, réduire la shortlist, durcir le clean return, ou baisser l’ambition surface en cas d’OSM pauvre.

Le cas Tourville résume la limite actuelle. L’audit `docs/tourville-paved-ratio-audit.md` montre que le `pavedRatio` est majoritairement réel : beaucoup de voies sont `surface=asphalt` ou `surface=concrete`, parfois scenic. Ce n’est pas un bug de formule. Le problème produit est que le solver accepte des routes boisées goudronnées alors qu’un profil trail doit favoriser la continuité non revêtue quand elle existe. Il faut ajuster le comportement, pas maquiller la classification.

## Architecture cible V2.5

V2.5 garde l’architecture actuelle comme base, mais clarifie les responsabilités en six couches.

```text
Request + Profile
  -> Graph Builder
  -> Terrain Audit
  -> Terrain / Route Intent Planner
  -> Edge Scorer
  -> Intentional Solver
  -> Post-processor + Quality Gates
  -> GPX / User Feedback / Benchmarks
```

### 1. Graph Builder

Responsabilité : récupérer et construire un graphe routable borné, sans logique produit lourde.

À garder : filtrage OSM, routabilité, sécurité basique, sens interdits, access restrictions, tags OSM, scenic/natural context, limites Overpass.

À faire évoluer : exposer davantage de métadonnées au planner, notamment densité du graphe, composants naturels, distribution surfaces/highways, nombre de nodes/edges, connectivité autour du départ, zones naturelles traversables et coût estimé des requêtes. Le Graph Builder ne doit pas décider seul d’élargir brutalement un rayon en ville dense.

### 2. Terrain Audit

Responsabilité : décrire la qualité et la fiabilité du terrain disponible.

À garder : `confidence`, `trailPotential`, `pathLikeEdgeRatio`, `naturalSurfaceRatio`, `unknownSurfaceRatio`, `scenicEdgeRatio`, `asphaltRatio`, `naturalAreaSignal`, `fragmentationScore`.

À faire évoluer : passer d’un audit global edge-count à un audit spatial : composants naturels connectés, longueur utile par composant, distance depuis le départ, portes d’entrée/sortie, corridors non revêtus continus, corridors scenic mais paved, zones ambiguës OSM. L’audit doit permettre de dire : “il y a un massif exploitable à 1,8 km”, “il y a seulement des fragments”, “il y a beaucoup de scenic paved”, ou “OSM ne permet pas d’être sûr”.

### 3. Terrain / Route Intent Planner

Responsabilité : transformer une demande utilisateur et un audit terrain en intention route-level exploitable par le solver.

Cette couche est la vraie nouveauté V2.5. Elle doit rester déterministe, testable et simple. Elle ne trace pas la route. Elle choisit une stratégie.

Stratégies P0 implémentées :

`forest_loop` : départ déjà dans ou très proche d’un massif naturel exploitable ; y rester un minimum de distance, revenir proprement.

`transition_to_woods` : départ résidentiel ou routier, mais massif exploitable proche ; accepter une section d’accès puis maximiser le dwell time dans les bois.

`park_loop` : petit parc urbain contraint ; garder une boucle propre, avec clean return fallback autorisé pour éviter les faux `SOLVER_EMPTY`.

`urban_nature_loop` : accepter plus de bitume mais maximiser sécurité, parc/canal/corridor et absence de grands axes.

`low_trail_potential` : potentiel trail trop faible ; refuser ou proposer de relâcher explicitement la promesse terrain.

### 4. Edge Scorer

Responsabilité : scorer la qualité locale d’un edge selon profil et intention.

À garder : scoring surface, nature, quietness, safety, elevation, continuity boost.

À changer : le scorer ne doit plus porter à lui seul l’intention route. Il doit produire des scores et features interprétables : `surfaceClass`, `surfaceConfidence`, `isPaved`, `isUnpaved`, `isScenic`, `isNaturalContext`, `isTrailHighway`, `busyRoadPenalty`, `accessRisk`, `corridorComponentId`. Les bonus dépendants de l’intention doivent venir de `RouteIntent`, pas être codés comme heuristiques globales.

### 5. Intentional Solver

Responsabilité : chercher des boucles qui satisfont une intention route-level et des budgets temps/distance.

À garder : beam search, multi-seed, garde distance, anti-U-turn immédiat, return cache, clean return avec fallback gardé, déduplication.

À changer : le solver doit recevoir des objectifs explicites du planner et piloter sa recherche avec des états route-level : composant naturel visité, distance dans massif, streak non revêtu, distance paved accumulée, aire de boucle approximative, distance au corridor cible, geometry overlap, budget temps restant. Il doit pouvoir privilégier “rester dans le corridor 2 km de plus” plutôt que “prendre l’edge localement le mieux scorée”.

### 6. Post-processor + Quality Gates

Responsabilité : ranker, expliquer, accepter/refuser.

À garder : ranking multi-candidats, `assessRouteQuality`, warnings bloquants, seuils benchmarks.

À changer : le ranking final doit comparer la route à son `RouteIntent`, pas seulement à un score composite. Une route peut avoir un bon score mais échouer son intention : par exemple stratégie `forest_loop` sans dwell time suffisant dans la zone naturelle, ou stratégie `low_trail_potential` qui cache trop de bitume sans warning/refus.

## Rôle détaillé du Terrain / Route Intent Planner

Le planner doit répondre à quatre questions avant le solver.

Première question : quel terrain exploitable existe réellement ? Il identifie les composants naturels ou scenic, leur taille utile, leur connectivité, leur surface dominante, leur confiance OSM et leur distance depuis le départ. Il distingue les corridors non revêtus des corridors scenic paved. Cette séparation est critique pour Tourville : une route forestière asphaltée peut être scenic, mais elle doit rester paved pour la métrique trail.

Deuxième question : quelle promesse est réaliste ? Pour un trail 10 km, si un massif non revêtu existe, l’objectif devient de le rejoindre et d’y rester. Si le terrain est majoritairement urbain mais avec canal/parc, l’objectif devient running nature plutôt que trail pur. Si OSM est pauvre, l’objectif peut être de générer avec `surfaceConfidence=medium` et warning, pas de prétendre à une route trail parfaite.

Troisième question : quelles contraintes donnent une bonne boucle ? Le planner fixe des cibles : minimum non-paved streak, maximum paved ratio attendu, minimum dwell time en natural zone, maximum overlap, aire minimale de boucle, fermeture propre stricte ou fallback autorisé, budget temps, shortlist adaptative.

Quatrième question : quels compromis sont acceptables ? Il produit un plan avec des relaxations ordonnées. Exemple : d’abord relâcher D+ en zone plate, puis accepter un peu plus de pavement si OSM est incomplet, mais ne jamais accepter grands axes, sens interdits, U-turns ou backtracking visible. Si le solver doit relâcher une contrainte, l’API doit pouvoir l’expliquer à l’utilisateur.

## Interfaces proposées

Ces interfaces sont indicatives. Elles décrivent le contrat cible sans imposer une implémentation immédiate.

```ts
type RouteIntentType =
  | "forest_loop"
  | "park_loop"
  | "urban_nature_loop"
  | "transition_to_woods"
  | "low_trail_potential";

type SurfaceClass = "paved" | "unpaved" | "unknown" | "mixed";

type TerrainComponent = {
  id: string;
  kind: "forest" | "park" | "river_corridor" | "trail_cluster" | "scenic_paved" | "unknown_natural";
  center: { lat: number; lng: number };
  totalKm: number;
  nonPavedKm: number;
  pavedKm: number;
  unknownSurfaceKm: number;
  entryNodeIds: string[];
  exitNodeIds: string[];
  nodeIds: string[];
  confidence: "low" | "medium" | "high";
};

type RouteIntent = {
  type: RouteIntentType;
  strategy: RouteIntentType;
  targetDistanceKm: number;
  targetElevationM: number;
  targetComponents: string[];
  minNaturalZoneDwellKm?: number;
  minNonPavedTrailStreakKm?: number;
  maxPavedRatio?: number;
  maxBusyRoadRatio: number;
  maxRepeatEdgeRatio: number;
  maxGeometryOverlapRatio: number;
  minLoopAreaKm2?: number;
  cleanReturnMode: "strict" | "prefer" | "fallback_allowed";
  timeBudgetMs: number;
  beamBudget: {
    beamWidth: number;
    maxIterations: number;
    shortlistSize: number;
  };
  relaxationOrder: Array<
    | "elevation"
    | "distance"
    | "paved_ratio"
    | "natural_dwell"
    | "clean_return"
  >;
  userWarningsIfRelaxed: string[];
};

type SolverIntentState = {
  visitedComponentIds: Set<string>;
  naturalZoneDwellKm: number;
  currentNonPavedStreakKm: number;
  longestNonPavedStreakKm: number;
  pavedKm: number;
  busyRoadKm: number;
  approximateLoopAreaKm2: number;
  geometryOverlapRatio: number;
  usedUndirectedEdgeKeys: Set<string>;
};

type RouteIntentMatch = {
  score: number;
  matched: boolean;
  failures: string[];
  relaxationsUsed: string[];
};
```

## Séparation anti-usine à heuristiques

V2.5 doit imposer une frontière stricte entre quatre niveaux.

Edge-level : surface, highway, access, sécurité, élévation locale, scenic/natural context, quietness. Le résultat est un score local et des features.

Route-level : distance, D+, fermeture, aire, overlap, repeat edges, U-turns, continuité, dwell time, bitume total. Ces métriques ne doivent pas être cachées dans le score edge.

Terrain constraints : potentiel, confiance OSM, composants, surface ambiguity, corridors, zones naturelles. Elles doivent piloter l’intention avant la recherche.

Ranking final : comparaison des candidats à la demande utilisateur et à l’intention choisie, puis acceptation/refus/warnings. Le ranking ne doit pas reclassifier une route mauvaise en succès parce qu’un score composite est haut.

Règle pratique : si une nouvelle logique utilise l’historique du chemin ou la forme globale, elle ne va pas dans `edge-scorer.ts`. Si elle utilise un composant naturel, une stratégie ou une relaxation, elle vient du planner. Si elle décide acceptation/refus, elle va dans quality gates ou benchmark thresholds.

## Solver intentionnel

Le solver V2.5 doit évoluer par petites étapes, pas être remplacé brutalement.

La première évolution est l’entrée en zone naturelle. Si le planner choisit `forest_loop` ou `transition_to_woods`, le solver doit recevoir des `targetComponents` avec portes d’entrée. Pendant les premiers 30–45 % de la distance, il peut accepter une route d’accès moins bonne localement si elle rapproche d’un massif exploitable. Ce comportement existe déjà partiellement avec `NaturalAnchor`, mais il doit devenir une décision planner, pas une constante globale.

La deuxième évolution est le maintien dans les corridors. Une fois dans un composant naturel ou non revêtu, le solver doit valoriser la durée de séjour et la continuité : `naturalZoneDwellKm`, `longestNonPavedStreakKm`, `naturalCorridorRatio`. Il doit pénaliser les fragments : entrer 200 m dans un bois puis ressortir sur route ne satisfait pas une intention trail.

La troisième évolution est la fermeture propre. Le clean return actuel est le bon compromis : tenter d’éviter les edges déjà utilisées, mais garder un fallback si le strict clean return rend un cas routable impossible. V2.5 doit rendre ce mode adaptatif : `strict` en zones riches, `prefer` par défaut, `fallback_allowed` en petits parcs ou OSM pauvre. Le fallback ne doit jamais masquer un overlap : il doit marquer une relaxation ou warning si repeat/geometry overlap dépasse les seuils.

La quatrième évolution est l’anti-overlap géométrique. `repeatEdgeRatio` ne suffit pas. Deux segments parallèles très proches ou une boucle en huit serrée peuvent sembler différents par edge IDs mais mauvais visuellement. V2.5 doit ajouter un `geometryOverlapRatio` approximatif, d’abord simple : grille/spatial hash des segments, détection de segments proches et de sens inverse, puis pénalité/ranking. Pas besoin de géométrie computationnelle lourde au départ.

La cinquième évolution est la profondeur dans zone naturelle. Une route qui longe la bordure d’un bois ou d’un parc peut avoir un bon `naturalCorridorRatio` mais une faible qualité ressentie. Le planner peut approximer la profondeur par distance aux edges urbains ou par appartenance à des composants naturels continus. Version alpha : dwell time dans composant + longest streak. Version beta : distance à la lisière si natural polygons fiables.

## Stratégie pavedRatio et ambiguïté OSM

V2.5 ne doit pas tricher sur `pavedRatio`. Si OSM dit `surface=asphalt` ou `surface=concrete`, l’edge reste paved, même si elle traverse une forêt. Le cas Tourville le confirme : scenic paved est agréable, mais ce n’est pas du trail non revêtu.

Il faut distinguer trois situations.

Paved scenic confirmé : route ou chemin goudronné dans un environnement naturel. Acceptable en running nature, pénalisé en trail si trop long. Ne pas reclassifier en non-paved.

Surface inconnue dans contexte naturel : chemin `path`, `track`, `footway` ou scenic sans surface. Acceptable avec confiance moyenne, surtout si connecté à un corridor naturel. Peut contribuer à `naturalCorridorRatio`, mais pas forcément réduire `pavedRatio` de façon optimiste. Il faut exposer `surfaceUnknownRatio` et `surfaceConfidence`.

OSM pauvre ou ambigu : beaucoup de chemins sans surface, composants fragmentés, surface confidence basse. Le moteur peut générer avec warning ou proposer compromis, mais les benchmarks doivent garder des seuils réalistes par cas. Ne pas baisser globalement `maxPavedRatio` ou le relâcher sans audit edge-level.

Pour Tourville, le levier propre est : favoriser la continuité non revêtue quand disponible, limiter les longs segments paved scenic en profil trail, et expliquer quand le terrain local impose du bitume. Le mauvais levier serait de compter asphalt scenic comme trail.

## Paramètres adaptatifs

Les paramètres doivent dépendre de la typologie terrain, pas être globaux.

Shortlist post-process : 24 candidats aide Tourville mais augmente le coût. V2.5 doit adapter la shortlist : petite en graphes simples, plus large en terrain fragmenté ou fort potentiel trail, plafonnée en zones denses.

Clean return : strict si le graphe a des alternatives et un potentiel trail élevé ; prefer par défaut ; fallback allowed si petit parc, réseau pauvre ou risque `SOLVER_EMPTY`.

Beam width et iterations : augmenter seulement si le planner détecte un choix stratégique réel à explorer. En Paris/Meudon, le budget temps prime : éviter l’explosion en graphes denses.

Rayon Overpass : ne pas élargir naïvement. En ville dense, mieux vaut choisir une stratégie urbaine/corridor ou refuser proprement que multiplier nodes/edges, elevation calls et temps solver.

Seuils paved/nature : liés au profil et au terrain. Trail pur en Fontainebleau n’a pas le même seuil qu’un running nature à Caen ou Paris 19. Les seuils benchmarks restent la source de vérité par cas.

## Métriques first-class V2.5

Les métriques suivantes doivent être visibles dans les artifacts benchmark et, au minimum, loggées par stage.

`distanceKm`, `distanceErrorRatio`, `ascendM`, `elevationErrorM`, `loopGapKm`, `productionScore`, `busyRoadRatio`, `pavedRatio`, `surfaceUnknownRatio`, `surfaceConfidence`, `trailRatio`, `naturalCorridorRatio`, `longestTrailSegmentKm`, `longestNonPavedTrailStreakKm`, `naturalZoneDwellKm`, `naturalZoneDwellRatio`, `naturalComponentVisitCount`, `scenicPavedRatio`, `repeatEdgeRatio`, `uTurnRatio`, `geometryOverlapRatio`, `loopAreaKm2`, `routeIntentMatchScore`, `routeIntentFailures`, `relaxationsUsed`, `terrainDataConfidence`, `trailPotential`, `stageTimings`.

`stageTimings` doit séparer au minimum : geocoding, Overpass, graph build, terrain audit, planning, elevation, edge scoring, solver, post-processing, GPX/export serialization. Le `durationMs` global reste utile, mais insuffisant pour diagnostiquer les régressions.

## Benchmarks et QA

Aucune release moteur V2.5 ne doit passer sans benchmarks live et tests unitaires ciblés.

Benchmarks obligatoires avant release moteur : les 12 cas actuels de `lib/route-benchmarks-data.json`, avec artifacts sauvegardés. Tourville 5/8/10/12 reste obligatoire parce qu’il combine overlap, pavedRatio, OSM ambiguity et attentes trail locales. Fontainebleau et Meudon valident les vrais massifs forestiers. Paris 19 valide la densité urbaine et le non-élargissement Overpass. Lille valide l’adhérence distance en urbain nature. Nanterre valide l’évitement grands axes. Caen et Clécy valident les cas normands Phase 1.

Nouveaux cas recommandés : un cas “petit parc urbain contraint” où clean return strict doit fallback sans `SOLVER_EMPTY`; un cas “OSM surfaces inconnues mais chemins connectés” ; un cas “scenic paved forest road” pour vérifier qu’on ne triche pas sur `pavedRatio`; un cas “corridor canal/rivière” pour running nature ; un cas “départ résidentiel proche massif” pour valider l’accès stratégique.

Tests unitaires P0 : planner choisit la bonne stratégie selon audit terrain ; clean return strict/prefer/fallback ; routeIntentMatch échoue si dwell time insuffisant ; paved scenic reste paved ; unknown surface en contexte naturel augmente confidence/nature mais ne devient pas paved=false par magie ; shortlist/budgets s’adaptent à densité.

Artifacts P0 : ajouter un export edge-level dans les artifacts benchmark, comme indiqué dans `docs/route-engine-quality-backlog.md` : `edgeId`, `osmWayId`, `highway`, `surface`, `lengthKm`, `score`, flags trail/natural/paved/busy, repeat count, componentId, reason. Sans cet export, on continue à deviner.

Règle de décision : si lint/tests/build passent mais que le benchmark ciblé demandé reste rouge, ne pas pousser de changement moteur. Pour un document d’architecture seul, un build complet n’est pas nécessaire ; le diff doit être vérifié.

## État P0-0 — fondations stabilisées

État au 2026-05-01 : le repo contient une base V2.5 documentée et des travaux locaux cohérents issus des missions précédentes : clean return anti-overlap, tests de régression pathfinder/solver, audit Tourville pavedRatio et backlog qualité. Ces changements ne doivent pas être écrasés : ils forment le socle de diagnostic de P0-1.

Validations P0-0 attendues avant push : `npm run lint`, `npm run test:run`, `npm run build`. Le benchmark live complet reste requis avant tout changement moteur produit, mais il n’est pas bloquant pour cette mission de cadrage tant qu’aucun nouveau patch moteur n’est ajouté sans mesure.

Décision d’équipe simulée : CTO Route Engine valide l’ajout du planner comme couche de clarification, Senior Algorithm Engineer insiste sur clean return avec fallback mesuré, QA Benchmark Lead impose artifacts edge-level avant nouveau tuning, Product Lead Trail refuse de masquer le bitume Tourville en succès, YC/Business Angel rappelle que l’architecture doit accélérer 20 testeurs qualifiés et pas devenir une refonte longue.

Blocage principal pour P0-1 : il manque encore un contrat exécutable minimal du `RouteIntent` branché en lecture seule. Le prochain incrément doit donc livrer peu de code mais beaucoup de visibilité : types, planner déterministe, logs/artifacts et tests de stratégie. Ne pas commencer par modifier lourdement le solver.

## Plan d’exécution

### P0 — V2.5-alpha : rendre l’intention explicite sans refonte

Créer les types `RouteIntent`, `TerrainComponent`, `RouteIntentMatch` et un premier module planner déterministe. Il peut d’abord consommer les métriques existantes et quelques composants naturels simples dérivés du graphe.

Ajouter l’export diagnostic edge-level dans les artifacts benchmark. C’est le prérequis pour arrêter de patcher à l’aveugle `pavedRatio`, overlap et scoring.

Brancher le planner en lecture seule : générer et logger l’intention choisie sans modifier le solver. Vérifier sur les 12 benchmarks que les stratégies choisies sont cohérentes.

Ajouter tests unitaires planner : Tourville -> `transition_to_woods` ou `forest_loop` selon distance au massif ; Paris 19 -> `urban_nature_loop` ; Fontainebleau -> `forest_loop` ; petit parc urbain -> `park_loop` ; zone routière pauvre -> `low_trail_potential`.

Faire entrer `RouteIntent` dans le post-processing pour calculer `routeIntentMatchScore`, `routeIntentFailures` et `relaxationsUsed` sans encore bloquer toutes les routes.

### P1 — V2.5-beta : solver intentionnel minimal

Remplacer les constantes globales de natural anchors par des objectifs du planner : target components, min dwell, min non-paved streak, clean return mode.

Ajouter état solver pour `naturalZoneDwellKm`, `longestNonPavedTrailStreakKm`, `pavedKm`, `visitedComponentIds` et `usedUndirectedEdgeKeys`. P0-2 a déjà livré la première mesure route-level `naturalZoneDwellKm` / `naturalZoneDwellRatio` dans `route-quality` et `terrain-audit`; P1 doit maintenant la connecter aux objectifs du planner plutôt que la laisser purement diagnostique.

Rendre clean return adaptatif : strict/prefer/fallback_allowed avec tracking des relaxations. Garder le fallback pour éviter les faux `NO_ROAD_NETWORK`, mais ne jamais masquer l’overlap dans les métriques.

Ajouter `geometryOverlapRatio` simple par spatial hash et `loopAreaKm2`. Les utiliser d’abord dans post-processing, puis comme pénalité solver si stable.

Adapter shortlist, beamWidth, iterations et budget temps selon densité graphe, trailPotential et stratégie. Objectif : ne pas dépasser les seuils duration sur Paris/Meudon/Tourville.

### P2 — Validation testeurs et polish produit

Transformer les relaxations en messages utilisateur : distance ajustée, D+ relâché, peu de sentiers, surface OSM incertaine, bitume nécessaire localement, zone dense.

Mettre en place comparaison benchmark avant/après avec tableau de deltas sur distance, score, paved, repeat, U-turn, longestTrailSegment, natural dwell, geometry overlap et durée.

Créer une revue hebdo de 20 routes réelles issues de testeurs : artifacts, feedback, GPX couru ou rejeté. Le moteur doit évoluer à partir de ces retours, pas seulement à partir de cas synthétiques.

Stabiliser les seuils par typologie seulement après audit : trail forestier, périurbain nature, urbain canal/parc, OSM pauvre. Pas de baisse globale opportuniste.

## Décisions explicites

On garde V2 comme base. Graph Builder, Edge Scorer, Solver et Post-processor restent les couches principales. On ne repart pas sur un moteur externe ou un algorithme académique complet.

On ajoute une couche `Terrain / Route Intent Planner` avant le solver. C’est la décision structurante V2.5.

On sépare scoring local, objectifs route-level, contraintes terrain et ranking final. Plus de patches produit cachés dans un coefficient edge-level.

On garde clean return avec fallback gardé. Le strict-only serait fragile sur petits graphes et OSM incomplet. Le fallback doit cependant être mesuré et exposé.

On ne reclassifie pas asphalt/concrete scenic en non-paved. `pavedRatio` reste honnête.

On rend les paramètres adaptatifs, mais uniquement selon des signaux lisibles : densité graphe, potentiel trail, confiance OSM, fragmentation, stratégie. Pas de tuning opaque par ville.

On refuse de pousser un changement moteur si le benchmark concerné reste rouge, même si les tests unitaires passent.

## Ce qu’on refuse de construire maintenant

Pas de refonte complète du solver en contraction hierarchies, ILP, A*, genetic algorithm ou moteur multi-modal complexe. Trop long, pas nécessaire pour valider Phase 1.

Pas d’intégration Garmin OAuth, mobile native, social, vélo, VTT longue distance, ni promesse Komoot killer. Le scope reste boucles trail/running 5–15 km.

Pas de ML ranking, pas d’apprentissage automatique sur feedback tant que les artifacts et métriques edge-level ne sont pas propres.

Pas de dépendance à une API routing externe pour le cœur Phase 1 trail/running. Les clés externes peuvent aider plus tard, mais ne doivent pas masquer la fiabilité V2.5.

Pas de baisse globale des seuils qualité pour faire passer les benchmarks. Si un seuil est mauvais, il faut un audit terrain et une décision documentée.

Pas d’élargissement automatique agressif Overpass en ville dense. Paris peut exploser en nodes/edges ; le moteur doit borner le coût et refuser proprement si nécessaire.

## Risques

Risque de sur-ingénierie : le planner peut devenir une deuxième usine à heuristiques. Garde-fou : peu de stratégies, tests unitaires, interfaces stables, logs lisibles, décisions explicites.

Risque de ralentissement : plus de métriques et états solver peuvent augmenter la durée. Garde-fou : budgets adaptatifs, stage timings, maxDurationMs benchmarks, pas de shortlist large partout.

Risque de sur-optimisation Tourville : Tourville est précieux mais ne doit pas dicter tout le moteur. Garde-fou : panel complet 12 benchmarks + nouveaux cas petits parcs/OSM pauvre/scenic paved.

Risque OSM : surfaces inconnues, scenic paved, natural polygons incomplets. Garde-fou : `surfaceConfidence`, `terrainDataConfidence`, warnings utilisateur, pas de reclassification opportuniste.

Risque produit : une architecture trop élégante mais lente à livrer retarde la validation marché. Garde-fou : P0 en lecture/logs d’abord, P1 minimal, testeurs dès que les routes sont mesurables.

## Critères de succès V2.5

V2.5-alpha réussit si le planner produit une intention cohérente et loggée pour les 12 benchmarks, si les artifacts edge-level permettent d’expliquer paved/overlap, et si aucun comportement moteur existant n’est cassé.

V2.5-beta réussit si Tourville réduit durablement `pavedRatio` quand des chemins non revêtus existent, sans réintroduire repeat edges/U-turns, et sans faire exploser les temps sur Paris/Meudon.

La validation produit réussit si des testeurs trail/running exportent et courent des routes, si les refus/compromis sont compréhensibles, et si les échecs se concentrent sur des problèmes corrigeables plutôt que sur une promesse non tenue.

Le seuil business reste simple : V2.5 doit accélérer l’apprentissage terrain. Si l’architecture n’aide pas Clément à obtenir plus vite 20 testeurs qualifiés, 100 routes générées, 30 exports GPX, 5 routes courues et 3 utilisateurs qui redemandent une route, elle est trop lourde.
