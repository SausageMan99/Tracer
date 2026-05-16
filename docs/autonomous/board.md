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

Mise à jour: 2026-05-16T19:36:15Z.

`narrowed-go`, pas bêta: la direction technique est meilleure qu’une micro-route pavée, mais elle ne sert pas encore un runner. Les artifacts P1 inspectés (`/tmp/trailforge-v3-p1-qa/fontainebleau.json` et `routes/fontainebleau-trail-12k.json`, générés à 19:05Z) confirment le même état que P0: `fontainebleau-trail-12k` atteint seulement `distanceProducedKm=0.842`, `naturalWayRatio=0.163`, `nonPavedKm=0.137`, `naturalDwellKm=0.137`, `pavedRatio=0.837`, `longestTrailSegmentKm=0`. Le JSON de route montre surtout des petites arêtes pavées autour du départ, puis un aller-retour très court sur quelques footways `mixed`; ce n’est pas un corridor forestier exploitable. Conclusion produit: le problème n’est plus “entrer dans du non-pavé”, c’est “rester et progresser sur du non-pavé utile pendant des kilomètres”.

Aucun panel réduit Tourville/Fontainebleau/Caen frais n’a été trouvé sous `/tmp/trailforge-v3-p1-qa/`; les seuls artifacts P1 disponibles couvrent Fontainebleau. Les anciens artifacts `/tmp/trailforge-v3-benchmark/latest.json` restent rouges sur Tourville et Fontainebleau, donc ne pas extrapoler une cohérence multi-zone. Les refus sont honnêtes côté métriques, mais encore trop internes côté produit: “assembled route is too short” devrait devenir une explication utilisateur du type “je n’ai pas trouvé assez de chemins naturels continus depuis ce départ pour promettre 12 km trail”.

État repo observé pendant le run Product Vision: `main...origin/main [ahead 12]`, dirty state code préexistant sur assembleur + route-generator/types + test. Pas de commit code côté Product Vision; board mis à jour uniquement pour bloquer l’optimisation de métrique locale et recentrer sur l’expérience runner.

## Prochaine mission unique autorisée

Dev Loop doit exécuter une seule mission: transformer le progrès Fontainebleau de “premier contact non pavé” en “corridor naturel soutenu”. Scope strict: écrire d’abord un test synthétique où l’assembleur atteint une branche naturelle proche mais doit continuer sur plusieurs arêtes non pavées contiguës au lieu de revenir vite sur des rues pavées; le critère attendu doit porter sur `naturalDwellKm`, `naturalWayRatio` et une distance produite significative, pas seulement sur `enteredTarget`. Ensuite ajuster uniquement candidate selection / scoring / expansion pour maintenir la progression non pavée quand elle est disponible. Validation minimale: test ciblé RED/GREEN, `npm run test:run -- tests/engine-v3-graph-assembler.test.ts`, puis `NODE_OPTIONS=--max-old-space-size=1536 npm run benchmark:engine-v3 -- --case fontainebleau-trail-12k` avec artifact. Ne pas toucher aux seuils d’outcome, ne pas reclassifier les surfaces, ne pas compter 137 m de naturel comme une victoire produit.

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
