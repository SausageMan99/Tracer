# TrailForge /app — Direction Visuelle Phase 1
## Document de recommandations DA / Senior Frontend Designer

---

## 1. Identité visuelle : l'outil de terrain, pas l'app fitness

**Ambiance** : une station GPS de poche ou une carte topo IGN en version numérique nocturne. Sérieux, précis, confiant. On quitte définitivement l'univers "orange Strava / violet Komoot / bleu AllTrails".

- **Ton** : technique, sobre, sans emphase marketing. Les couleurs ne crient pas ; elles informent.
- **Métaphore** : un altimètre + une carte laminée dans la poche d'un veste Gore-Tex à 5h du matin.

---

## 2. Palette de couleurs (affirmée & minimaliste)

### Fonds (échelle de gris-vert)

| Token actuel | Valeur actuelle | Recommandation | Raison |
|---|---|---|---|
| `--bg-deep` | `#050806` | **garder** | Parfait. Noir-vert profond qui laisse la carte vivre. |
| `--bg-surface` | `#0B120E` | `#0A0F0C` | Légèrement plus froid pour éviter le "vert boue" sur certains écrans. |
| `--bg-elevated` | `#121D16` | `#111A15` | Réduire le chroma vert : l'élévation doit se lire par la lumière, pas par la couleur. |
| `--bg-panel` | `#17231B` | `#161F1A` | Pareil. Plus neutre, moins "bureau". |
| `--border` | `#25382B` | `#1E2E25` | Assombrir les bordures. Séparation subtile entre panneaux, pas lignes de grille visibles. |

### Texte

| Token | Recommandation | Usage |
|---|---|---|
| `--text-primary` | `#E8E6DF` | Titres, labels, statuts actifs. Crémeux froid (avant `#F2F0E8` légèrement jaunâtre). |
| `--text-muted` | `#7D8F82` | Sous-titres, placeholders, données secondaires. Plus discret qu'actuellement. |
| `--text-dim` | `#4A5C50` | Légendes, timestamps, meta inactive. |

### Accents (terrain)

| Token | Recommandation | Usage |
|---|---|---|
| `--accent-moss` | `#3E5A46` | Surfaces interactives au repos (chips inactives, fonds de bouton secondaires). |
| `--accent-sage` | `#8BAF85` | Success discret, états validés, icônes terrain secondaires. |
| `--accent-lime` | `#A3C96A` | **Point chaud unique** : le curseur du slider, le point de départ sur la carte, la trace active. Usage ultra-parcimonieux. |
| `--accent-amber` | `#A68B5B` | Topo : lignes de contour, éléments cartographiques décoratifs, hover secondaire. |
| `--accent-danger` | `#B85A4E` | Erreurs techniques. Pas de rouge vif. |

**Eliminer** : `--accent-trail` orange brique (`#B56B38` / `#C17A3A`). Ce ton a un point de fuite vers l'univers fitness trail bas de gamme. Remplacer par l'ambre topo ci-dessus pour tout ce qui est décoratif cartographique.

---

## 3. Typographie

### Hiérarchie stricte à 3 niveaux

| Rôle | Police | Poids | Taille | Tracking | Usage |
|---|---|---|---|---|---|
| **H1 / Marque** | Playfair Display | 400 | 28–32px | `-0.02em` | Titre du panneau, état idle vide. |
| **H2 / Section** | Syne | 600 | 11px | `0.22em` | Labels de section en uppercase ("INTENTION", "POINT DE DÉPART"). Plus serré qu'actuellement. |
| **Corps** | Inter | 400 | 13px | `0` | Paragraphes, descriptions, boutons. |
| **Données terrain** | JetBrains Mono | 500 | 20–26px | `-0.03em` | **Disruption clé** : distances, D+, durée, élévation. Doivent être monospaced pour évoquer un instrument de mesure. |
| **Données terrain sub** | JetBrains Mono | 400 | 11px | `0` | Unités (km, m, min), deltas. |
| **Légende carte** | Inter | 500 | 10px | `0.02em` | Étiquettes Mapbox (si custom layer). |

### Règles typographiques
- Les stat cards utilisent **exclusivement JetBrains Mono** pour la valeur chiffrée. Interdicition de passer en Inter pour les chiffres.
- Les sections labels (ex: "INTENTION DE SORTIE") doivent être en `font-size: 11px`, `letter-spacing: 0.22em`, `text-transform: uppercase`, couleur `--text-dim`. Plus élégant et moins "label de formulaire web".

---

## 4. Layout /app : spatial architecture

