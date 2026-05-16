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

Mise à jour: 2026-05-16T20:05:49Z.

`stop-broadening`, pas bêta. La preuve QA disponible dans `/tmp/trailforge-v3-p1-qa/fontainebleau.json` est nette: Fontainebleau 12k sort encore en `refused` avec une micro-route de `0.842km`, `pavedRatio 0.837`, `naturalDwell 0.137km`, `trailRatio 0`, `longestTrailSegment 0km`. Ce n’est pas un panel rouge “normal”; c’est le cas cœur du moteur qui échoue: forêt censée être facile, mais l’assembleur retourne une boucle quasi urbaine/pavée et trop courte.

Le repo est observé en dirty state code préexistant sur `lib/engine-v3/assemblers/graph-route-assembly-core.ts`, `lib/engine-v3/route-generator.ts`, `lib/engine-v3/types.ts`, `tests/engine-v3-graph-assembler.test.ts`, avec `main...origin/main [ahead 14]`. Ces diffs ne doivent pas être traités comme produit validé tant que Fontainebleau reste à ~0.842km / 0.137km naturel. La donnée importante reste identique: le graphe contient de la capacité naturelle, mais la sélection/expansion/candidate pool de l’assembleur ne l’exploite pas.

Décision CTO: arrêt total de l’élargissement. Pas de panel élargi, pas de comparaison V2.5/V3, pas de release check, pas de cherry-pick d’outils périphériques. Le seul chantier autorisé est l’assembleur Fontainebleau.

## Prochaine mission unique autorisée

Dev Loop doit faire une seule mission: corriger l’assembleur Fontainebleau. Point de départ obligatoire: artifact `/tmp/trailforge-v3-p1-qa/routes/fontainebleau-trail-12k.json` et/ou artifact frais équivalent. Objectif: expliquer puis corriger pourquoi une cible naturelle proche/abondante est ignorée et pourquoi la route finale plafonne à `0.842km` avec `naturalDwell=0.137km`.

Validation minimale: test synthétique RED/GREEN qui reproduit “capacité naturelle reachable mais sélection micro-route pavée”, `npm run test:run -- tests/engine-v3-graph-assembler.test.ts`, puis benchmark Fontainebleau 12k frais. Critère de réussite: produire une route/refus honnête qui explore réellement plusieurs kilomètres de naturel connecté, ou diagnostiquer explicitement l’impossibilité graphe. Si le benchmark reste à ~0.842km / 0.137km naturel, le run est `non mergeable` hors observabilité pure.

## Critères de stop immédiat

Stop si le run invente une route sans géométrie GPS, si un `generated` sort sous la distance cible, si Fontainebleau reste micro-route pavée/refusée, si les artifacts n’incluent pas request/snapshot/intent/mission/edges/metrics/outcome, si RAM disponible passe sous 1,2 Go, ou si le correctif dérive vers panel/comparison/release au lieu de l’assembleur.

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
