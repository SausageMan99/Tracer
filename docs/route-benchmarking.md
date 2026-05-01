# Route engine benchmarks

TrailForge doit être évalué comme un produit trail/running, pas seulement comme une API qui répond 200. Le script `npm run benchmark:routes` rejoue les cas terrain critiques contre `/api/generate-route` et échoue dès qu'une route viole un seuil qualité critique.

## Lancer le banc

```bash
ROUTE_BENCHMARK_BASE_URL=http://localhost:3000 npm run benchmark:routes
```

Par défaut, le script cible `http://localhost:3000`. Pour tester Vercel ou une preview :

```bash
ROUTE_BENCHMARK_BASE_URL=https://trailforge-preview.vercel.app npm run benchmark:routes
```

Commandes utiles :

```bash
npm run benchmark:routes -- --help
npm run benchmark:routes -- --list
npm run benchmark:routes -- --case tourville
npm run benchmark:routes -- --case tourville-pommiers-trail-10k --save-artifacts
npm run benchmark:routes -- --case caen --output artifacts/route-benchmark-results/caen.json
```

## Source de vérité

Les scénarios sont définis dans `lib/route-benchmarks-data.json`. Ce fichier est consommé par `lib/route-benchmarks.ts`, par les tests Vitest et par le runner Node `scripts/run-route-benchmarks.mjs`. Il ne doit pas y avoir de deuxième liste cachée.

Le panel actuel contient 12 cas, orientés Phase 1 trail/running : Tourville-sur-Odon 5/8/10/12 km depuis `7 Rue des Pommiers`, Caen Prairie/Orne, Caen Colline aux Oiseaux, Clécy/Suisse normande, Fontainebleau, Meudon, Lille Citadelle, Paris 19 canal/Buttes-Chaumont et Nanterre grands axes.

## Seuils contrôlés

Chaque cas fixe une adresse, un profil, une distance cible, un D+ cible, `scenicMode: true`, des seuils qualité et des warnings bloquants.

Le runner échoue avec exit code non-zéro si un cas viole un de ces contrôles : distance adherence, D+ tolerance, production score, loop gap/closure, busy-road ratio, natural/trail ratio, paved ratio quand disponible, trail beauty, longest trail segment, natural corridor ratio, repeatEdgeRatio, uTurnRatio, terrainDataConfidence, trailPotential ou durationMs.

Les warnings suivants sont bloquants sur les 12 cas : `ONEWAY_VIOLATION`, `U_TURN_DETECTED`, `TOO_MUCH_BACKTRACKING`. Une route HTTP 200 avec U-turn, backtracking ou overlap objectif est donc un échec produit.

## Artifacts et métriques

Le rapport agrégé est écrit par défaut dans :

```text
artifacts/route-benchmark-results/latest.json
```

Ce dossier est ignoré par git via `/artifacts/`. Utilise `--no-output` pour ne rien écrire, ou `--output <path>` pour choisir un fichier.

Avec `--save-artifacts`, le runner sauvegarde aussi le payload `route` complet de chaque succès, un GeoJSON exploitable pour inspection carto, et un artifact diagnostic edge-level par candidat :

```text
artifacts/route-benchmark-results/routes/<benchmark-id>.json
artifacts/route-benchmark-results/routes/<benchmark-id>.geojson
artifacts/route-benchmark-results/routes/<benchmark-id>.edges.json
```

Le `.json` conserve tous les candidats et métriques moteur. Le `.geojson` contient la meilleure route sous forme de `FeatureCollection` LineString avec les métriques clés en propriétés (`distanceKm`, `ascendM`, `productionScore`, `repeatEdgeRatio`, `uTurnRatio`, ratios route/nature). Le `.edges.json` contient les métadonnées du benchmark, le résumé `routeIntent`, puis `candidates[]` avec `summary`/`edgeSummary` et les segments bruts (`edgeId`, `osmWayId`, `highway`, `surface`, `lengthKm`, `score`, flags trail/natural/paved/busy/scenic/restricted/oneway, `repeatCount`). Cet artifact est observation-only : il n'abaisse aucun seuil et ne change pas le résultat pass/fail du benchmark. Le runner ne masque pas les erreurs réseau/API : les échecs HTTP, Overpass, 429/504 ou serveur local absent sortent dans le rapport avec `errorCode`, `status` et `durationMs`.

## Interprétation

Un benchmark vert veut dire : route générée, boucle suffisamment fermée, distance/D+ acceptables, pas de grand axe excessif, pas de backtracking/U-turn bloquant, et potentiel terrain cohérent avec le cas. Ce n'est pas une preuve que la route est belle, mais c'est le minimum pour éviter les régressions évidentes.

Un benchmark rouge doit être lu par `failures[]`. Pour la mission nocturne de fiabilité, prioriser dans cet ordre : `network_error/http_error`, `loop_closure`, `repeat_edge_ratio`/`u_turn_ratio`, `natural_way_ratio`/`trail_potential`, puis `distance_tolerance`/`elevation_tolerance`. Ne pas corriger en élargissant naïvement le rayon Overpass, surtout sur Paris et zones denses.
