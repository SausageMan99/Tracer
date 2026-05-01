# Diagnostic benchmark Fontainebleau P0-3

## Contexte

Le benchmark `fontainebleau-trail-15k` sert de garde-fou P0-3 pour vérifier que TrailForge sait générer une boucle trail forestière longue, diagnostiquer ses choix edge-level et produire des artifacts exploitables.

## Problème initial

L’ancre précédente `Place Denecourt, Fontainebleau` n’était pas assez stable côté géocodage. Le benchmark pouvait échouer avant même d’atteindre le moteur de route, ce qui mélangeait un problème d’entrée benchmark avec un problème solver.

Correction retenue : utiliser l’ancre plus stable `Château de Fontainebleau, Fontainebleau`.

## Corrections P0-3

Le benchmark produit désormais trois artifacts principaux :

- JSON route complet ;
- GeoJSON de la meilleure route ;
- JSON diagnostics edge-level : `<case>.edges.json`.

Les diagnostics edge-level exposent notamment : identifiants d’arêtes, `edgeKey`, `osmWayId`, noeuds source/cible, coordonnées, `highway`, `surface`, accès, `oneway`, `name`, `ref`, `componentId`, longueur, score, `scoreReason`, flags trail/paved/natural/scenic/busy/restricted/onewayViolation, `repeatCount` et `repeated`.

Le post-processing reçoit aussi le `routeIntent`, ce qui permet de relier les choix d’arêtes aux composants terrain ciblés par le planner.

## Dernier run validé

Commande :

```bash
ROUTE_BENCHMARK_BASE_URL=http://localhost:3000 npm run benchmark:routes -- --case fontainebleau-trail-15k --save-artifacts --output artifacts/route-benchmark-results/fontainebleau-p0-3-final.json
```

Résultat : PASS.

Metrics clés :

- `distanceKm`: 15.066 km vs target 15 km
- `ascendM`: 238 m vs target 200 m, dans la tolérance de 120 m
- `productionScore`: 0.9237
- `loopClosureKm`: 0.0397
- `busyRoadRatio`: 0
- `naturalWayRatio`: 0.9858
- `pavedRatio`: 0.1374
- `trailBeautyScore`: 0.8957
- `longestTrailSegmentKm`: 12.892 km
- `naturalCorridorRatio`: 0.9858
- `repeatEdgeRatio`: 0
- `uTurnRatio`: 0
- `terrainDataConfidence`: medium
- `trailPotential`: high

Warning restant : données terrain moyennes, car beaucoup de chemins OSM n’ont pas de surface renseignée. Ce n’est pas bloquant pour P0-3.

## Décision

P0-3 est considéré vert pour Fontainebleau : géocodage stable, génération OK, quality gates respectés, pas de backtracking bloquant, et artifacts edge-level exploitables pour expliquer les choix du moteur.

## Limites connues

Le benchmark dépend encore de services externes : serveur local, Overpass, géocodage et providers d’élévation. Les timeouts `OVERPASS_TIMEOUT` / `NO_ROAD_NETWORK` doivent être traités comme de la flakiness fournisseur quand un run précédent passe avec les mêmes paramètres et que les artifacts sont cohérents.

Tourville reste un cas distinct : le `pavedRatio` peut être structurellement élevé à cause des surfaces asphalt/concrete réelles dans OSM. Ce sujet relève plutôt de la suite P0-4/P1 solver/scoring que du blocage P0-3 Fontainebleau.
