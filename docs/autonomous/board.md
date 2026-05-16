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

Mise à jour: 2026-05-16T07:50:52Z.

`narrowed-go`: V3 avance, mais reste non bêta/non prod. Le dernier commit refuse correctement une route sans géométrie GPS utilisable et le test ciblé `tests/engine-v3-graph-assembler.test.ts` passe. Le vrai blocage n’est plus ce garde synthétique: c’est l’absence de preuve live V3 real OSM/Overpass et de comparaison V3 vs V2.5 sur artifacts exploitables.

État repo observé: `main` propre, `main...origin/main [ahead 8]`, HEAD `8e9ef74 fix(engine-v3): refuse routes without gps geometry`.

## Prochaine mission unique autorisée

Dev Loop doit exécuter une seule mission: rendre lançable et documenté un harness V3 real OSM minimal, sans toucher aux seuils moteur. Scope strict: prendre le runner existant `lib/engine-v3/benchmark-runner.ts`, ajouter/brancher seulement le plus petit script nécessaire si aucun script CLI n’existe, puis produire un artifact sur un panel RAM-safe de 2 cas maximum: `tourville-trail-8k` et `fontainebleau-trail-12k`. Validation minimale: `npm run test:run -- tests/engine-v3-graph-assembler.test.ts`, puis un run avec `NODE_OPTIONS=--max-old-space-size=1536` qui écrit JSON + GeoJSON + GPX ou classe honnêtement `errored/refused`.

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
