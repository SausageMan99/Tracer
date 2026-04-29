# GPX et envoi vers montre

Cet incrément rend l'export TrailForge plus crédible pour un runner/cycliste qui veut réellement utiliser le parcours.

## Ce qui change

Le GPX généré est maintenant brandé `TrailForge` et garde des métadonnées qualité dans une extension XML `trailforge:*` : score production, fermeture de boucle, ratio grands axes, ratio nature et warnings moteur.

Ces extensions ne doivent pas casser Garmin, Wahoo, Suunto, COROS ou Strava : elles sont placées dans `<metadata><extensions>` avec un namespace dédié. Les apps qui ne connaissent pas TrailForge les ignorent, les outils internes pourront les lire plus tard.

## Interface

Après le bouton `Télécharger GPX`, l'utilisateur voit un mini-guide “Envoyer sur montre”. L'ordre des cibles dépend du sport :

- running : Garmin, COROS, Suunto, Strava ;
- vélo route/gravel/VTT : Garmin, Wahoo, Strava, Suunto.

L'objectif n'est pas d'intégrer toutes les APIs maintenant. Le vrai premier gain produit est de supprimer le flou après téléchargement : l'utilisateur sait quoi faire avec son GPX.

## Règle produit

L'export n'est pas une feature secondaire. Si TrailForge promet une route outdoor, le dernier mètre UX est que le parcours arrive facilement sur montre ou compteur.
