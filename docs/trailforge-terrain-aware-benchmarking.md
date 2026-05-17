# TrailForge — Terrain-Aware Benchmarking

## Résumé exécutif

Les benchmarks actuels de TrailForge sont utiles pour empêcher les régressions évidentes : distance trop fausse, boucle non fermée, trop de grands axes, trop de répétition, surfaces incohérentes, génération trop lente. Mais ils ne suffisent pas encore à comprendre ce qu'est une excellente trace de trail.

Une excellente trace n'est pas seulement une trace qui respecte quelques ratios. C'est une trace qui comprend le terrain disponible autour du départ, choisit une stratégie adaptée, exploite les bons composants naturels, accepte les transitions utiles, refuse les promesses impossibles, et produit une forme de parcours que quelqu'un aurait réellement envie de courir.

Le système de benchmark doit donc passer d'un contrôle de conformité route-level à un laboratoire terrain-aware : mesurer d'abord le terrain de jeu disponible, puis juger si la route générée capture correctement cette opportunité.

Objectif : savoir répondre, pour chaque génération :

> Compte tenu du terrain disponible ici, cette trace est-elle le meilleur compromis honnête ?

Pas seulement :

> L'API a-t-elle généré une boucle proche de la distance demandée ?

## Diagnostic des benchmarks actuels

### Ce qui est solide

Le panel actuel `lib/route-benchmarks-data.json` couvre déjà 14 cas utiles : Tourville, Caen, Clécy, Fontainebleau, Meudon, Lille, Paris, Nanterre, rural OSM pauvre.

Les métriques actuelles couvrent les principaux garde-fous :

- distance et D+ ;
- fermeture de boucle ;
- busy-road ratio ;
- naturalWayRatio, pavedRatio, trailRatio ;
- trailBeautyScore ;
- longestTrailSegmentKm ;
- naturalCorridorRatio ;
- repeatEdgeRatio, uTurnRatio ;
- terrainDataConfidence, trailPotential ;
- durée d'exécution ;
- typed refusals et best-effort outcomes sur certains cas.

C'est une base sérieuse. TrailForge ne teste déjà plus seulement un HTTP 200.

### Ce qui manque

Les benchmarks actuels savent surtout dire : cette route est-elle objectivement mauvaise ?

Ils savent moins dire : cette route est-elle excellente pour ce terrain ?

Les limites principales :

1. Le benchmark juge la route sans mesurer assez explicitement ce que le terrain permettait.
2. Les seuils de forme sont trop peu généralisés : self-intersection, out-and-back similarity, loop compactness, start/end stem et sharp turns ne sont présents que sur une minorité de cas.
3. Les métriques de continuité naturelle existent, mais elles ne pilotent pas encore assez clairement le verdict produit.
4. Le benchmark ne distingue pas encore assez fortement les promesses : vrai trail forestier, transition vers bois, parc urbain, nature urbaine, rural OSM pauvre, refus attendu.
5. Le benchmark V3 peut réussir techniquement sans prouver une vraie amélioration produit. Un `success: true` signifie souvent absence d'erreur, pas excellence de trace.
6. Les artifacts sont bons pour diagnostiquer après coup, mais il manque une couche de synthèse expliquant pourquoi la route choisie est ou non le bon compromis.

## Définition cible : une excellente trace

Une trace excellente est une trace qui maximise la qualité sportive et paysagère sous contrainte du terrain réel.

Elle doit respecter cinq contrats.

### 1. Contrat de base

La trace doit être exploitable :

- distance proche de la demande ou ajustement explicite ;
- boucle fermée proprement ;
- pas d'accès privé/interdit ;
- pas de grand axe absurde ;
- pas de demi-tour évident ;
- pas d'overlap/backtracking excessif ;
- GPX/GeoJSON cohérents avec la carte.

Ce contrat reste le socle non négociable.

### 2. Contrat terrain

La trace doit créer un vrai moment terrain.

Pour du trail, cela veut dire :

- rester assez longtemps dans une zone naturelle intéressante ;
- préférer un corridor naturel continu à des fragments verts dispersés ;
- ne pas compter de l'asphalt/concrete scenic comme du trail ;
- accepter une transition routière seulement si elle mène à un vrai gain terrain.

