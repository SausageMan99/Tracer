# TrailForge

**Generateur de parcours GPS intelligent pour runners et cyclistes.**

---

## Sommaire

1. [Resume executif](#resume-executif)
2. [Le probleme](#le-probleme)
3. [La solution](#la-solution)
4. [Produit](#produit)
5. [Marche](#marche)
6. [Paysage concurrentiel](#paysage-concurrentiel)
7. [Modele economique](#modele-economique)
8. [Strategie go-to-market](#strategie-go-to-market)
9. [Roadmap produit](#roadmap-produit)
10. [Stack technique](#stack-technique)
11. [Metriques cles](#metriques-cles)
12. [Equipe](#equipe)
13. [Vision long terme](#vision-long-terme)

---

## Resume executif

TrailForge est une application iOS native qui genere des parcours GPS personnalises en moins de 10 secondes pour les coureurs et cyclistes. Un seul tap suffit : l'utilisateur choisit son sport, son type de seance et sa distance, et l'algorithme produit un parcours optimise, adapte a son programme d'entrainement et compose de chemins qu'il n'a jamais empruntes.

Dans un marche ou Strava (180M d'utilisateurs) propose un route builder unanimement critique comme "inutilisable", ou Komoot exige un tracage manuel par waypoints, et ou AllTrails se limite a la randonnee, TrailForge est le seul outil qui resout le probleme de la generation automatique multi-sport avec intelligence de terrain.

**Marche cible initial :** France (32% de la population pratique la course a pied, 18% le velo).

**Modele :** Freemium + abonnement Premium a ~50EUR/an.

**Statut :** Prototype web fonctionnel avec moteur de generation operationnel. Phase suivante : refonte backend + app iOS native.

---

## Le probleme

### Le quotidien du sportif outdoor

Chaque semaine, des millions de coureurs et cyclistes font face au meme scenario :

1. **Ils ouvrent une app de cartographie** (Strava, Komoot, Google Maps)
2. **Ils passent 15 a 20 minutes** a tracer manuellement un parcours sur une carte
3. **Ils verifient** le denivele, la surface, la distance — ajustent — re-verifient
4. **Ils finissent souvent** par refaire un parcours qu'ils connaissent deja, par manque de temps ou d'inspiration

Ce processus est :

- **Chronophage** — 15-20 min a chaque sortie, soit 13-17 heures par an pour quelqu'un qui s'entraine 4x/semaine
- **Redondant** — Les memes routes, les memes chemins, encore et encore
- **Paradoxal** — L'objectif est de se retrouver dehors, dans la nature, deconnecte des ecrans. Mais avant ca, il faut passer du temps... devant un ecran
- **Non adapte a l'entrainement** — Les planificateurs de parcours ne comprennent pas la difference entre un fractionne et une sortie longue. Un fractionne a besoin de plat, une sortie longue peut integrer du denivele

### Un besoin reel et non satisfait

Ce n'est pas un probleme de niche. C'est le quotidien de :

- **50 millions** d'utilisateurs actifs mensuels sur Strava
- **80 millions** d'utilisateurs inscrits sur AllTrails
- **50 millions** d'utilisateurs inscrits sur Komoot

La frustration est documentee : le forum Strava compte des centaines de threads intitules "Route planner is unusable", "Route builder broken for long routes", "Please fix the route suggestions". Komoot a perdu une part significative de sa communaute en fevrier 2025 apres un changement de pricing agressif.

**Il existe un vide reel dans le marche pour un outil qui genere des parcours automatiquement, intelligemment, et rapidement.**

---

## La solution

### TrailForge : "Forge ton parcours en 10 secondes"

TrailForge elimine la friction entre l'envie de sortir et la sortie elle-meme.

**Un tap. 10 secondes. Un parcours parfait.**

L'utilisateur :
1. Choisit son sport (course, velo route, gravel, VTT)
2. Selectionne son type de seance (endurance, seuil, fractionne, sortie longue, recuperation...)
3. Ajuste la distance et le denivele souhaites
4. Appuie sur "Generer"

En 10 secondes, TrailForge produit 6 variantes de parcours, classees par score de qualite, avec :

- **Adaptation a la seance** — Un fractionne privilegie le plat et le bitume. Une sortie longue integre du denivele et des sentiers. Un entrainement gravel evite les routes principales.
- **Decouverte garantie** — Grace a l'import des activites Strava de l'utilisateur, chaque parcours est compare a son historique. L'indice de decouverte indique le pourcentage de chemins jamais empruntes.
- **Intelligence de terrain** — Analyse des donnees OpenStreetMap : type de surface, denivele par segment, points de vue, forets, cours d'eau, points d'eau potable.
- **Export instantane** — Un tap pour envoyer le GPX vers sa montre Garmin, son compteur Wahoo ou son Apple Watch.

### La philosophie : anti-screen time

TrailForge n'est pas une app dans laquelle on passe du temps. C'est une app qu'on ouvre, qu'on utilise en 30 secondes, et qu'on ferme. Pas de feed infini. Pas de notifications addictives. Pas de gamification toxique.

L'objectif est de remettre les gens dehors, dans la nature, sur des chemins qu'ils n'auraient jamais decouverts seuls. L'app est un outil, pas une destination.

---

## Produit

### Plateforme

- **App iOS native** (Swift / SwiftUI) — Le produit principal
- **Site web** — Landing page marketing et vitrine (Next.js)
- **API backend** — Moteur de generation partage (Next.js / Supabase)

### Experience utilisateur

L'experience est concue pour durer moins de 30 secondes :

| Etape | Ecran | Temps |
|-------|-------|-------|
| Choisir son sport et sa seance | Home | ~10 sec |
| Ajuster distance et D+ | Home | ~5 sec |
| Generer | Animation | ~10 sec |
| Voir le resultat, choisir une variante, exporter | Resultat | ~10 sec |

### Fonctionnalites

#### Incluses dans la version gratuite

- 3 generations de parcours par mois
- 2 sports au choix (course a pied + 1 discipline velo)
- 3 profils de seance
- Export GPX
- Carte avec trace

#### Incluses dans la version Premium (~50EUR/an)

- Generations illimitees
- 4 sports, 14 profils de seance specialises
- **Anti-repetition** — Ne genere que des parcours avec des chemins jamais empruntes (necessite Strava)
- **Indice de decouverte** — Pourcentage de nouveaute du parcours
- 6 variantes par generation avec scoring detaille
- Profil d'elevation interactif avec coloration par pente
- Mode Scenic (privilegie les chemins populaires et naturels)
- Historique complet et favoris
- Style de carte premium (terrain, satellite)

#### Fonctionnalites futures (post-lancement)

- **Apercu visuel du parcours** — Photos le long du trace (Mapillary, Street View) pour se projeter avant de sortir
- **Score de beaute** — Indice base sur la densite de forets, proximite de cours d'eau, points de vue
- **Survol 3D** — Animation de survol du parcours type Google Earth
- **"Surprise me"** — Generation 100% aleatoire dans un rayon
- **Apple Watch companion** — Generer un parcours depuis sa montre
- **Randonnee** — Nouveau sport avec ses propres profils
- **Partage entre amis** — Envoyer un parcours a un partenaire d'entrainement
- **Integration calendrier d'entrainement** — Synchronisation avec les plans d'entrainement

### Les 14 profils de seance

TrailForge comprend 14 profils d'entrainement repartis sur 4 sports, chacun avec ses propres parametres de scoring :

**Course a pied (5 profils) :**
- Endurance — Allure moderee, distance moyenne, terrain mixte
- Seuil lactique — Allure soutenue, terrain plat, surface dure
- Fractionne 30/30 — Court, plat, surface reguliere
- Sortie longue — Grande distance, denivele modere, decouverte
- Recuperation — Court, plat, facile

**Velo route (5 profils) :**
- Endurance, Seuil, Fractionne, Gran Fondo, Recuperation

**Gravel (2 profils) :**
- Exploration, Entrainement

**VTT (2 profils) :**
- Cross-country, All-mountain

Chaque profil definit :
- Une plage de distance (min / defaut / max)
- Une plage de denivele (min / defaut / max)
- Des poids de scoring (elevation, distance, surface, boucle)
- Le moteur de routage a utiliser

---

## Marche

### Taille du marche

**Marche global des apps fitness :** 13,9 milliards USD en 2026, projection a 33,6 milliards USD en 2033 (CAGR 13,4%).

**Marche adressable (route planning + outdoor fitness) :**
Les bases d'utilisateurs combinees des principales plateformes (Strava 180M, AllTrails 80M, Komoot 50M, MapMyRun 45M) totalisent environ 355 millions de comptes. Meme avec un taux de conversion conservateur de 1% a 50EUR/an, cela represente un marche de 177 millions EUR annuels.

**Marche cible initial — France :**
- 32% des Francais pratiquent la course a pied (21 millions)
- 18% pratiquent le velo (12 millions)
- Le marche francais du fitness digital est estime a 800 millions EUR en 2026
- Strava compte environ 1,2-1,3 million d'utilisateurs actifs mensuels en France

### Tendances favorables

1. **Boom du running Gen Z** — Strava rapporte une croissance de 80% des telechargements en 2025, portee par les clubs de course et le running social
2. **Lassitude du digital** — Tendance de fond au "retour au reel", a la nature, au fait-main. Les utilisateurs recherchent des outils qui les deconnectent, pas qui les retiennent
3. **Monetisation croissante** — Les utilisateurs acceptent de payer pour des apps de qualite (Strava a 80EUR/an, AllTrails a 80EUR/an, Komoot a 60EUR/an)
4. **Insatisfaction des leaders** — Strava route builder critique, Komoot pricing backlash, AllTrails limite a la randonnee

### Segments cibles

**Segment primaire : Le runner regulier (3-5 sorties/semaine)**
- Suit un plan d'entrainement
- Utilise Strava pour tracker ses sorties
- Possede une montre GPS (Garmin, Apple Watch)
- Frustre de toujours courir les memes parcours
- Age : 25-45 ans

**Segment secondaire : Le cycliste route/gravel**
- Planifie ses sorties a l'avance
- Utilise un compteur GPS (Wahoo, Garmin)
- Recherche des routes peu frequentees et sceniques
- Age : 30-50 ans

---

## Paysage concurrentiel

### Analyse des concurrents directs

#### Strava Routes (~80EUR/an)
- **Forces :** 180M d'utilisateurs, heatmap globale massive, effets de reseau
- **Faiblesses :** Route builder unanimement critique comme casse et inutilisable. Suggestions limitees et souvent incoherentes. Strava est un reseau social d'abord, pas un outil de planification.
- **Opportunite TrailForge :** Les utilisateurs Strava sont notre cible #1. Ils ont deja un compte, ils trackent deja, ils veulent juste de meilleurs parcours.

#### Komoot (~60EUR/an)
- **Forces :** Bonne couverture europeenne, donnees de surface, navigation turn-by-turn
- **Faiblesses :** Pas de generation automatique — tout est manuel par waypoints. Changement de pricing en fevrier 2025 a provoque un backlash massif. Acquisition et licenciements en 2024 soulvent des doutes sur la direction.
- **Opportunite TrailForge :** Komoot est lent et manuel. TrailForge est instantane et automatique.

#### AllTrails (~80EUR/an pour Peak)
- **Forces :** 80M d'utilisateurs, base de donnees de 400 000 sentiers, AI Smart Routes (mai 2025)
- **Faiblesses :** Centre sur la randonnee. Course et velo sont des use cases secondaires. AI limitee a 4 ajustements preset (inverser, raccourcir, reduire D+, scenic). Faible en zone urbaine.
- **Opportunite TrailForge :** AllTrails ne comprend pas l'entrainement sportif. TrailForge comprend la difference entre un fractionne et une sortie longue.

#### Ride with GPS (~10USD/mois)
- **Forces :** Meilleur editeur de route manuel du marche, communaute cycliste fidele
- **Faiblesses :** Pas de generation automatique. Courbe d'apprentissage elevee. Presque exclusivement cyclisme. Inconnu du grand public.
- **Opportunite TrailForge :** Ride with GPS est un outil d'expert. TrailForge est un outil grand public.

#### Garmin Connect+ (~70EUR/an)
- **Forces :** 40% du marche des montres GPS, generation round-trip sur les montres haut de gamme
- **Faiblesses :** Verrouille dans l'ecosysteme Garmin. Inutile sans montre Garmin. Generation basique sans intelligence de seance.
- **Opportunite TrailForge :** TrailForge fonctionne avec n'importe quelle montre (export GPX universel).

### Matrice de positionnement

```
                    Generation automatique
                           ↑
                           |
                  TrailForge ★
                           |
       AllTrails AI ·      |
                           |
  Garmin round-trip ·      |
                           |
   plotaroute ·            |
                           |
  ─────────────────────────┼──────────────────────→
  Mono-sport               |              Multi-sport
                           |
              Komoot ·     |
                           |
        Ride w/ GPS ·      |
                           |
           Strava ·        |
                           |
                    Generation manuelle
```

### Avantages concurrentiels durables

1. **Moteur de generation multi-sport** — Aucun concurrent ne fait de la generation automatique de qualite pour la course ET le velo avec des profils d'entrainement specifiques
2. **Anti-repetition** — Innovation unique : garantir que chaque parcours contient des chemins jamais empruntes
3. **Intelligence de seance** — L'algo comprend qu'un fractionne ≠ une sortie longue et adapte le terrain, la surface et le denivele en consequence
4. **Philosophie anti-screen time** — Positionnement emotionnel differentiant dans un marche ou tous les concurrents cherchent a maximiser le temps passe dans l'app
5. **Enrichissement OSM avance** — Points de vue, forets, lacs, points d'eau — le parcours "donne envie" avant meme de sortir

---

## Modele economique

### Structure de prix

| Tier | Prix | Contenu |
|------|------|---------|
| **Free** | 0 EUR | 3 generations/mois, 2 sports, 3 profils, export GPX basique |
| **Premium** | 4,99 EUR/mois ou 49,99 EUR/an | Illimite, 4 sports, 14 profils, anti-repetition, discovery index, 6 variantes, historique, carte premium |

**Positionnement prix :** 20-40% moins cher que Strava (80EUR) et AllTrails Peak (80EUR), tout en offrant une proposition de valeur unique et ciblee.

### Projections financieres

#### Hypothese conservatrice (12 mois post-lancement)

| Metrique | Valeur |
|----------|--------|
| Telechargements cumules | 5 000 |
| Utilisateurs actifs mensuels | 2 000 |
| Abonnes Premium | 400 (taux de conversion 8%) |
| ARR (Annual Recurring Revenue) | 20 000 EUR |
| MRR (Monthly Recurring Revenue) | 1 667 EUR |

#### Hypothese optimiste (12 mois post-lancement)

| Metrique | Valeur |
|----------|--------|
| Telechargements cumules | 15 000 |
| Utilisateurs actifs mensuels | 6 000 |
| Abonnes Premium | 1 500 (taux de conversion 10%) |
| ARR | 75 000 EUR |
| MRR | 6 250 EUR |

### Structure de couts

| Poste | Cout mensuel | Cout annuel |
|-------|-------------|-------------|
| Supabase Pro (PostgreSQL) | 25 EUR | 300 EUR |
| Vercel Pro (API hosting) | 20 EUR | 240 EUR |
| Upstash Redis (cache) | 10 EUR | 120 EUR |
| Apple Developer Program | 8 EUR | 99 EUR |
| Sentry (monitoring) | 0 EUR | 0 EUR (tier gratuit) |
| Domaine + email | 5 EUR | 60 EUR |
| **Total** | **~68 EUR** | **~819 EUR** |

**Marge brute : >95%** — Les couts d'infrastructure sont marginaux grace a l'utilisation d'APIs gratuites (OpenStreetMap, Open-Meteo, Nominatim) et de services managés a bas cout.

### Commission Apple App Store

Apple preleve 30% sur les abonnements la premiere annee, puis 15% a partir de la deuxieme annee (Small Business Program pour les revenus <1M USD).

| Scenario | ARR brut | Commission Apple | ARR net |
|----------|----------|-----------------|---------|
| Conservateur | 20 000 EUR | -6 000 EUR (30%) | 14 000 EUR |
| Optimiste | 75 000 EUR | -22 500 EUR (30%) | 52 500 EUR |

---

## Strategie go-to-market

### Phase 1 : Communaute (pre-lancement)

**Objectif :** Constituer une liste d'attente de 500 beta testeurs avant le lancement App Store.

| Action | Canal | Timing |
|--------|-------|--------|
| Page "Coming Soon" sur trailforge.app | Web | Mois -3 |
| Posts dans les clubs Strava running francais | Strava | Mois -2 |
| Thread de presentation sur r/running et r/courseapied | Reddit | Mois -2 |
| Teaser video "parcours en 10 secondes" | Instagram, TikTok | Mois -1 |
| Beta fermee TestFlight (50-100 testeurs) | TestFlight | Mois -1 |

### Phase 2 : Lancement (mois 0)

| Action | Canal | Timing |
|--------|-------|--------|
| Lancement App Store avec ASO optimise | App Store | Jour 0 |
| Product Hunt launch | Product Hunt | Jour 0 |
| Envoi app a 10-15 createurs fitness FR | YouTube, Instagram | Semaine 1 |
| Partenariats clubs de course locaux | Terrain | Semaine 2-4 |
| Codes promo pour les premiers adopteurs | Tous | Mois 1 |

### Phase 3 : Croissance organique (mois 1-6)

| Action | Canal | Timing |
|--------|-------|--------|
| Contenu regulier (videos de parcours generes) | TikTok, Instagram Reels | Hebdomadaire |
| SEO App Store (keywords francais) | App Store | Continu |
| Referral program (invite un ami → 1 mois Premium gratuit) | In-app | Mois 2 |
| Partenariats marques running (Hoka, Salomon, Decathlon) | Partenariats | Mois 3-6 |
| Articles presse specialisee (Runners World FR, Velo Magazine) | Presse | Mois 3-6 |

### Message marketing principal

> **"Tu passes plus de temps a tracer ton parcours qu'a courir ?"**
>
> TrailForge genere le parcours parfait en 10 secondes.
> Adapte a ton entrainement. Des chemins que tu n'as jamais pris.
> Ferme l'app, sors, decouvre.

### Messages secondaires

- *"87% de chemins que tu n'as jamais empruntes"* — Anti-repetition
- *"Ton fractionne merite mieux qu'un aller-retour"* — Intelligence de seance
- *"L'app que tu fermes avant de courir"* — Anti-screen time
- *"Forge, exporte, cours"* — Simplicite

---

## Roadmap produit

### Phase 0 — Fondations backend (4-6 semaines)
> Transformer le prototype en infrastructure production-grade.

- Base de donnees PostgreSQL (Supabase) avec authentification
- Integration Strava OAuth + import d'activites personnelles
- Moteur anti-repetition (comparaison de polylines)
- Enrichissement OSM etendu (points de vue, forets, lacs, points d'eau)
- API v1 documentee (auth, routes, favoris, feedback, preferences)
- Cache Redis pour les performances
- Retry et fallback sur toutes les APIs externes
- Suppression du proxy heatmap Strava globale (non conforme aux CGU)

### Phase 1 — App iOS MVP (6-8 semaines)
> Construire l'app native avec une experience premium.

- Design system complet (palette organique, typographie, composants SwiftUI)
- Onboarding (sport, niveau, connexion Strava)
- Ecran Home (selecteur sport/profil/distance/D+)
- Ecran Generation (animation topographique)
- Ecran Resultat (carte MapKit, stats, discovery index, 6 variantes, elevation)
- Export GPX (Garmin, Wahoo, Apple Watch, fichier)
- Ecrans Profil, Historique, Favoris
- Gestion des abonnements (StoreKit 2)

### Phase 2 — Polish et lancement (3-4 semaines)
> Atteindre le niveau de qualite App Store.

- Beta TestFlight (50-100 testeurs)
- Micro-interactions, haptics, transitions fluides
- Optimisation performance (cold start <1s, generation <5s)
- Assets App Store (screenshots, video preview, description ASO)
- Refonte landing page web (vitrine marketing)
- Soumission et validation App Store

### Phase 3 — Post-lancement (continu)
> Iterer et etendre.

- Iterations sur le feedback des utilisateurs
- Apercu visuel des parcours (photos, score beaute)
- "Surprise me" — generation aleatoire
- Randonnee (nouveau sport)
- Expansion marche francophone (Belgique, Suisse)
- App Android (evaluation React Native vs Kotlin natif)

**Timeline totale MVP → App Store : ~14-18 semaines**

---

## Stack technique

### Frontend (App iOS)

| Technologie | Role |
|-------------|------|
| Swift 5.9+ | Langage principal |
| SwiftUI | Framework UI |
| MapKit / Mapbox iOS SDK | Cartographie |
| StoreKit 2 | Abonnements in-app |
| Sign in with Apple | Authentification |
| Core Location | Geolocalisation |

### Backend (API)

| Technologie | Role |
|-------------|------|
| Next.js 15 (Node.js) | API Gateway |
| TypeScript 5 | Langage backend |
| Supabase | Base de donnees PostgreSQL + Auth |
| Upstash Redis | Cache (geocoding, elevation, graphs) |
| Vitest | Tests unitaires et integration |

### APIs externes (gratuites)

| API | Role | Cout |
|-----|------|------|
| OpenStreetMap / Overpass | Donnees terrain, surface, POI | Gratuit |
| Nominatim | Geocodage d'adresses | Gratuit |
| Open-Meteo | Donnees d'elevation (resolution 30m) | Gratuit |
| GraphHopper | Routing course a pied | Gratuit (tier libre) |
| OpenRouteService | Routing velo (route, gravel, MTB) | Gratuit (tier libre) |
| Strava API v3 | Import activites personnelles (OAuth) | Gratuit |

### Infrastructure

| Service | Role | Cout |
|---------|------|------|
| Vercel | Hosting API + landing page | ~20 EUR/mois |
| Supabase | PostgreSQL + Auth + Storage | ~25 EUR/mois |
| Upstash | Redis cache | ~10 EUR/mois |
| Sentry | Monitoring erreurs | Gratuit |
| Apple Developer Program | Distribution App Store | 99 EUR/an |

### Architecture simplifiee

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│              │     │                  │     │              │
│  App iOS     │────▶│  API Backend     │────▶│  Supabase    │
│  (Swift)     │     │  (Next.js)       │     │  (PostgreSQL)│
│              │     │                  │     │              │
└──────────────┘     └────────┬─────────┘     └──────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
              ┌─────┴─────┐     ┌──────┴──────┐
              │ Route      │     │ Strava      │
              │ Engine     │     │ API v3      │
              │            │     │             │
              │ GraphHopper│     │ Activities  │
              │ ORS        │     │ OAuth       │
              │ Open-Meteo │     └─────────────┘
              │ Overpass   │
              └────────────┘
```

---

## Metriques cles

### Metriques produit

| Metrique | Definition | Cible |
|----------|-----------|-------|
| **Time to first route** | Temps entre l'ouverture de l'app et la premiere generation | <30 sec |
| **Temps de generation** | Duree de generation d'un parcours | <10 sec |
| **Parcours/user/mois** | Nombre moyen de generations par utilisateur actif | 5+ |
| **Discovery index moyen** | Pourcentage de nouveaute des parcours generes | >60% |
| **Taux d'export GPX** | Pourcentage de parcours generes qui sont exportes | >50% |

### Metriques business

| Metrique | Definition | Cible mois 1 | Cible mois 6 | Cible mois 12 |
|----------|-----------|-------------|-------------|-------------|
| **Downloads** | Telechargements cumules | 500 | 3 000 | 5 000-15 000 |
| **MAU** | Utilisateurs actifs mensuels | 200 | 1 200 | 2 000-6 000 |
| **Conversion Free→Premium** | Taux de conversion | 5% | 8% | 8-10% |
| **Retention J7** | Utilisateurs actifs 7j apres install | 40% | 45% | 50% |
| **Retention J30** | Utilisateurs actifs 30j apres install | 20% | 25% | 30% |
| **Note App Store** | Moyenne des avis | 4.5 | 4.6 | 4.7+ |
| **MRR** | Revenu mensuel recurrent | 125 EUR | 1 000 EUR | 1 667-6 250 EUR |
| **Churn mensuel** | Taux de desabonnement | <8% | <6% | <5% |

---

## Equipe

*A completer.*

| Role | Nom | Expertise |
|------|-----|-----------|
| Fondateur & Developpeur | | Full-stack, algorithms, product |
| | | |

---

## Vision long terme

### Annee 1 : Prouver le produit (France)

Lancer l'app iOS, atteindre 5 000-15 000 utilisateurs, valider le product-market fit, atteindre un ARR de 20 000-75 000 EUR. Demontrer que la generation automatique de parcours est superieure a la planification manuelle.

### Annee 2 : Etendre (Europe francophone + features)

- Expansion Belgique, Suisse, Luxembourg
- App Android
- Randonnee comme nouveau sport
- Apple Watch companion
- Apercu visuel des parcours (photos, survol 3D)
- Partenariats avec des marques sport (Salomon, Hoka, Decathlon)
- Objectif : 50 000 utilisateurs, 300 000 EUR ARR

### Annee 3 : Echelle (Europe + intelligence)

- Expansion UK, Allemagne, Espagne, Italie
- IA conversationnelle : "Donne-moi un 15km avec 300m de D+, surtout des sentiers, que je n'ai jamais fait, avec un point de vue"
- Apprentissage des preferences : l'algo s'ameliore avec chaque feedback utilisateur
- Communaute : partage de parcours, challenges de decouverte
- Heatmap communautaire TrailForge (agregation des parcours generes)
- Objectif : 200 000 utilisateurs, 1M EUR ARR

### La vision ultime

> **TrailForge devient le Spotify des parcours outdoor.**
>
> Comme Spotify a remplace la creation manuelle de playlists par des recommandations intelligentes et personnalisees, TrailForge remplace le tracage manuel de parcours par une generation intelligente qui comprend tes gouts, ton niveau, et ton envie de decouverte.
>
> Tu n'as plus jamais besoin de tracer un parcours. Tu ouvres l'app, tu appuies, tu sors. Et chaque sortie est une decouverte.

---

*Document mis a jour le 4 mars 2026.*
*TrailForge — Forge ton prochain parcours.*
