# Route engine quality backlog

Dernière revue : 2026-05-01, après P0-4 consolidation benchmarks Fondations V2.5.

## État actuel

Le socle de mesure a fortement progressé. `npm run benchmark:routes` centralise maintenant 12 cas Phase 1 trail/running dans `lib/route-benchmarks-data.json`, avec seuils explicites sur distance, D+, score production, fermeture de boucle, grands axes, ratios nature/bitume, overlap/backtracking, U-turn, potentiel terrain, confiance OSM et durée. Le runner sauvegarde un rapport JSON et, avec `--save-artifacts`, les payloads routes + GeoJSON inspectables. P0-2 ajoute aussi des métriques de séjour en zone naturelle continue : `naturalZoneDwellKm` et `naturalZoneDwellRatio`, d'abord basées sur des séquences contiguës d'edges natural/scenic/non-paved d'au moins 500 m.

Les changements moteur locaux de la mission fiabilité ajoutent une tentative de retour propre en fermeture de boucle : avant de fermer via le plus court chemin A*, le solver tente un retour qui évite les edges déjà utilisées. Le fallback A* classique reste gardé pour éviter de transformer un terrain routable en `NO_ROAD_NETWORK`. Le post-processing classe aussi plus durement les candidats avec repeat edges, U-turns et pavement élevé.

Ces changements passent les validations techniques locales, mais ne doivent pas être considérés comme validés produit tant que le benchmark Tourville reste rouge.

## Mesures Tourville disponibles

Source avant correction : `artifacts/route-benchmark-results/nightly-tourville-before.json`.

Source après correction : `artifacts/route-benchmark-results/nightly-tourville-after.json`.

| Cas | Avant | Après | Lecture |
| --- | --- | --- | --- |
| 5 km | 4.41 km, score 0.814, paved 98.2 %, repeat 7.6 %, échecs `paved_ratio`, `repeat_edge_ratio` | 4.86 km, score 0.921, paved 78.3 %, repeat 3.9 %, échec `paved_ratio` | Distance et overlap améliorés, bitume encore trop haut. |
| 8 km | 7.24 km, score 0.759, paved 57.1 %, repeat 1.2 %, échec `paved_ratio` | 7.86 km, score 0.821, paved 59.3 %, repeat 2.7 %, échec `paved_ratio` | Distance/score meilleurs, mais pas de progrès bitume. |
| 10 km | 8.92 km, score 0.701, paved 58.9 %, repeat 1.0 %, échecs `distance_tolerance`, `production_score`, `paved_ratio` | 9.63 km, score 0.767, paved 54.9 %, repeat 3.2 %, échecs `elevation_tolerance`, `paved_ratio` | Distance et score corrigés ; D+ mesuré à 0 m sur ce run, à auditer. |
| 12 km | 11.60 km, score 0.804, paved 45.8 %, repeat 7.1 %, U-turn 0.6 %, échecs `paved_ratio`, `repeat_edge_ratio` | 11.79 km, score 0.804, paved 48.3 %, repeat 3.6 %, U-turn 0 %, échec `paved_ratio` | Backtracking résolu sous seuil, mais bitume et temps 70.8 s restent limites. |

Conclusion : la correction est utile contre overlap/backtracking, surtout sur 5 km et 12 km. Le problème dominant restant n'est plus la fermeture de boucle, mais la sélection d'edges et/ou la classification surface/pavement sur Tourville. Les seuils `pavedRatio` restent rouges sur les 4 distances.

## Consolidation P0-4 — benchmarks Fondations V2.5

Commande cible relancée localement avec serveur Next dev sur `http://localhost:3000` et artifacts datés sous `artifacts/route-benchmark-results/p0-foundations-2026-05-01T2200/`.

Synthèse décisionnelle : P0 Fondations est **partiel, pas prêt pour P1 moteur lourd**. Les briques de mesure, le planner en lecture/diagnostic, les artifacts edge-level et Fontainebleau sont verts, mais le panel P0 reste rouge sur backtracking Tourville court/long, durée Meudon/Caen, et pavedRatio Caen Colline. Le signal important est que `pavedRatio` Tourville s'améliore nettement sur 8/10/12 km, mais le correctif déplace le risque vers repeat/backtracking sur 5/12 km. Il ne faut donc pas pousser de tuning moteur supplémentaire sans isoler la fermeture propre et le ranking.

