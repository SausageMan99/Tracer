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

## Règles appliquées

Une arête est considérée comme naturelle si elle est :

- un type OSM `path`, `track`, `footway`, `bridleway`, ou
- une surface `dirt`, `earth`, `grass`, `ground`, `unpaved`, `compacted`, `fine_gravel`, `gravel`, `sand`.

Le solver applique ensuite :

- un bonus de base pour les arêtes naturelles ;
- un bonus progressif quand l'arête prolonge un corridor existant ;
- un plafond pour éviter que le bonus écrase tout le reste ;
- une petite pénalité lorsqu'un court fragment naturel renvoie immédiatement vers la route ;
- un score final de chemin qui valorise le ratio naturel et surtout le plus long corridor continu ;
- une pénalité de fragmentation quand plusieurs petits segments naturels séparés remplacent un vrai corridor.

## Garde-fou test

Le test `tests/orienteering-solver.test.ts` construit deux boucles :

1. une boucle à score brut supérieur avec un seul fragment trail puis route ;
2. une boucle à score brut inférieur mais composée d'un corridor naturel continu.

Le solver doit classer la deuxième en premier. Ce test échouait avant le changement et passe maintenant.

## Pourquoi c'est important

C'est une décision de positionnement : TrailForge ne doit pas optimiser une moyenne abstraite, mais produire des traces qui ressemblent à ce qu'un traileur local choisirait vraiment. Le moteur doit donc apprendre à suivre les “lignes de terrain”, pas juste additionner des petits bonus de nature.
