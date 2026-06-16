# VERIFY — Vérification post-patch

## Objectif
Confirmer qu'un patch respecte les baselines et n'introduit aucune régression.

## Commandes obligatoires
```bash
npm run tf:verify
```

Cette commande enchaîne :
1. `git status --short --branch` (working tree propre ou fichiers attendus uniquement)
2. `git diff --name-only` (uniquement fichiers autorisés)
3. `git stash list` (stash@{0} intact)
4. `npx tsc --noEmit` (exit 0)
5. `npm run lint` (exit 0)
6. `npm run test:run` (profil attendu : 17 failed / 434 passed / 6 todo)
7. `npm run benchmark:engine-v3 -- --case fontainebleau-croix-augas-trail-12k ...`
8. `npm run benchmark:engine-v3 -- --case tourville-trail-8k ...`
9. Extraction métriques + comparaison aux baselines

## Seuils bloquants

### Fontainebleau
- `outcome == "adjusted"`
- `naturalDwellKm >= 11.0`
- `trailRatio >= 0.95`
- `repeatBudgetExceeded == false`

### Tourville
- `outcome == "refused"`
- `distanceProducedKm > 0`
- `targetRepeatKm > 3.0`
- `repeatBudgetExceeded == true`
- `rejectedBecauseTargetRepeat == false`

### Tests
- `failed` doit rester 17 (baseline)
- `passed` doit rester 434 (baseline)
- `todo` doit rester 6 (baseline)

## Sortie attendue
- Rapport PASS/FAIL par gate
- Décision : COMMIT-READY ou HOLD

## Si FAIL
- Identifier quel gate bloque
- STOP immédiatement
- Ne pas tenter de "réparer à la volée"
- Proposer HOLD avec diagnostic explicite