| Cas P0 | Statut | Métriques clés | Lecture |
| --- | --- | --- | --- |
| Tourville 5 km | Rouge | 4.65 km, score 0.709, paved 38.3 %, repeat 14.8 %, U-turn 0 %, 38.2 s | Bitume sous seuil, mais backtracking/repeat critique. |
| Tourville 8 km | Vert | 7.48 km, score 0.755, paved 39.8 %, repeat 0 %, U-turn 0 %, 53.2 s | Premier vrai vert Tourville sur distance intermédiaire. |
| Tourville 10 km | Vert | 9.56 km, score 0.775, paved 41.7 %, repeat 0.6 %, U-turn 0 %, 56.9 s | Vert et nettement meilleur que les runs précédents sur bitume/D+. |
| Tourville 12 km | Rouge | 11.65 km, score 0.766, paved 31.9 %, repeat 8.2 %, U-turn 0.2 %, 57.7 s | Bitume bon, mais clean return/ranking réintroduit backtracking. |
| Fontainebleau 15 km | Vert | 15.04 km, score 0.985, paved 16.2 %, repeat 0 %, U-turn 0 %, 69.5 s | P0-3 confirmé : forêt massive stable et artifacts edge-level OK. |
| Meudon 10 km | Rouge | 9.64 km, score 0.754, paved 25.8 %, repeat 0.1 %, U-turn 0.05 %, 169.3 s | Qualité route correcte, mais durée x2 au-dessus du seuil. Cause probable : graphe dense + shortlist/solver trop coûteux. |
| Caen Colline 6 km | Rouge | 5.85 km, score 0.789, paved 75.5 %, repeat 0.07 %, U-turn 0 %, 101.4 s | Route propre mais trop bitumée et trop lente pour un petit parc. Probable stratégie `park_loop`/seuil paved à revoir, sans tricher sur OSM. |
| Caen Prairie 8 km | Bloqué infra/moteur | timeout local à 130 s, pas de rapport JSON écrit | Requête trop lente ou bloquée ; à traiter comme P0 critique de budget temps. |

Artifacts créés : rapports JSON agrégés par cas, GeoJSON route et diagnostics `<case>.edges.json` pour tous les cas terminés. Caen Prairie n'a pas d'artifact exploitable à cause du timeout.

Décision P0 : **fondations de mesure validées, release moteur non validée**. On peut passer à P1 seulement sur des tâches de diagnostic/bornage, pas sur un tuning produit aveugle. Priorité immédiate : réduire le coût et stabiliser anti-overlap avant d'élargir les ambitions solver.

Priorités P0/P1 réordonnées après consolidation :

1. Borner le temps par stage et ajouter un timeout fetch/API dans `run-route-benchmarks.mjs`, pour éviter les runs silencieux de plusieurs minutes et séparer Overpass/elevation/solver/post-process.
2. Isoler Tourville 5/12 avec edge diagnostics : identifier si `repeatEdgeRatio` vient du terminal stem, de la fermeture A*, ou du ranking qui sélectionne un candidat plus naturel mais superposé.
3. Rendre la shortlist adaptative immédiatement : 40 candidats trail partout est trop cher pour Meudon/Caen ; garder large seulement quand le planner prouve un gain et quand le graphe est borné.
4. Auditer Caen Colline edge-level : si les voies du parc sont réellement asphaltées, le cas doit être assumé comme running nature paved, pas trail non revêtu ; si c'est un manque OSM, exposer `surfaceUnknownRatio` au lieu de forcer paved.
5. Rejouer Caen Prairie après timeout avec logs stage-level. Sans cela, impossible de savoir si le blocage est Overpass, élévation ou solver.

## Risques et angles morts

### Sur-optimisation Tourville

Le clean return évite les edges déjà parcourues pendant la fermeture. C'est sain, mais la validation actuelle est quasi uniquement Tourville. Il faut vérifier que cette préférence ne dégrade pas les petits parcs urbains, les réseaux pauvres ou les zones avec peu d'alternatives.

### Temps de génération

Le passage du shortlist post-process de 8 à 24 candidats améliore les chances de trouver une route plus propre, mais augmente le coût. Tourville 12 km passe à 70.8 s, proche du seuil 80 s. Paris/Meudon/Fontainebleau doivent être surveillés avant toute généralisation.

### Paved ratio ambigu

Tourville affiche simultanément un `naturalWayRatio` élevé et un `pavedRatio` élevé. Ça peut venir d'un vrai compromis terrain, d'une classification OSM où beaucoup de chemins naturels sont surface asphalt/paved, ou d'un scoring qui touche les bois sans y rester assez. Avant de relâcher les seuils, il faut auditer les edges exactes des GeoJSON/JSON : highway, surface, wayId, longueur et position.