À Tourville, une route de transition peut être bonne si elle permet d'entrer et de rester dans les bois Jean Bosco / Baron. Une trace qui contourne les bois ou ajoute des boucles parasites est mauvaise même si ses ratios sont acceptables.

À Fontainebleau, le terrain disponible est riche : le moteur doit être sévèrement jugé s'il sort trop vite de la forêt ou produit une trace trop pavée.

À Caen ou Paris, le moteur doit assumer une promesse nature urbaine / récupération, pas vendre du faux trail.

### 3. Contrat de forme

La trace doit ressembler à une sortie humaine, pas à un remplissage algorithmique.

À surveiller :

- figure-8 inutile ;
- tige aller-retour au départ ;
- micro-zigzags pour atteindre la distance ;
- forme compressée sans exploration spatiale ;
- superposition visuelle ;
- succession de virages violents ;
- boucle qui revient trop tôt puis repart artificiellement.

Les métriques de forme doivent devenir universelles, pas réservées aux petits parcs.

### 4. Contrat d'honnêteté

Si le terrain ne permet pas la promesse, TrailForge doit le dire.

Un bon résultat peut être :

- `generated` : promesse tenue ;
- `adjusted` : route utile mais compromis explicite ;
- `refused` : promesse impossible ou trop incertaine.

Le benchmark doit valoriser un refus honnête mieux qu'une trace de 12 km vendue comme trail mais majoritairement bitumée.

### 5. Contrat d'exploitation de l'opportunité

La trace doit exploiter ce qui était disponible.

Une route à 35 % de naturalWayRatio peut être excellente si le terrain local plafonne à 40 %. Elle est médiocre à Fontainebleau si le terrain permet 80 %.

C'est le principe central : juger la route par rapport à l'opportunité terrain, pas seulement par rapport à des seuils fixes.

## Architecture cible du benchmark

Le nouveau système doit fonctionner en trois niveaux.

### Niveau 1 — Route Quality Gate

C'est le benchmark actuel renforcé.

Il vérifie les garde-fous objectifs :

- distance ;
- D+ ;
- boucle ;
- sécurité ;
- surfaces ;
- répétition ;
- U-turn ;
- duration ;
- warnings bloquants ;
- GPX/GeoJSON cohérents.

À renforcer : généraliser les métriques de forme à tous les cas.

Métriques à rendre disponibles partout :

- `geometryOverlapRatio` ;
- `selfIntersectionCount` ;
- `outAndBackSimilarityRatio` ;
- `startStemKm` ;
- `endStemKm` ;
- `loopCompactness` ;
- `maxDistanceFromStartKm` ;
- `sharpTurnDensityPerKm` ;
- `headingReversalRatio`.

### Niveau 2 — Terrain Opportunity Report

Avant de juger une route, le benchmark doit décrire le terrain de jeu.

Nouveau contrat proposé : `TerrainOpportunityReport`.

Il doit répondre :

- Quels composants naturels existent autour du départ ?
- Sont-ils forestiers, parc, urban green, river corridor, field paths, scenic paved, residential ?
- Quelle distance faut-il parcourir pour les atteindre ?
- Combien de kilomètres utilisables contiennent-ils ?
- Quelle part est non-paved ?
- Quelle part est paved ?
- Quelle confiance OSM a-t-on sur les surfaces ?
- Quel niveau de promesse est réaliste ici ?
- Quel type d'outcome est honnête : generated, adjusted ou refused ?

Exemple de structure :

```ts
interface TerrainOpportunityReport {
  caseId: string;
  request: {
    start: { lat: number; lng: number };
    targetDistanceKm: number;
    mode: 'trail' | 'nature_urbaine' | 'endurance' | 'recovery';
  };
  graph: {
    totalEdgeKm: number;
    usableEdgeKm: number;
    connectedComponentKm: number;
    confidence: 'low' | 'medium' | 'high';
    warnings: string[];
  };
  components: TerrainOpportunityComponent[];
  bestAvailable: {
    maxNaturalDwellKm: number;
    maxContinuousNaturalKm: number;
    maxNonPavedRatioEstimate: number;
    minConnectorKmToUsefulTerrain: number;
    realisticOutcome: 'generated' | 'adjusted' | 'refused';
    reason: string;
  };
}

interface TerrainOpportunityComponent {
  id: string;
  kind: 'forest' | 'park' | 'urban_green' | 'river_corridor' | 'field_paths' | 'scenic_paved' | 'residential' | 'unknown';
  distanceFromStartKm: number;
  totalLengthKm: number;
  pavedRatio: number;
  nonPavedRatio: number;
  accessConfidence: 'low' | 'medium' | 'high';
  surfaceConfidence: 'low' | 'medium' | 'high';
  estimatedDwellCapacityKm: number;
  connectorCostKm: number;
  warnings: string[];
}
```

