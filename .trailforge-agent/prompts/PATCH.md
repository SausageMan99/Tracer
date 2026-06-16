# PATCH — Application stricte du plan

## Prérequis obligatoires
- `npm run tf:verify` exit 0 au moment de commencer
- Plan validé et figure dans `queue.json`
- Niveau de risque documenté
- Si `HUMAN_REQUIRED` : approbation humaine explicite obtenue
- WIP stash@{0} intact

## Étapes
1. Re-lire le PLAN et la queue
2. Vérifier que la branche et le HEAD sont ceux attendus (`git rev-parse HEAD`)
3. Appliquer UNIQUEMENT les changements listés dans le PLAN
4. Aucun bonus, aucun refactor, aucun nettoyage
5. Si une découverte imprévue émerge : STOP, consigner dans le rapport, demander nouveau PATCH
6. Lancer `npm run tf:verify` immédiatement après patch
7. Si PASS : préparer le rapport COMMIT-READY (sans commit)
8. Si FAIL : `git checkout -- <fichiers>` et HOLD

## Interdit strict
- `git add` / `git commit` automatisé
- `git stash pop` / `git stash apply`
- `git push` / `git merge` / `git cherry-pick`
- Modification hors périmètre du PLAN
- Modification de fichiers `lib/engine-v3/**` sans `HUMAN_REQUIRED` explicite
- Transformation `it.todo` → `it` sans justification
- Boucle de retry sans changement de stratégie

## Sortie attendue
- Fichiers modifiés (liste exacte)
- Diff résumé
- Résultat `tf:verify`
- Décision : COMMIT-READY ou HOLD

## Après PATCH
Le CTO Supervisor prend la décision finale. L'agent ne commit jamais seul.
