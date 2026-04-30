# Feedback terrain — Tourville-sur-Odon

## Contexte

Départ testé par Clément : `7 Rue des Pommiers, 14210 Tourville-sur-Odon`.

Zone connue personnellement, donc le retour est plus fiable qu'un avis générique sur une carte inconnue.

## Ce qui progresse

La génération est meilleure qu'avant : la boucle passe enfin par une petite partie du bois des Amis de Jean Bosco. C'est un signal positif : le scoring trail/nature commence à capter des opportunités locales.

Après correction du graphe Overpass, la génération fonctionne de nouveau à Tourville-sur-Odon sur plusieurs distances. Le niveau de superposition est inférieur aux versions précédentes, mais il reste visible sur certains tracés.

## Problèmes observés

1. La boucle contient encore parfois un demi-tour ou un retour sur le même chemin. Pour un utilisateur trail, c'est une faute produit forte : une boucle ne doit pas ressembler à un aller-retour bricolé.
2. Le tracé ne va pas encore assez chercher les petits chemins dans le bois des Amis de Jean Bosco.
3. La route aurait pu pousser vers le bois de Baron au lieu de prendre trop de route au début.
4. Le traçage visuel manque parfois de précision : deux lignes se chevauchent, ce qui donne une impression de trace sale ou de segment répété.
5. Certaines sections semblent visuellement ne pas suivre exactement le chemin affiché sur la carte. Ce signal doit être traité comme un problème de confiance, même si la géométrie vient bien des nodes OSM.

## Décision produit

Ce cas reste un benchmark Phase 1 : `tourville-pommiers-trail-12k`.

Le benchmark doit échouer si :

- le ratio de demi-tour est supérieur à 1 % ;
- le ratio d'arêtes répétées dépasse 4 % ;
- le parcours manque de continuité naturelle ;
- la route contient trop de bitume ou pas assez de chemin trail.

## Implication moteur

Le travail moteur ne doit pas seulement améliorer le score moyen. Il doit empêcher explicitement les traces qui reviennent sur elles-mêmes et favoriser les corridors naturels continus quand ils existent autour du départ.

Le ranking final doit préférer une boucle un peu moins parfaite en D+ mais propre, naturelle et sans overlap plutôt qu'une boucle mathématiquement proche de la demande mais sale visuellement.

## Remote OSM audit interpretation

Remote audit shows the area is not empty in OSM: there are many `path`, `track`, and `footway` ways near the start. The weak point is tag quality, especially missing `surface` values. TrailForge should not automatically treat missing surface as low trail quality when the edge is path-like and near scenic/natural context.
