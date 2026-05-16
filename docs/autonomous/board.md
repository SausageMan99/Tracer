# TrailForge V3 — Autonomous Dev Board

Dernière mise à jour manuelle: 2026-05-16

## Objectif actuel

Amener le moteur V3 à un état bêta interne honnête: génération/refus explicables, métriques terrain fiables, export GPX/GeoJSON cohérent, et gates qui échouent plutôt que de maquiller une route faible.

## Règles non négociables

- Une mission bornée par run autonome.
- Ne pas pousser sur `main` si les gates ciblées sont rouges.
- Ne pas relaxer les seuils, surfaces ou refus pour faire passer un benchmark.
- Garder `trailRatio`, `naturalWayRatio` et `pavedRatio` honnêtes et séparés.
- Préférer un refus typé à une route manifestement mauvaise.
- Ne pas lancer build/benchmarks si RAM disponible < 1,2 Go, charge > 1,5, lock actif, ou process Node/benchmark déjà en cours.
- Libérer `/tmp/trailforge-autonomous.lock` avant la fin de chaque run si le garde l’a acquis.

## Verdict CTO actuel

Mise à jour: 2026-05-16T19:53:33Z.

`narrowed-go`, pas bêta. Le dernier Dev Loop a ajouté un diagnostic et des tests autour de la progression naturelle, mais le résultat réel Fontainebleau ne bouge pas: le benchmark frais `NODE_OPTIONS=--max-old-space-size=1536 npm run benchmark:engine-v3 -- --case fontainebleau-trail-12k` refuse encore avec `distanceProduced 0.842km`, `pavedRatio 0.837`, `naturalDwell 0.137km`, `longestTrailSegment 0km`. L’artifact frais `/root/work/Tracer/artifacts/engine-v3-benchmarks/latest-routes/fontainebleau-trail-12k.json` ajoute une preuve utile: `assemblyDiagnostics.distanceToFirstNonPavedTargetKm=0.068`, `reachableNonPavedTargetEdgeCount=7044`, `reachableNonPavedTargetKm=220.527`. Donc le graphe contient beaucoup de cible non pavée reachable, mais l’assembleur n’arrive toujours pas à l’exploiter en corridor runner.

État repo observé: `main...origin/main [ahead 13]`, dirty state code préexistant sur `lib/engine-v3/assemblers/graph-route-assembly-core.ts`, `lib/engine-v3/route-generator.ts`, `lib/engine-v3/types.ts`, `tests/engine-v3-graph-assembler.test.ts`. Le test ciblé passe (`6 tests`). Décision CTO: ne pas committer ce code comme progrès produit tant que Fontainebleau reste identique; au mieux c’est une tranche diagnostic partielle. Le vrai blocker est maintenant clair: l’assembleur sélectionne une micro-route pavée malgré une capacité naturelle reachable massive.

## Prochaine mission unique autorisée

Dev Loop doit faire une seule mission: RCA ciblée de l’assembleur Fontainebleau à partir de l’artifact frais. Objectif: expliquer pourquoi, malgré `reachableNonPavedTargetKm=220.527`, la route choisie reste à `naturalDwell=0.137km`. Ajouter un test synthétique qui reproduit exactement ce cas: cible naturelle reachable proche et abondante, mais sélection finale qui préfère une micro-route pavée/refusée. Ensuite corriger uniquement la sélection/expansion/candidate pool pour produire plusieurs kilomètres naturels quand ils sont réellement connectés. Validation minimale: test RED/GREEN, `npm run test:run -- tests/engine-v3-graph-assembler.test.ts`, puis benchmark Fontainebleau 12k frais. Si le benchmark reste à ~0.842 km / 0.137 km naturel, le run doit marquer `non mergeable` sauf si le changement est explicitement limité à l’observabilité.

## Critères de stop immédiat

Stop si le run invente une route sans géométrie GPS, si un `generated` sort sous la distance cible, si les artifacts n’incluent pas request/snapshot/intent/mission/edges/metrics/outcome, si RAM disponible passe sous 1,2 Go, ou si le correctif nécessite une refonte d’assembleur au lieu d’un câblage de harness.

## Missions interdites sans décision CTO explicite

- Refonte large du moteur.
- Migration de gros fichiers sans benchmark avant/après.
- Changements UI ou branding non liés à la readiness V3.
- Création de nouveaux cron jobs.
- Exécution parallèle de plusieurs agents lourds.

## Contrat des rôles

Dev Loop: corriger ou implémenter un seul bloc ciblé, avec tests ciblés et rapport mergeable/non mergeable.

QA Watchdog: exécuter des gates/benchmarks, produire preuves et verdict; ne pas corriger sauf micro-ajustement d’observabilité évident.

CTO Review: lire les derniers résultats, décider stop/go et mettre à jour ce board si nécessaire.

Product Vision: vérifier que les décisions techniques servent une promesse terrain honnête; challenger les métriques trompeuses.

## Format de rapport attendu

Contexte court. Action réalisée. Validation exacte. Limites. Verdict: mergeable / non mergeable / skipped. Prochaine action unique.