Ce rapport ne doit pas générer la route. Il doit mesurer l'opportunité disponible.

### Niveau 3 — Opportunity Capture Score

Une fois la route générée, elle doit être comparée au terrain disponible.

Nouvelles métriques proposées :

```ts
interface OpportunityCaptureMetrics {
  opportunityCaptureScore: number;
  naturalDwellCaptureRatio: number;
  continuousNaturalCaptureRatio: number;
  targetComponentCaptureRatio: number;
  connectorEfficiencyRatio: number;
  avoidablePavementKm: number;
  missedBetterComponentCount: number;
  promiseHonestyScore: number;
}
```

Définition pratique :

- `naturalDwellCaptureRatio` = naturalDwellKm produit / naturalDwellKm réaliste disponible.
- `continuousNaturalCaptureRatio` = plus long segment naturel produit / meilleur corridor continu disponible.
- `targetComponentCaptureRatio` = dwell dans les composants cibles / dwell cible réaliste.
- `connectorEfficiencyRatio` = connecteur minimal réaliste / connecteur réellement utilisé, borné à 1. Plus le ratio est haut, moins la route gaspille de kilomètres d'accès avant d'atteindre le terrain utile.
- `avoidablePavementKm` = kilomètres pavés évitables selon les alternatives détectées.
- `missedBetterComponentCount` = composants terrain meilleurs, accessibles, mais ignorés.
- `promiseHonestyScore` = cohérence entre outcome annoncé et terrain réel.

Le score final ne doit pas remplacer les hard gates. Il doit expliquer la qualité relative.

## Panels de benchmark recommandés

### Panel A — Vrai trail forestier

Objectif : vérifier que le moteur exploite une forêt riche sans sortir inutilement sur route.

Cas :

- Fontainebleau 12/15 km ;
- Meudon 10 km si restricted/access proprement vérifié ;
- Clécy 10/12 km pour trail vallonné rural.

Critères forts :

- naturalDwell élevé ;
- continuousNatural élevé ;
- pavedRatio bas ;
- opportunityCaptureScore élevé ;
- pas de refus si l'opportunité terrain est objectivement forte.

### Panel B — Transition vers bois

Objectif : vérifier que le moteur accepte une transition route si elle sert une vraie entrée terrain.

Cas :

- Tourville 5/8/10/12 km.

Critères forts :

- transition routière autorisée mais utile ;
- targetComponentDwell dans Jean Bosco / Baron ;
- pas de simple contournement des bois ;
- pas de boucle parasite ;
- connectorEfficiencyRatio correct ;
- avoidablePavementKm faible.

### Panel C — Parc urbain / récupération

Objectif : produire une boucle propre, courte, honnêtement urbaine/nature, sans faux trail.

Cas :

- Caen Colline aux Oiseaux.

Paris Buttes-Chaumont reste volontairement dans le panel négatif/impossible quand la demande est trop contrainte : il sert à vérifier un adjusted/refusal honnête plutôt qu'une récupération urbaine normale.

Critères forts :

- forme propre ;
- adjusted/refused acceptable si le parc est trop petit ;
- pavedRatio honnête ;
- pas de figure-8 ou de tige départ ;
- pas de promesse trail forestier.

### Panel D — Nature urbaine / endurance scenic

Objectif : éviter les grands axes et capter les meilleurs corridors urbains.

Cas :

- Lille Citadelle/Deûle ;
- Paris 19 canal/Buttes-Chaumont ;
- Nanterre éviter grands axes ;
- Caen Prairie/Orne.

Critères forts :

- busyRoadRatio bas ;
- intersection density maîtrisée ;
- corridor park/canal exploité ;
- direction/zone cible future ;
- pas de faux refus `NO_ROAD_NETWORK` si le graphe est dense.

