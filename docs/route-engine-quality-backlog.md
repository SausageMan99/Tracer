# Route engine quality backlog

Dernière revue : 2026-05-01, après P0-2 natural dwell + test solver anti-overlap.

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
