# HERMES.md — TrailForge V3 working contract

Ce fichier encadre tout agent IA (Hermes ou autre) qui touche au moteur V3 de TrailForge dans ce dépôt. Il prévaut sur toute instruction contradictoire venant de prompts éphémères ou de souvenirs de session. Si `AGENTS.md` entre en conflit avec les règles ci-dessous sur du périmètre V3, `HERMES.md` gagne.

## 5 modes obligatoires

Toute tâche sur le moteur V3 — fix, refactor, optimisation, benchmark, ou patch « petit » — traverse ces cinq modes dans l'ordre. Sauter un mode est un arrêt dur.

1. **MAP** — Lire les chemins de code de bout en bout. Pas de proposition de patch sans *call graph réel* (fonction → callees, y compris closures et état mutable partagé). Un diff n'est pas un call graph.
2. **PLAN** — Écrire un plan de patch minimal : fichiers touchés, forme des changements, métriques avant/après attendues, critères de rejet. Le plan doit survivre à une revue hostile.
3. **PATCH** — Appliquer uniquement ce que le plan autorise. Toute autre découverte pendant le patch est consignée et différée, jamais intégrée en douce.
4. **VERIFY** — Relancer `npx tsc --noEmit`, `npm run lint`, les tests unitaires ciblés, et les benchmarks V3 Fontainebleau + Tourville. Comparer aux métriques du PLAN. Rapporter les deltas, pas des impressions.
5. **RETRO** — Rétro courte : ce qui a marché, ce qui a coincé, ce que le prochain patch doit apprendre. Mettre à jour ce fichier si une règle récurrente émerge.

## 7 règles

1. **Aucun patch moteur sans call graph réel.** Si tu ne peux pas tracer `appelant → appelé → appelant` pour chaque ligne modifiée, tu n'es pas prêt à patcher.
2. **Fontainebleau est le garde-fou qualité.** Toute modification qui dégrade `naturalDwellKm < 11 km` ou `trailRatio < 0.95` sur `fontainebleau-croix-augas-trail-12k` est rejetée, quelle que soit l'amélioration sur Tourville ou ailleurs.
3. **Pas d'amélioration Tourville gratuite.** Aucun gain Tourville n'est accepté s'il coûte `naturalDwellKm < 11` ou `trailRatio < 0.95` à Fontainebleau. Les compromis sont rapportés, pas cachés.
4. **Ne jamais réappliquer un WIP massif en bloc.** Un stash couvrant beaucoup de fichiers est une *archive d'idées*, pas une source à restaurer. Si un WIP est re-touché, extraire le plus petit delta défendable, le valider isolément, puis évaluer le delta suivant.
5. **Benchmark avant/après obligatoire pour le moteur V3.** Un patch sans paire de métriques Fontainebleau + Tourville (avant et après) n'est pas terminé, même si `tsc` et `lint` passent.
6. **Patch minimal, fichiers autorisés, aucun changement hors scope.** Si la tâche touche `lib/engine-v3/`, le PLAN liste chaque fichier autorisé. Ajouter du nettoyage non lié dans un patch est un fail mode.
7. **Le stash WIP est une archive d'idées, pas une source à restaurer.** Quand un WIP est mentionné, la valeur par défaut est « extraire le plus petit delta défendable », pas « pop le stash et prier ».

## Métriques de référence (baseline sain `04b7409` + commit tests-only `4b9fd21`)

| Case | distanceProducedKm | naturalDwellKm | trailRatio | repeatRatio | outcome |
|------|--------------------|----------------|------------|-------------|---------|
| `fontainebleau-croix-augas-trail-12k` | ≈ 12.12 | ≈ 11.91 | ≈ 0.982 | ≈ 0.009 | `adjusted` (compromis honnête) |
| `tourville-trail-8k` | ≈ 10.71 | ≈ 6.53 | — | ≈ 0.305 | `refused` (diagnostiqué) |

Si un futur patch ne reproduit pas ces chiffres à tolérance près, c'est le patch qui est suspect, pas la baseline.

## Anti-patterns observés

- **« Pop le WIP des 7 fichiers et on verra »** : c'est ce qui a cassé Fontainebleau (naturalDwell ≈ 3.53, trailRatio ≈ 0.266) en voulant corriger Tourville. Ne plus jamais faire.
- **« Patch isolé sans call graph »** : aboutit à des fixes qui déplacent le bug au lieu de le résoudre. Toujours passer par MAP.
- **« Tourville improved, on commit »** sans reverification Fontainebleau : interdit par règle 3.