### Panel E — Terrain pauvre / incertain

Objectif : tester l'honnêteté.

Cas :

- rural OSM pauvre ;
- départ semi-rural avec surfaces inconnues ;
- petit parc trop long demandé en trail.

Critères forts :

- warnings OSM explicites ;
- refus ou adjusted propre ;
- pas de surfaces maquillées ;
- pas de trace longue artificielle.

## Tests métamorphiques à ajouter

Les benchmarks fixes ne suffisent pas. Il faut tester la stabilité du moteur.

### Distance sweep

Même départ, mêmes contraintes, distances 5 / 8 / 10 / 12 km.

Attendu :

- la stratégie reste cohérente ;
- la route s'étend naturellement ;
- elle ne passe pas brutalement d'un bon corridor à une trace absurde ;
- les refus/adjusted apparaissent quand le terrain plafonne.

### Start jitter

Déplacer le départ de 100 à 300 m.

Attendu :

- les composants terrain ciblés restent cohérents ;
- les métriques ne s'effondrent pas ;
- le moteur ne dépend pas trop d'un point OSM précis.

### Mode contrast

Même départ, comparer `running_endurance`, `running_recuperation`, `running_trail`, `nature_urbaine`.

Attendu :

- trail augmente naturalDwell ou refuse ;
- recovery privilégie forme propre et sécurité ;
- endurance accepte plus de pavé mais évite les grands axes ;
- nature urbaine exploite parcs/canaux sans survente.

### Terrain promise inversion

Demander un trail long dans un petit parc urbain.

Attendu :

- adjusted/refused ;
- jamais une longue boucle pavée vendue comme trail.

### Determinism / bounded variance

Relancer plusieurs fois le même cas.

Attendu :

- mêmes outcomes ;
- métriques proches ;
- pas de variation brutale sauf seed explicitement contrôlée.

## Artifacts obligatoires

Chaque benchmark critique doit produire :

- JSON route complet ;
- GeoJSON route ;
- GPX ;
- edge diagnostics JSON ;
- edge diagnostics GeoJSON ;
- TerrainOpportunityReport JSON ;
- résumé benchmark lisible ;
- si possible, image statique ou HTML d'inspection carto.

Le résumé doit répondre :

1. Quelle était la promesse demandée ?
2. Quel terrain était disponible ?
3. Quelle stratégie le moteur a choisie ?
4. Quels composants ont été capturés ou ignorés ?
5. Pourquoi l'outcome est generated / adjusted / refused ?
6. Quelle est la principale faiblesse de la trace ?

## Score proposé

Ne pas créer un score unique opaque au début. Commencer par une composition lisible :

```txt
routeQualityGate: pass/fail
shapeQualityScore: 0..1
terrainOpportunityScore: 0..1
opportunityCaptureScore: 0..1
promiseHonestyScore: 0..1
finalVerdict: excellent | good | acceptable_adjusted | honest_refusal | bad_route | dishonest_route
```

`finalVerdict` doit être plus important que `finalScore`.

Règles :

- Une route dangereuse ou interdite est toujours `bad_route`.
- Une route qui vend du trail mais produit majoritairement du pavé est `dishonest_route`.
- Un refus cohérent avec un terrain pauvre est `honest_refusal`.
- Une route ajustée claire peut être meilleure produit qu'une route forcée.
- Une excellente route doit passer les hard gates, capturer l'opportunité terrain, et avoir une forme propre.

## Implications pour V2.5 vs V3

Le benchmark de comparaison doit être plus sévère.

V3 n'est pas meilleur parce qu'il refuse plus vite. V3 est meilleur seulement s'il :

- produit une route utilisable quand le terrain le permet ;
- refuse quand V2.5 force une route malhonnête ;
- garde GPX/GeoJSON ;
- améliore l'explication terrain ;
- réduit les répétitions sans abandonner le terrain naturel ;
- améliore ou maintient l'utilité produit.

Comparaison minimale :

```ts
interface EngineComparisonVerdict {
  productOutcomeDelta: 'better' | 'equivalent' | 'worse';
  routeUtilityDelta: number;
  terrainTruthDelta: number;
  opportunityCaptureDelta: number;
  exportRegression: boolean;
  reason: string[];
}
```

