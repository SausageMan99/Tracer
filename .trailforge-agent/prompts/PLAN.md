# PLAN — Plan de patch détaillé

## Objectif
Écrire un plan minimal, défendable, qui ne sera exécuté qu'après validation humaine.

## Étapes
1. Partir du MAP (call graph + invariants + fichiers candidats)
2. Définir le périmètre strict : fichiers autorisés, lignes touchées, forme des changements
3. Définir les critères d'acceptation :
   - `tsc --noEmit` exit 0
   - `lint` exit 0
   - `npm run test:run` profil inchangé ou mieux
   - benchmarks Fontainebleau/Tourville byte-identical ou mieux
4. Définir les gates bloquants :
   - Fontainebleau `naturalDwellKm >= 11`, `trailRatio >= 0.95`, `outcome == "adjusted"`
   - Tourville `outcome == "refused"`, `targetRepeatKm ≈ 3.266`, `repeatBudgetExceeded == true`, `rejectedBecauseTargetRepeat == false`
5. Lister les risques résiduels et leur mitigation
6. Décider si le patch nécessite approbation humaine (`HUMAN_REQUIRED`)

## Sortie attendue
- Périmètre strict (fichiers + lignes)
- Critères d'acceptation mesurables
- Gates bloquants
- Niveau de risque
- Décision : PATCH ou HOLD

## Interdit
- Aucun patch dans cette phase
- Aucune modification de baseline
- Aucun changement de policy ou queue

## Validation
Le PLAN doit survivre à une revue hostile. S'il ne tient pas face à un challenger, il n'est pas prêt.
