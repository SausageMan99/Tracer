# Refonte complète /app — Phase 1 trail

## Décision

L'application TrailForge ne doit plus ressembler à une plateforme outdoor généraliste. Elle devient un atelier de génération de boucles trail courtes : 5–15 km, D+ réaliste, GPX montre, compromis visibles.

## Ce qui change

- Le brief utilisateur est recentré sur une boucle trail testable : départ, distance, D+, allure, terrain prioritaire.
- La distance est explicitement plafonnée à 15 km dans l'UI.
- Le D+ est plafonné à 600 m dans l'UI pour éviter les promesses irréalistes sur des boucles courtes.
- Le CTA passe de langage générique à une promesse terrain : générer une boucle, pas un “parcours parfait”.
- L'état idle de la carte explique quoi faire au lieu de laisser une carte sombre vide.
- Les résultats remplacent le score magique par un verdict lisible : distance réelle, D+, temps estimé, signal sentiers, santé de la boucle.
- Les compromis sont affichés comme des contraintes techniques, pas cachés derrière une note marketing.
- L'export GPX reste l'action principale après génération.
- Le feedback terrain est traité comme partie du produit, pas comme un détail secondaire.

## Direction visuelle

- Palette plus froide et plus instrumentale : noir forêt, crème froid, sage, lime discret, ambre topo.
- Suppression de l'orange fitness comme accent principal.
- Chiffres terrain en JetBrains Mono pour donner une sensation d'altimètre/GPS.
- Boutons plus carrés, moins marketing.
- Cards résultat conçues comme des cadrans d'instrument, sans pictogrammes décoratifs.
- Texture topo plus subtile pour ne pas parasiter la lisibilité.

## Pourquoi

La maquette générée par IA était séduisante mais revenait au piège multi-sport : vélo, gravel, VTT, score 92/100, “parcours parfait”, IA magique. Cette refonte aligne l'application avec la stratégie YC-compatible : wedge étroite, promesse honnête, apprentissage terrain, pas d'expansion avant validation.

## Fichiers principaux modifiés

- `app/app/page.tsx`
- `app/globals.css`
- `components/app/AppNav.tsx`
- `components/sidebar/SessionForm.tsx`
- `components/sidebar/RouteResult.tsx`
- `components/map/MapView.tsx`

## Vérification attendue

- `/app` ne montre aucun choix vélo, gravel, VTT ou cyclisme.
- Le panneau gauche parle de boucle trail, pas de plateforme outdoor.
- Les presets distance s'arrêtent à 15 km.
- Les presets D+ s'arrêtent à 600 m.
- La carte idle affiche un message de départ.
- Le résultat affiche la santé de la boucle et les compromis avant export GPX.
