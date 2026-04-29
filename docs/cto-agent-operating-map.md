# TrailForge CTO Agent Operating Map

> Objectif : structurer TrailForge comme une petite équipe produit/tech capable d'améliorer la qualité réelle des parcours, pas seulement l'interface.

## Organisation agents

### CTO / Product Owner
Responsabilité : arbitrer la roadmap avec un principe fixe : fiabilité moteur V2 avant nouveauté.

Décisions actuelles :
- Ne pas toucher au solver tant que la qualité perçue et les signaux utilisateurs ne sont pas mesurés.
- Prioriser running/trail comme niche d'entrée, vélo ensuite.
- Transformer chaque génération en donnée produit exploitable.

### Lead Dev
Responsabilité : architecture, découpage des incréments, dette technique.

Backlog priorisé :
1. Feedback structuré avec raisons whitelistées.
2. Explication visible des compromis qualité du parcours.
3. Benchmark production par villes/terrains.
4. Export GPX enrichi et workflow montre/Strava/Garmin.
5. Profils “routes avec intention” : récup, long run, sortie nature, seuil.

### Développeur senior moteur
Responsabilité : Graph Builder, Edge Scorer, Orienteering Solver, Post-processor.

Priorités :
- Maintenir les boucles fermées.
- Éviter les grands axes et accès restreints.
- Mesurer distance, D+, naturalité, répétition, densité intersections.
- Ne jamais fallback silencieusement de V2 vers Legacy.

### QA Lead
Responsabilité : tests de non-régression produit.

Gates obligatoires :
- `npm run test:run`
- `npm run lint`
- `npm run build`
- `npm run benchmark:routes` quand des clés API et réseau sont disponibles.

### Expert cyber / privacy
Responsabilité : minimiser PII et surface d'attaque.

Contraintes :
- Feedback par codes d'énumération, pas de texte libre brut.
- Hash IP avec `PRIVACY_HASH_SALT` fort en prod.
- Admin export via `Authorization: Bearer`, query param à supprimer plus tard.
- Rate limiting distribué avant scale-out.

### Growth / User research
Responsabilité : recruter des testeurs durs, pas des compliments.

Cibles :
- Runners et trailers locaux.
- Reddit running/trail.
- Clubs et Strava users.
- 30 à 50 testeurs, 3 routes chacun.

## Incrément livré en premier

Le premier incrément est volontairement conservateur : feedback structuré + quality insights visibles.

Pourquoi :
- Aucun risque sur le moteur V2.
- Augmente la confiance en expliquant les compromis.
- Crée un dataset exploitable pour améliorer les poids et heuristiques.
- Permet de savoir si une route mauvaise est mauvaise pour distance, nature, sécurité, difficulté ou boucle.

## Définition de “route de qualité”

Une route n'est pas seulement générée. Elle doit être évaluée sur :
- écart distance cible ;
- écart D+ cible ;
- fermeture de boucle ;
- part de grands axes ;
- part de chemins/nature ;
- accès restreints ;
- sens interdits vélo ;
- répétitions / allers-retours ;
- densité intersections ;
- score production global.

## Règle CTO

Si une génération réussit mais produit une route peu fiable, l'interface doit le dire. La confiance utilisateur vaut plus qu'un faux succès.