### D+ instable

Le cas 10 km après correction sort `ascendM: 0` alors que le run avant avait 63 m. C'est probablement un signal d'élevation fallback/cache/échantillonnage, pas une vraie amélioration route. À isoler avant de piloter le solver sur le D+.

### Benchmarks non-live incomplets

Les tests Vitest garantissent la structure des cas et le calcul des seuils. Ils ne remplacent pas les benchmarks live : Overpass, géocodage, élévation, cache et API peuvent encore casser sans test unitaire.

## Priorités P0

1. Auditer `pavedRatio` sur Tourville avec les artifacts route JSON/GeoJSON : extraire les 20 plus longs edges paved, leurs `highway`, `surface`, `osmWayId`, longueur, score et proximité bois. Objectif : savoir si le problème est classification, scoring ou manque de chemins réellement non-bitumés.

2. ✅ P0-2 : stabiliser le clean return avec un test solver de régression. `tests/orienteering-solver.test.ts` construit maintenant un mini-graphe où la fermeture A* classique réutiliserait un tronçon et vérifie que le solver choisit l'alternative propre, avec `repeatEdgeRatio` sous seuil.

3. Borner le coût du shortlist 24 candidats. Mesurer `durationMs` sur les 12 benchmarks, puis réduire ou rendre adaptatif si Paris/Meudon dépassent les seuils. Ne pas laisser Tourville 12 km devenir un cas à 70-80 s en production.

4. Corriger l'anomalie D+ du 10 km Tourville après correction. Comparer les artifacts avant/après : nombre de points, présence d'elevation, source d'élévation, fallback à zéro. Si l'ascendM tombe à zéro, le benchmark doit remonter une alerte dédiée plutôt qu'un simple `elevation_tolerance`.

5. Relancer le panel complet `npm run benchmark:routes -- --save-artifacts` sur serveur local propre avant tout push moteur. Règle : si Tourville reste rouge, ne pas pousser de changement moteur sur `main`.

## Priorités P1

1. Ajouter un export diagnostic edge-level dans les artifacts benchmark : par segment, inclure `edgeId`, `osmWayId`, `highway`, `surface`, `lengthKm`, `score`, flags trail/natural/paved/busy, et repeat count. C'est le chaînon manquant pour comprendre les routes visuellement mauvaises.

2. Séparer `trailRatio`, `naturalWayRatio` et `pavedRatio` dans l'interprétation produit. Une route peut être très naturelle mais encore bitumée ; le benchmark doit aider à décider si c'est acceptable selon le profil.

3. Ajouter des cas de régression `OSM pauvre` et `petit parc urbain` pour vérifier que l'anti-overlap ne provoque pas des `SOLVER_EMPTY` sur des réseaux contraints.

4. Suivre un budget temps par stage : geocoding, Overpass, elevation, solver, post-processing. Aujourd'hui `durationMs` global ne dit pas quelle étape explose.

5. Créer une commande de comparaison benchmark avant/après qui sort un tableau de deltas sur distance, score, paved, repeat, U-turn, longestTrailSegment et durée.

## Priorités P2

1. Ajuster les seuils par typologie terrain seulement après audit edge-level. Ne pas baisser globalement `maxPavedRatio` ou le contraire sans preuve terrain.

2. Ajouter un contrôle de diversité géométrique : aire de boucle, ratio bounding-box/distance, segments parallèles proches, micro out-and-backs. `repeatEdgeRatio` ne capture pas tous les overlaps visuels.

3. Ajouter une inspection GPX ciblée si les artifacts montrent des points dupliqués, des sauts, ou une fermeture artificielle visible dans les apps GPS.

4. Documenter les limites connues par région : dense city Overpass, zones boisées avec surfaces OSM incomplètes, départs résidentiels avec peu de chemins directs.

## Hardening P0 — rattrapage 2 du 2026-05-02

Revue autonome effectuée sur la branche `feat/p1-2-quality-ratio-interpretation`, commit courant `159a9bc`. Le repo est propre et aligné avec son remote de branche, mais il n'est pas encore mergé dans `main` : `main` pointe sur `037d5dc`, avant les commits P1 `quality ratios`, `contextual intent`, `benchmark timeout` et `generation diagnostics`.

Verdict technique P0 : **partiel**. Les fondations sont traçables et les validations globales passent, mais la release moteur n'est pas prête tant que le panel live garde des rouges objectifs sur géométrie/overlap et budget temps. Ne pas masquer ces rouges par un seuil plus laxiste.

