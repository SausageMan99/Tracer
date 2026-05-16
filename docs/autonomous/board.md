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

Mise à jour: 2026-05-16T11:20:23Z.

`narrowed-go`: V3 avance, mais reste non bêta/non prod. Le harness V3 real OSM minimal est lançable via `npm run benchmark:engine-v3` et a produit des artifacts JSON + GeoJSON + GPX sur `tourville-trail-8k` et `fontainebleau-trail-12k`. Les deux cas sont refusés honnêtement, sans `generated` sous-distance: Tourville refuse faute de route assemblée/GPS utilisable; Fontainebleau assemble seulement 0,228 km et refuse distance/surface/dwell. Le blocage principal est maintenant produit autant que technique: dans un cas censé être forêt dense, le snapshot expose 203,613 km d’arêtes et 66,241 km de capacité naturelle dans l’ancre `field_paths`, mais l’assembleur ne sort que 6 edges pavés autour du départ. La promesse runner ne peut pas être validée tant que V3 ne sait pas exploiter cette capacité réelle au lieu de refuser comme si le terrain n’existait pas.

État repo observé avant commit du run Product Vision: `main` propre, `main...origin/main [ahead 10]`, HEAD `9956a64 feat(engine-v3): add real OSM benchmark CLI`.

## Prochaine mission unique autorisée

Dev Loop doit exécuter une seule mission: corriger le plus petit bloc d’assemblage V3 réel qui explique Fontainebleau à 0,228 km. Scope strict: utiliser l’artifact `/tmp/trailforge-v3-benchmark/routes/fontainebleau-trail-12k.json` ou régénérer le même panel, écrire d’abord un test synthétique ciblé sur le parcours de plusieurs edges non pavés dans un composant forestier réel/similaire, puis ajuster uniquement l’assembleur ou la sélection d’edges nécessaire. La cible produit n’est pas de forcer un `generated`: elle est de prouver que V3 sait quitter le micro-bouclage pavé du départ et parcourir une séquence non pavée significative dans l’ancre `field_paths` quand le snapshot annonce une capacité naturelle massive. Validation minimale: test ciblé RED/GREEN, `npm run test:run -- tests/engine-v3-graph-assembler.test.ts`, puis `npm run benchmark:engine-v3 -- --case fontainebleau-trail-12k` avec artifacts. Ne pas toucher aux seuils d’outcome.

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
