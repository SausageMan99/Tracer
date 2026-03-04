# TrailForge — Business & Product Design

**Date :** 2026-03-04
**Status :** Validated
**Approach :** Mobile-First Reboot (Approche A)

---

## Vision

> TrailForge — Forge ton prochain parcours en 10 secondes.
> Le seul generateur de parcours GPS qui comprend ton sport, ton terrain et ton niveau.

### Le probleme

Tu veux courir ou rouler dehors, decouvrir de nouveaux endroits, te reconnecter a la nature. Mais avant ca, tu passes 15-20 minutes devant un ecran a tracer manuellement un parcours. C'est chiant, redondant, et l'oppose de ce que tu cherches.

### La promesse

TrailForge te libere de l'ecran. Un tap, 10 secondes, un parcours parfait adapte a ton entrainement du jour. Tu decouvres des chemins que tu n'aurais jamais trouves. Tu fermes l'app, tu sors, tu vis.

### Philosophie produit

- **Anti-screen time** : L'utilisateur passe <30 secondes dans l'app
- **Fait main / organique** : L'app incarne la reconnexion a la nature
- **Decouverte** : Chaque parcours est une aventure, pas une routine
- **Pas de gamification toxique** : Pas de feed infini, pas de notifications addictives

---

## Positionnement concurrentiel

| | Strava | Komoot | AllTrails | **TrailForge** |
|---|---|---|---|---|
| Generation auto | Cassee, limitee | Manuelle (waypoints) | 4 ajustements preset | **One-tap, 14 profils, scoring intelligent** |
| Multi-sport | Velo surtout | Velo + rando | Rando surtout | **Running + Velo (4 disciplines)** |
| Anti-repetition | Non | Non | Non | **Oui (via Strava import)** |
| Surface intelligence | Heatmap seul | Surface tags basiques | Donnees communautaires | **Scoring multi-criteres** |
| Prix | 80EUR/an | 60EUR/an | 80EUR/an (Peak) | **~50EUR/an** |

---

## Identite visuelle — Outdoor Organique

### Palette

