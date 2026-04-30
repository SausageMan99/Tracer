# Feedback terrain — Tourville-sur-Odon

## Contexte

Départ testé par Clément : `7 Rue des Pommiers, 14210 Tourville-sur-Odon`.

Zone connue personnellement, donc le retour est plus fiable qu'un avis générique sur une carte inconnue.

## Ce qui progresse

La génération est meilleure qu'avant : la boucle passe enfin par une petite partie du bois des Amis de Jean Bosco. C'est un signal positif : le scoring trail/nature commence à capter des opportunités locales.

## Problèmes observés

1. La boucle contient encore un demi-tour. Pour un utilisateur trail, c'est une faute produit forte : une boucle ne doit pas ressembler à un aller-retour bricolé.
2. Le tracé ne va pas assez chercher les petits chemins dans le bois des Amis de Jean Bosco.
3. La route aurait pu pousser vers le bois de Baron au lieu de prendre trop de route au début.
4. Le traçage visuel manque de précision : deux lignes se chevauchent, ce qui donne une impression de trace sale ou de segment répété.

## Décision produit

Ce cas devient un benchmark Phase 1 : `tourville-pommiers-trail-12k`.

Le benchmark doit échouer si :

- le ratio de demi-tour est supérieur à 1 % ;
- le ratio d'arêtes répétées dépasse 4 % ;
- le parcours manque de continuité naturelle ;
- la route contient trop de bitume ou pas assez de chemin trail.

## Implication moteur

Le prochain travail moteur ne doit pas seulement améliorer le score moyen. Il doit empêcher explicitement les traces qui reviennent sur elles-mêmes et favoriser les corridors naturels continus quand ils existent autour du départ.

## Remote OSM audit interpretation

Remote audit shows the area is not empty in OSM: there are many `path`, `track`, and `footway` ways near the start. The weak point is tag quality, especially missing `surface` values. TrailForge should not automatically treat missing surface as low trail quality when the edge is path-like and near scenic/natural context.