### Sidebar (desktop)

- **Largeur fixe** : garder 360px. C'est le standard "panneau d'outils" (pense Figma sidebar / Mapbox studio). Ne pas réduire.
- **Card-style** : le panneau ne doit pas être un simple fond plat. Proposition :
  - `box-shadow: 32px 0 96px rgba(0,0,0,0.55)` sur la bordure droite (plus large et plus douce qu'actuellement).
  - Bordure droite : `1px solid var(--border)`.
  - Fond : `linear-gradient(180deg, var(--bg-deep) 0%, var(--bg-surface) 60%, var(--bg-elevated) 100%)`.
  - **Texture topo** : garder `--topo-lines` mais réduire l'opacité à `0.08` (au lieu de `0.22`). Elle doit être à peine perceptible en peripherie, pas un motif dominant.

### Mobile
- Garder le drawer slide-over. Mais ajouter un **état de fond flou** (`backdrop-filter: blur(12px)`) sur l'overlay noir au lieu de `bg-black/50` plat. Cela renforce la profondeur "verre dépoli".
- Le FAB mobile : arrondi pill `999px`, padding `12px 20px`, pas `14px 24px`. Trop gros actuellement. Poids de police 600, pas 700.

### Carte (MapView)

- **Style Mapbox** : passer sur un style **dark custom minimal**, pas `mapbox://styles/mapbox/dark-v11` qui est trop bleu-violet.
  - Noir profond pour l'eau et les zones urbaines.
  - Gris-vert très sombre pour les forêts.
  - Blanc cassé très discret (`#2A2F2A`) pour les routes secondaires.
  - **Les routes ne sont pas colorées** ; elisent par contraste de luminosité, pas par teinte.
- **Trace générée** :
  - Couleur : `--accent-lime` `#A3C96A` avec un `line-width: 3px` et un `blur: 0`.
  - **Glow subtil** : ombre portée `0 0 10px rgba(163,201,106,0.25)` uniquement sur le tracé. Pas de halo large type néon.
  - Point de départ : rond plein `8px` `--accent-lime`, anneau pulse `16px` opacité `0.3`, pas animation agressive infinie. 3 pulsations max, puis arrêt.

---

## 5. États : idle, loading, result

### Idle (carte vierge, formulaire prêt)

- **Carte** : centrée sur la dernière position connue ou la France. Style sombre. Pas de trace.
- **Message d'accueil** : au lieu d'une carte vide silencieuse, afficher en overlay faible au centre de la carte :
  - Un icône topo (lignes de contour stylisées) en `--text-dim`, opacity 0.4.
  - Texte Playfair Display 18px : "Choisissez un point de départ".
  - Cela évite le "mur noir".
- **Sidebar** : champs vides, bouton CTA en état `disabled` visuel (opacity 0.4, pas de couleur), qui prend vie uniquement quand l'adresse est remplie.

### Loading (génération en cours)

- **Sidebar** : occuper tout le panneau avec un état plein.
  - Fond : `--bg-deep` avec `--topo-lines` opacity 0.06.
  - Titre : "Analyse du terrain" (Playfair 22px).
  - **Progress** : une fine ligne horizontale (`2px` height) en `--accent-lime` qui avance avec des easings exponentiels. Pas de barre épaisse.
  - Étapes sous la barre : JetBrains Mono 11px, `--text-muted`, pas `--text-dim`.
  - Pas de spinner circulaire central. Un spinner circulaire est un pattern générique ; un trait de progression horizontale fine est un pattern "instrument".
- **Carte** : placer un effet **radar** au point de départ.
  - 2 anneaux SVG qui s'élargissent et s'estompent (déjà en place mais adoucir).
  - Opacité max 0.15. Pas de remplissage vert.
  - Curseur : `wait` sur la carte.

### Result (route affichée)

- **Sidebar** : transition slide-in déjà en place (500ms ease-out-expo). Préserver.
- **Stat cards** : redesigner comme des "cadrans d'instrument".
  - Supprimer les box-shadow génériques `0 12px 36px...`.
  - Remplacer par un `border: 1px solid` avec deux tonalités :
    - Bordure externe : `var(--border)` (`#1E2E25`).
    - Ligne de séparation interne fine (`0.5px solid rgba(125,143,130,0.15)`) entre le label et la valeur.
  - Valeur : JetBrains Mono 24px, `--text-primary`.
  - Label : Syne 10px, uppercase, `--text-dim`.
  - **Pas d'icônes dans les stat cards**. Les icônes ajoutent du bruit visuel. Un bon altimètre n'a pas de pictogramme pour dire "altitude" ; il a un chiffre et une unité.
- **Profile d'élévation** :
  - Courbe : stroke `--accent-lime`, `2px`, pas de remplissage dégradé flashy.
  - Remplissage souhaité : un gradient vertical `rgba(163,201,106,0.08)` vers transparent. Très subtil.
  - Grille : lignes horizontales `0.5px`, `--border`, opacity 0.5.
- **CTA secondaires** (Télécharger GPX, Nouvelle boucle) :
  - Styler comme des boutons "commande physique" : fond `--bg-elevated`, bordure `1px solid var(--border)`, hover `--bg-panel`.
  - Pas de gradient flashy. Un gradient sur un bouton secondaire est bruyant.

---

## 6. Composants à redesigner

### SessionForm

- **Chips d'intention** (Découverte / Trail / Endurance) :
  - Inactif : fond `--bg-elevated`, bordure `1px solid var(--border)`, texte `--text-muted`.
  - Actif : fond `rgba(163,201,106,0.08)` (lime à 8%), bordure `1px solid rgba(163,201,106,0.35)`, texte `--accent-lime`.
  - Hover : bordure `--text-muted`.
  - Pas de `box-shadow` sur les chips.
- **Slider distance** :
  - Track : `height: 2px`, fond `--border`.
  - Thumb : `12px` (actuellement 14px : trop gros), `--accent-lime`, pas de glow par défaut.
  - Thumb hover : scale(1.3), glow `0 0 6px rgba(163,201,106,0.3)`.
  - Valeur affichée à côté : JetBrains Mono 13px, pas Inter.
- **Bouton principal "Tracer la boucle"** :
  - Actuellement un gradient lime/sage flashy. Trop fitness.
  - Proposition : fond `--accent-lime`, texte `--bg-deep`, pas de gradient.
  - Hover : légère augmentation de luminosité (pas de changement de teinte).
  - Active : scale(0.98), pas de press-in excessif.

### RouteResult

- **Header** :
  - Distance réelle vs demandée : JetBrains Mono 28px pour la distance réelle, `11px` `--text-dim` pour la demandée en dessous.
  - Qualité : supprimer le gros ring coloré si trop voyant. Remplacer par un simple texte : Qualité `87%` avec un petit dot coloré à gauche (lime/ambre/rouge selon score).
- **Avertissements** (compromis détectés) :
  - Fond `rgba(196,161,102,0.06)` (ambre topo à 6%), bordure gauche `2px solid --accent-amber`.
  - Texte Inter 11px, `--text-muted`.
  - Pas de fond rouge/jaune agressif.

---

## 7. Détails distinctifs (signature visuelle)

1. **Data monospaced** : toute donnée numérique (km, m, min, %) est en JetBrains Mono. C'est le détail qui transforme une app web en un outil de terrain.
2. **Cadence typographique** : les labels de section sont en uppercase 11px, lettres espacées. Cela crée une grille d'information silencieuse.
3. **Pas d'icônes dans les stats** : suppression des pictogrammes dans les stat-cards. Rien ne remplace la clarté brute d'un chiffre monospaced.
4. **Glow topo** : le seul glow de l'interface est celui de la trace sur la carte. Pas de glow sur les boutons, les inputs, les modales.
5. **Boutons carrés** : `border-radius: 10px` pour les panneaux, mais `border-radius: 6px` pour les boutons d'action. Un bouton plus carré = plus fonctionnel, moins "marketing".
6. **Transitions** : toutes les transitions de panneau / carte utilisent `cubic-bezier(0.16, 1, 0.3, 1)` (déjà en place). À préserver absolument.

---

## 8. Anti-patterns à éviter

- **Pas de gradient sur les boutons secondaires** : un gradient = call-to-action marketing.
- **Pas de rouge/orange vif** pour l'alerte : utiliser l'ambre topo atténué.
- **Pas de couleurs sur les routes de la carte** : les chemins s'éclaircissent ou s'assombrisent. Pas de vert pour les sentiers, pas d'orange pour les pistes.
- **Pas de bordures doubles voyantes** : si on veut séparer, on utilise l'espace (padding/margin) ou une ligne `0.5px` à 10% d'opacité.

---

## 9. Livrable immédiat

Ce document est la source de vérité pour la Phase 1. Avant toute intervention CSS/TSX, utiliser ces tokens et ces règles comme checklist. Les changements doivent être soumis en lot (design token → layout → composants → polish) plutôt que chipotage atomique.