Un V3 qui refuse une route là où V2.5 produit une trace utile ne doit pas être classé équivalent. Il peut être plus honnête sur certains cas, mais il est produit-faible tant qu'il ne sait pas assembler une alternative propre.

## Plan d'exécution recommandé

### P0 — Spécifier et instrumenter sans changer le moteur

Objectif : rendre le diagnostic plus profond sans risquer de casser la génération.

À faire :

1. Ajouter `TerrainOpportunityReport` comme artifact benchmark.
2. Calculer les composants terrain disponibles avant génération.
3. Écrire les artifacts par cas.
4. Ajouter les métriques shape universelles au résumé benchmark.
5. Ne pas modifier le scoring moteur au début.

Succès : chaque benchmark explique le terrain disponible et les composants ignorés/capturés.

### P1 — Ajouter les métriques de capture

Objectif : mesurer si la route exploite le terrain.

À faire :

1. Calculer `naturalDwellCaptureRatio`.
2. Calculer `targetComponentCaptureRatio`.
3. Calculer `connectorEfficiencyRatio`.
4. Calculer `avoidablePavementKm` approximatif.
5. Ajouter `opportunityCaptureScore` au rapport.

Succès : Tourville peut distinguer une transition utile d'un contournement inutile ; Fontainebleau peut punir une route qui ignore la forêt.

### P2 — Recomposer les panels

Objectif : juger chaque cas selon sa promesse réelle.

À faire :

1. Séparer les panels en forest trail, transition_to_woods, park recovery, urban nature, poor OSM, negative cases.
2. Donner à chaque panel des seuils adaptés.
3. Ajouter les tests métamorphiques distance sweep et start jitter.
4. Rendre les outcomes `generated/adjusted/refused` explicitement attendus selon l'opportunité terrain.

Succès : le benchmark ne punit plus un bon adjusted urbain, mais punit sévèrement un faux trail.

### P3 — Refaire la comparaison V2.5/V3

Objectif : mesurer la vraie progression produit.

À faire :

1. Comparer V2.5 et V3 sur les mêmes TerrainOpportunityReports.
2. Ajouter `routeUtilityDelta`, `terrainTruthDelta`, `opportunityCaptureDelta`.
3. Marquer comme régression toute perte GPX/GeoJSON quand V2.5 avait une route utile.
4. Distinguer refus honnête et incapacité d'assemblage.

Succès : V3 ne peut plus être déclaré équivalent si elle refuse par faiblesse d'assemblage.

### P4 — Intégrer la revue visuelle

Objectif : réconcilier métriques et jugement humain.

À faire :

1. Générer une carte d'inspection par benchmark critique.
2. Colorer les segments par surface/nature/repeat.
3. Afficher composants terrain disponibles vs route choisie.
4. Garder des golden judgments humains pour Tourville, Fontainebleau, Caen, Paris.

Succès : on peut ouvrir un artifact et juger en 10 secondes si la trace ressemble à une vraie sortie.

## Décisions à prendre maintenant

1. Le benchmark doit devenir terrain-aware avant de continuer à optimiser l'assembler.
2. Le moteur ne doit pas être récompensé pour générer plus souvent si la promesse est malhonnête.
3. V3 doit être jugée sur son utilité produit, pas seulement sur son honnêteté théorique.
4. Les cas Tourville doivent rester centraux, car ils testent exactement le problème clé : accepter la route seulement pour atteindre un vrai terrain.
5. Fontainebleau doit devenir le cas de vérité trail riche : si le moteur échoue là, c'est un problème d'assemblage, pas de manque terrain.
6. Les petits parcs et zones urbaines doivent servir à tester l'honnêteté, pas à forcer du trail.

## Critère de réussite final

TrailForge aura un bon système de benchmark quand on pourra dire pour chaque génération :

- le terrain disponible est compris ;
- la promesse utilisateur est réaliste ou refusée ;
- la trace capture les meilleurs composants accessibles ;
- la forme ressemble à une vraie sortie ;
- les compromis sont explicites ;
- V2.5/V3 sont comparées sur la qualité produit réelle.

Le but n'est pas de rendre tous les benchmarks verts. Le but est de savoir pourquoi une route est bonne, médiocre, ajustée ou refusée, avec assez de preuves pour améliorer le moteur sans bricoler les seuils.