Traceabilité des 10 items P0 vérifiés :

| Item P0 | Preuve code/docs/tests/artifacts | Statut |
| --- | --- | --- |
| 1. Repo propre et validations | `git status --short --branch`, `npm run lint`, `npm run test:run`, `npm run build` | Vert technique |
| 2. Architecture V2.5 cadrée | `docs/route-engine-v2-5-architecture.md` | Vert |
| 3. Benchmark panel centralisé | `lib/route-benchmarks-data.json`, `tests/route-benchmarks.test.ts` | Vert |
| 4. Runner borné en temps | `scripts/run-route-benchmarks.mjs`, `ROUTE_BENCHMARK_TIMEOUT_MARGIN_MS`, `BENCHMARK_TIMEOUT` | Vert technique |
| 5. Artifacts exploitables | `.json`, `.geojson`, `.edges.json` sous `artifacts/route-benchmark-results/` + `tests/route-benchmark-artifacts.test.ts` | Vert |
| 6. Fontainebleau corrigé | ancre `Château de Fontainebleau, Fontainebleau`, `docs/fontainebleau-benchmark-diagnosis.md`, artifact `v25-readiness-20260501T221748Z/fontainebleau-15k.json` PASS | Vert |
| 7. Clean return / anti-overlap | `lib/engine/orienteering-solver.ts`, `lib/engine/pathfinder.ts`, `tests/pathfinder.test.ts`, `tests/orienteering-solver.test.ts` | Vert unitaire, rouge partiel live |
| 8. Natural dwell / corridor | `lib/engine/route-quality.ts`, `lib/engine/terrain-audit.ts`, `tests/route-quality.test.ts`, `tests/terrain-audit.test.ts` | Vert technique |
| 9. Ratios qualité séparés | `naturalWayRatio`, `trailRatio`, `pavedRatio`, route explanations, benchmark summaries | Vert technique |
| 10. Diagnostics génération/API | `includeGenerationDiagnostics`, `stageTimings`, stripping public par défaut dans `app/api/generate-route/route.ts` et tests API | Vert technique |

Derniers artifacts lus pendant ce rattrapage :

| Artifact | Résultat | Lecture |
| --- | --- | --- |
| `v25-readiness-20260501T221748Z/tourville-8k.json` | PASS, 7.62 km, score 0.808, paved 35.0 %, repeat 3.8 %, durée 44.1 s | Bon signal ciblé Tourville 8k. |
| `v25-readiness-20260501T221748Z/fontainebleau-15k.json` | PASS, 16.01 km, score 0.863, paved 15.3 %, repeat 0 %, durée 80.0 s | Fontainebleau corrigé, mais proche du budget temps. |
| `v25-readiness-20260501T220810Z/readiness-smoke.json` | FAIL panel smoke | Tourville reste rouge sur self-intersections/intent weak match ; Caen, Meudon et Fontainebleau y timeoutent avec le budget strict. |
| `p0-foundations-2026-05-01T2200/*` | Mix PASS/FAIL | Tourville 8/10 et Fontainebleau PASS ; Tourville 5/12 FAIL repeat/backtracking ; Meudon FAIL durée ; Caen Colline FAIL paved/durée ; Caen Prairie sans artifact à cause timeout. |

Décision : les tests introduits prouvent bien les comportements isolés attendus, surtout stripping diagnostics, artifacts edge-level, clean-return solver synthétique, ratios et geometry metrics. Ils ne prouvent pas encore que le moteur est prêt produit, car les benchmarks live révèlent encore des échecs terrain réels. La prochaine correction utile n'est pas un nouveau seuil : c'est un ciblage solver/ranking sur self-intersections + budget temps par stratégie, en gardant les artifacts comme juge.

## Commandes de revue utiles

```bash
npm run lint
npm run test:run
npm run build
npm run benchmark:routes -- --help
npm run benchmark:routes -- --case tourville --save-artifacts --output artifacts/route-benchmark-results/tourville-latest.json
```

Pour l'analyse des artifacts, partir de :

```text
artifacts/route-benchmark-results/nightly-before/
artifacts/route-benchmark-results/nightly-after/
```

## Règle de décision

Les changements techniques sont acceptables seulement s'ils améliorent simultanément la fiabilité produit et les benchmarks ciblés. Une route qui génère en HTTP 200 mais reste rouge sur `paved_ratio`, `repeat_edge_ratio`, `u_turn_ratio`, `distance_tolerance` ou `duration_ms` n'est pas une réussite produit.
