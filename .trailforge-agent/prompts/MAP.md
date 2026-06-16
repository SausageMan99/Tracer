# MAP — Lecture seule

## Objectif
Cartographier les chemins de code réels pour un ticket donné, SANS modifier aucun fichier.

## Étapes
1. Vérifier `git status --short --branch` et `git log --oneline -10`
2. Vérifier `git stash list` (wip stash doit être intact)
3. Lire les fichiers concernés en `read_file` (jamais `patch`/`write_file`)
4. Tracer le call graph : imports, exports, callers, callees
5. Identifier les invariants à préserver (métriques baselines dans `baselines.json`)
6. Identifier les points de divergence entre paths (ex. `assembleMissionV3` vs `assembleGraphRouteV3`)
7. Lister les fichiers qui seraient touchés en PATCH (estimation)
8. Lister les fichiers interdits (`lib/engine-v3/**` sauf autorisation humaine)

## Sortie attendue
- Call graph réel (imports → exports → callees)
- Liste invariants préservés
- Estimation périmètre PATCH
- Risques identifiés
- Recommandation : PATCH ou HOLD

## Interdit
- Aucun patch
- Aucun commit
- Aucun stash pop
- Aucun benchmark (sauf si explicitement demandé pour confirmer une lecture)

## Validation
Aucun fichier modifié. `git diff --name-only` doit rester vide.
