# Natural corridor scoring — Phase 1 TrailForge

## Objectif produit

TrailForge ne doit pas seulement attraper un petit segment vert sur la carte. Pour devenir un produit adoré par des traileurs exigeants, le moteur doit préférer les lignes naturelles continues : bois, chemins, tracks, sols non bitumés, enchaînés sur plusieurs kilomètres.

Un fragment isolé de chemin au milieu d'une boucle routière ne doit pas battre un vrai corridor naturel, même si son score brut local est meilleur.

## Changement moteur

Le solver garde maintenant un état de continuité naturelle pendant l'expansion du beam search :

- `naturalDistanceKm` : distance totale passée sur chemin/surface naturelle.
- `naturalStreakKm` : longueur du corridor naturel en cours.
- `longestNaturalStreakKm` : plus long corridor continu trouvé dans la boucle.
- `naturalSegmentCount` : nombre de segments naturels séparés.
- `wasOnNaturalCorridor` : indique si l'arête précédente appartenait au corridor.

Il construit aussi des ancres naturelles avant la recherche : les grands composants connectés de chemins/surfaces naturelles. Ces ancres représentent les vrais massifs exploitables autour du départ. Tant que la trace n'a pas encore trouvé de corridor significatif, le solver accorde un bonus aux routes d'accès qui se rapprochent de ces grands composants.

## Règles appliquées

Une arête est considérée comme naturelle si elle est :

- explicitement marquée `scenic` par le graph builder parce qu'elle appartient à, traverse, ou passe juste à côté d'une zone OSM boisée/naturelle ;
- un type OSM `path`, `track`, `footway`, `bridleway`, ou
- une surface `dirt`, `earth`, `grass`, `ground`, `unpaved`, `compacted`, `fine_gravel`, `gravel`, `sand`.

Le solver applique ensuite :

- un bonus de base pour les arêtes naturelles ;
- un bonus progressif quand l'arête prolonge un corridor existant ;
- un plafond pour éviter que le bonus écrase tout le reste ;
- une petite pénalité lorsqu'un court fragment naturel renvoie immédiatement vers la route ;
- un score final de chemin qui valorise le ratio naturel et surtout le plus long corridor continu ;
- une pénalité de fragmentation quand plusieurs petits segments naturels séparés remplacent un vrai corridor ;
- une attraction précoce vers les grands composants naturels, même si la première arête d'accès est une petite route ;
- un bonus d'entrée quand une arête amène réellement la route dans un composant naturel identifié ;
- un seuil d'ancre moins naïf pour ne pas ignorer les bois moyens sur une sortie 10–12 km ;
- une pénalité finale forte pour les boucles longues quasi entièrement routières quand une alternative naturelle existe ;
- un bonus final pour les boucles qui visitent réellement un long massif continu.

## Garde-fou test

Le test `tests/orienteering-solver.test.ts` couvre quatre cas :

1. une boucle à score brut supérieur avec un seul fragment trail puis route doit perdre contre une boucle à score brut inférieur mais composée d'un corridor naturel continu ;
2. une route d'accès routière vers un grand massif naturel doit battre un petit fragment trail local suivi de routes ;
3. une boucle routière propre qui contourne un bois doit perdre contre une boucle qui accepte une transition routière pour entrer dans le bois ;
4. une boucle sur petites routes traversant un bois mappé doit battre une grande boucle routière ouverte, même si ces routes forestières n'ont ni `path` ni surface terre dans OSM.

Les cas 3 et 4 formalisent le problème “bois des Amis de Jean Bosco → bois de Baron” : le solver doit viser le massif, y entrer et exploiter les routes/chemins qui le traversent, pas simplement longer sa périphérie ou saisir le premier bout vert disponible.

## Pourquoi c'est important

C'est une décision de positionnement : TrailForge ne doit pas optimiser une moyenne abstraite, mais produire des traces qui ressemblent à ce qu'un traileur local choisirait vraiment. Le moteur doit donc apprendre à suivre les “lignes de terrain”, pas juste additionner des petits bonus de nature.
