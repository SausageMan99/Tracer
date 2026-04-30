# Terrain audit confidence

## Pourquoi

TrailForge Phase 1 ne doit pas promettre une boucle trail parfaite quand la donnée OSM locale est faible. Le moteur doit distinguer deux choses :

1. le potentiel trail réel du graphe local ;
2. la confiance que l'on peut accorder aux tags OSM utilisés pour juger ce potentiel.

C'est particulièrement important sur des zones comme Tourville-sur-Odon, où des chemins ou bois peuvent exister mais être partiellement taggés. Une route peut donc être prometteuse sans être vérifiable à 100 % côté donnée.

## Module

Le modèle est centralisé dans `lib/engine/terrain-audit.ts`.

Entrée : `EnrichedEdge[]`.

Sortie : `TerrainAuditReport` avec :

- `confidence`: `low | medium | high` ;
- `trailPotential`: `low | medium | high` ;
- `metrics`: ratios techniques ;
- `warnings`: signaux lisibles par le moteur/UI ;
- `recommendations`: actions ou interprétations internes.

## Métriques principales

`pathLikeEdgeRatio` mesure la part de `path`, `track`, `footway`, `bridleway`.

`surfaceTaggedRatio` mesure la part d'edges avec une surface renseignée.

`unknownSurfaceRatio` mesure la part d'edges sans surface. Un ratio élevé n'est pas forcément mauvais : si les edges sont des `path/track`, le potentiel trail existe, mais la confiance baisse.

`asphaltRatio` mesure le poids du bitume.

`scenicEdgeRatio` mesure la part d'edges enrichies via signal scenic ou proximité bois/parc/nature.

`naturalAreaSignal` agrège les signaux surface naturelle + scenic.

`fragmentationScore` signale si les corridors naturels sont isolés au lieu de former une vraie continuité trail.

## Règles de classification

`trailPotential = high` quand le graphe contient assez de chemins ou de signal naturel, même si les surfaces sont inconnues.

`trailPotential = low` quand le graphe est surtout asphalté et sans signal scenic.

`confidence = high` quand les surfaces sont assez renseignées ou que le diagnostic routier est net.

`confidence = medium` quand il y a beaucoup de chemins mais peu de surfaces renseignées. C'est le cas critique : TrailForge peut tenter une boucle, mais doit prévenir l'utilisateur.

`confidence = low` quand le graphe est vide ou trop pauvre pour juger.

## Intégration route quality

`assessRouteQuality` appelle `auditTerrainData(edges)` et expose :

- `terrainDataConfidence` ;
- `trailPotential` ;
- `terrainUnknownSurfaceRatio`.

Ces champs sont affichés dans `RouteResult` dans la section santé de la boucle. Le but est d'éviter une fausse impression de certitude : un GPX peut être bon algorithmiquement mais encore dépendre de tags OSM incomplets.

## Impact scoring

Le modèle pénalise explicitement les boucles trail trop routières : asphalt ratio élevé + faible signal scenic.

Il ne pénalise pas mécaniquement les chemins sans surface. Pour TrailForge Phase 1, un `path/track` sans surface reste un candidat trail fort, surtout s'il est `scenic`. C'est volontaire : beaucoup de zones rurales ou boisées sont mal renseignées dans OSM.

## Script interne

`npm run audit:osm -- --address "7 Rue des Pommiers, 14210 Tourville-sur-Odon"`

Options utiles :

- `--lat <number> --lng <number>` pour éviter le géocodage ;
- `--radius-km <number>` pour tester un périmètre ;
- `--json` pour exploiter le résultat ;
- `--fixture <file>` pour auditer un export Overpass local sans réseau.

## Position produit

Le message utilisateur doit rester honnête :

- haute confiance : la donnée locale semble exploitable ;
- confiance moyenne : TrailForge voit du potentiel, mais la surface OSM est incomplète ;
- faible confiance : ne pas vendre le GPX comme fiable sans vérification terrain.

Le bon comportement n'est pas de refuser toutes les zones imparfaites, mais de générer quand le potentiel existe et d'expliquer le niveau de confiance.