- **Fond principal :** Blanc casse chaud (#F7F5F0)
- **Fond secondaire :** Sable clair (#EDE8DF)
- **Accents primaires :** Vert foret (#2D5F3E) + Vert sauge (#7FB08A)
- **Accents secondaires :** Terre cuite (#C17A3A), Ambre (#D4A843)
- **Texte :** Charbon (#1A1A1A)
- **Dark mode :** Fonds brun tres sombre (#1C1914), texte creme

### Typographie

- **Titres :** Serif elegant (Fraunces ou Lora)
- **Corps :** Sans-serif lisible (Inter ou DM Sans)
- **Data/metriques :** Monospace (JetBrains Mono)

### Elements visuels

- Formes arrondies, coins genereux (16-20px radius)
- Textures subtiles (grain, bruit) sur les fonds
- Illustrations topographiques comme elements decoratifs
- Icones en stroke fin, style organique
- Cartes avec style custom Mapbox terrain/outdoor
- Esthetique "carte IGN depliee sur le capot"

### Ton de voix

- Chaleureux, pas corporate
- "Un nouveau chemin t'attend" plutot que "Optimisez vos performances"
- Celebrer la decouverte : "Ce parcours passe par un sentier que seulement 3% des coureurs de ta zone ont emprunte"

---

## Architecture Produit — App iOS

### Plateforme

- **App :** iOS natif (Swift / SwiftUI)
- **Backend :** Next.js API ou Fastify standalone
- **Web :** Landing page marketing uniquement

### Flux principal (<30 secondes)

1. **Ouvrir** — "Qu'est-ce qu'on forge aujourd'hui ?"
2. **Choisir** — Sport, profil de seance, distance, D+ (~15s)
3. **Generer** — Animation organique topo (~10s)
4. **Resultat** — Carte, stats, discovery index, variantes, swipe
5. **Exporter** — GPX one-tap vers Garmin/Wahoo/Apple Watch → "Bonne sortie"

### Ecrans

| Ecran | Role | Temps passe vise |
|-------|------|-------------------|
| Home | Choix sport + profil + parametres | ~15 sec |
| Generation | Animation d'attente topo | ~10 sec |
| Resultat | Carte + stats + variantes + export | ~15 sec |
| Profil | Connexion Strava, preferences, historique | Occasionnel |
| Historique | Parcours generes passes, favoris | Occasionnel |
| Onboarding | Sport principal, niveau, connecter Strava | Une seule fois |

### Tiers de features

**Free (acquisition) :**

- 3 generations par mois
- 2 sports (Running + 1 velo au choix)
- 3 profils de seance
- Export GPX
- Carte avec trace basique

**Premium ~50EUR/an (conversion) :**

- Generations illimitees
- 4 sports, 14 profils
- Anti-repetition Strava (parcours jamais faits)
- Indice de decouverte
- 6 variantes par generation
- Profil d'elevation interactif
- Mode Scenic (heatmap perso Strava)
- Historique complet + favoris
- Style carte premium (terrain, satellite)

**Futur (pas au MVP) :**

- Apple Watch companion
- Partage de parcours entre amis
- "Surprise me" — generation 100% aleatoire
- Integration calendrier d'entrainement
- Randonnee (nouveau sport)
- Photos du parcours (Mapillary/Street View)
- Score beaute (donnees OSM nature)
- Apercu survol 3D du parcours

---

## Architecture Backend

### Vue d'ensemble

```
┌──────────────────────┐
│   API Gateway         │
│   (Next.js/Fastify)   │
└──────────┬───────────┘
           │
  ┌────────┴────────┐
  │                  │
┌─┴──────┐    ┌─────┴─────┐
│ Auth    │    │ Route      │
│ Service │    │ Engine     │
│         │    │            │
│ Apple   │    │ GraphHopper│
│ Sign-In │    │ ORS        │
│ Strava  │    │ Open-Meteo │
│ OAuth   │    │ Overpass+  │
│ JWT     │    │ Scoring    │
└─┬──────┘    └─────┬─────┘
  │                  │
┌─┴──────┐    ┌─────┴─────┐
│Database │    │ Post-      │
│(Supa-   │    │ processing │
│ base)   │    │            │
│         │    │ Anti-repet │
│ Users   │    │ Discovery  │
│ Routes  │    │ index      │
│Favorites│    │ OSM enrich │
│ Strava  │    │ Variantes  │
│ tokens  │    └───────────┘
└─────────┘
```

### Base de donnees (Supabase / PostgreSQL)

- Users (comptes, preferences, sport principal)
- Strava tokens (OAuth tokens chiffres)
- Generated routes (geometrie, scores, metadata)
- Favorites (parcours sauvegardes)
- Strava activities (cache des activites importees, polylines)
- Feedback (thumbs up/down)

### Auth

- Apple Sign-In (obligatoire iOS) + email
- Strava OAuth pour import historique activites
- JWT pour sessions API
- Refresh token Strava gere cote serveur

### Moteur de generation — Ameliorations

| Aspect | Actuel | Cible |
|--------|--------|-------|
| Routing engines | GraphHopper + ORS | Idem + fallback et retry |
| Elevation | Open-Meteo 30m | Open-Meteo + cache, batch requests |
| Heatmap | Proxy Go, heatmap globale (illegal) | **Heatmap perso via Strava API** |
| Anti-repetition | Inexistant | Comparaison geometrie vs activites Strava |
| Scoring | 4 criteres | 4 criteres + popularite perso + nouveaute |
| OSM enrichment | Tags basiques (highway, surface) | **Etendu : viewpoints, water, wood, sac_scale, mtb:scale, lit, smoothness** |
| Performance | ~10s, pas de cache | Cache geocoding + elevation, target <5s |
| Fiabilite | Pas de retry | Retry avec backoff, fallback entre engines |

### Strava — Heatmap personnelle uniquement

La Global Heatmap enfreint les CGU Strava pour usage commercial.
On utilise exclusivement les donnees personnelles de l'utilisateur via OAuth :

- Import `GET /athlete/activities` (polylines encodees)
- Decodage et stockage en base
- Calcul de densite : quels chemins l'utilisateur a deja empruntes
- Anti-repetition : comparer le parcours genere vs heatmap perso
- Discovery index : plus un segment est loin des activites passees, plus il score haut

### OSM — Enrichissement etendu

Requete Overpass dans un buffer ~200m autour du trace :

| Donnee OSM | Usage |
|---|---|
| `natural=water/wood/peak` | Score beaute, POI |
| `tourism=viewpoint` | "Vue panoramique au km 6" |
| `amenity=drinking_water/shelter` | Points d'eau, abris |
| `surface=*` | Scoring surface fin |
| `sac_scale` | Difficulte technique sentiers (T1-T6) |
| `mtb:scale` | Difficulte VTT (S0-S5) |
| `smoothness` | Etat de la chaussee |

### API v1

```
POST   /api/v1/auth/apple          # Apple Sign-In
POST   /api/v1/auth/strava         # Strava OAuth callback
GET    /api/v1/auth/me             # Profil utilisateur

POST   /api/v1/routes/generate     # Generer un parcours
GET    /api/v1/routes/:id          # Detail d'un parcours
GET    /api/v1/routes/history      # Historique
POST   /api/v1/routes/:id/favorite # Sauvegarder
POST   /api/v1/routes/:id/feedback # Thumbs up/down

GET    /api/v1/strava/sync         # Sync activites Strava
GET    /api/v1/strava/activities   # Activites cachees

GET    /api/v1/user/preferences    # Preferences
PUT    /api/v1/user/preferences    # Mettre a jour
```

### Infrastructure

- **API :** Vercel (Next.js) ou Railway/Fly.io
- **Database :** Supabase (PostgreSQL + auth helpers + RLS)
- **Cache :** Upstash Redis (geocoding, elevation, tiles)
- **Monitoring :** Sentry (errors) + Vercel Analytics (usage)

---

## Roadmap

### Phase 0 — Fondations (4-6 semaines)

- Refonte backend : Supabase, auth, API v1
- Migration du moteur de generation (cleanup, retry, cache)
- Strava OAuth + import activites + anti-repetition
- Enrichissement OSM (POI, surface, viewpoints)
- Suppression du proxy Go heatmap globale

### Phase 1 — App iOS MVP (6-8 semaines)

- Design system complet (Figma -> SwiftUI)
- Onboarding (sport, niveau, connexion Strava)
- Ecran Home (selecteur sport/profil/distance/D+)
- Ecran Generation (animation topo)
- Ecran Resultat (carte, stats, discovery index, variantes)
- Export GPX (Garmin, Wahoo, fichier)
- Profil + Historique + Favoris

### Phase 2 — Polish & Launch (3-4 semaines)

- Tests beta (TestFlight, 50-100 testeurs)
- Micro-interactions, haptics, transitions
- Performance (cold start <1s, generation <5s)
- App Store assets (screenshots, preview video, description)
- Refonte landing page web (vitrine marketing)
- Soumission App Store

### Phase 3 — Post-launch (continu)

- Iterations basees sur le feedback beta
- Photos du parcours, score beaute, "Surprise me"
- Randonnee (nouveau sport)
- Expansion Europe francophone
- Android

**Total MVP -> App Store : ~14-18 semaines**

---

## Go-to-Market — France

### Cible

Runners et cyclistes qui utilisent deja Strava, frustres par le route builder casse.

### Canaux d'acquisition

| Canal | Action | Cout |
|---|---|---|
| Strava clubs | Poster dans les clubs running FR, proposer la beta | Gratuit |
| Instagram/TikTok | Videos courtes "parcours en 10 secondes" | Gratuit |
| Reddit | Posts authentiques r/running, r/trailrunning | Gratuit |
| Clubs de course locaux | Partenariats, offrir Premium aux membres | ~gratuit |
| Createurs fitness FR | Envoyer l'app a 10-15 runners/cyclistes YT/Insta | Codes promo |
| App Store SEO | Keywords : parcours course, generateur itineraire, GPX running | Gratuit |
| Product Hunt | Launch day avec storytelling anti-screen time | Gratuit |

### Message marketing

> Tu passes plus de temps a tracer ton parcours qu'a courir ?
> TrailForge genere le parcours parfait en 10 secondes.
> Adapte a ton entrainement. Des chemins que tu n'as jamais pris.
> Ferme l'app, sors, decouvre.

### Metriques cles

| Metrique | Cible mois 1 | Cible mois 6 |
|---|---|---|
| Downloads | 500 | 5 000 |
| Free -> Premium | 5% | 8-10% |
| Retention J7 | 40% | 50% |
| Parcours generes / user / mois | 3 | 5+ |
| Note App Store | 4.5+ | 4.7+ |
| MRR | 125EUR | 2 000EUR |

### Modele economique — Projection 12 mois

**Conservateur :** 5 000 users x 8% = 400 abonnes x 50EUR = 20 000EUR ARR
**Optimiste :** 15 000 users x 10% = 1 500 abonnes x 50EUR = 75 000EUR ARR

**Couts serveur :** ~65EUR/mois (Supabase + Vercel + Upstash + Apple Dev)
**Marge brute :** >95%
