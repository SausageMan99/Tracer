# TrailForge production benchmarks

Ces cas viennent des retours Reddit V1. Ils servent à éviter les corrections au feeling : une modification du moteur doit améliorer ou au moins ne pas dégrader ces scénarios.

## Critères de passage

Un parcours est acceptable uniquement si :

- Distance réelle dans ±15 % de la distance demandée, idéalement ±8 %.
- D+ réel dans ±35 % quand le D+ est une vraie contrainte.
- Boucle fermée à moins de 500 m du départ.
- 0 % de sens interdit vélo/VTT connu.
- 0 % d'accès privé/interdit.
- Moins de 8 % de grands axes (`primary`, `trunk`, `motorway`).
- Peu d'aller-retours : moins de 8 % d'arêtes répétées.
- Pour scenic/trail : priorité aux parcs, canaux, forêts, chemins, pistes et rues calmes.
- Message d'erreur explicite si le cas est impossible au lieu d'un générique “aucun réseau”.

## Cas terrain prioritaires

### Lille — 10 km scenic running

Problème remonté : parcours qui traverse des zones franchement désagréables.

Attendu : éviter les grands axes et quartiers peu adaptés à une sortie solo ; favoriser parcs, canaux, rues calmes et chemins.

### Paris 19e — avenue Secrétan — 5 à 10 km running

Problèmes remontés : mobile bloqué, adresse qui ne génère pas, meilleurs spots ignorés.

Attendu : exploiter Buttes-Chaumont, Canal de l'Ourcq, Canal Saint-Denis quand pertinent ; éviter un centre-ville plein d'intersections.

### Paris centre — 5 km récupération

Problème remonté : “aucun réseau routier détecté”.

Attendu : génération possible ou message clair si contrainte trop serrée.

### Dijon centre — 10 km endurance

Problème remonté : “aucun réseau routier détecté”.

Attendu : génération possible avec boucle fermée.

### Campagne vallonnée — 10 km / 150 m D+

Problèmes remontés : D+ faux, route prise sur 100 m puis demi-tour.

Attendu : D+ cohérent, peu de backtracking, trace qui ne fait pas d'aller-retour absurde.

### Nanterre vers l'est — running scenic

Demande utilisateur : pouvoir donner une direction ou une zone cible.

Attendu futur : biais directionnel vers l'est / Bois de Vincennes, sans forcer un point-à-point.

### Rennes vers Saint-Malo — running/cycling directionnel

Demande utilisateur : orientation de parcours.

Attendu futur : mode “direction préférée” plutôt que boucle pure.

### VTT 40 km

Problèmes remontés : sens interdit, gradients faux.

Attendu : aucun sens interdit vélo/VTT connu, surfaces compatibles, profil de pente lisible.

## Métriques automatisées déjà exposées

Chaque candidat V2 peut maintenant inclure `quality` :

- `distanceErrorPct`
- `elevationErrorPct`
- `loopGapKm`
- `busyRoadRatio`
- `trailRatio`
- `restrictedAccessRatio`
- `onewayViolationRatio`
- `repeatEdgeRatio`
- `intersectionDensityPerKm`
- `productionScore`
- `warnings`

Ces métriques doivent alimenter le futur runner de benchmark réseau une fois les clés et quotas stabilisés.
