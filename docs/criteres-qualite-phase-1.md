# TrailForge — Critères qualité minimum Phase 1
> CTO / Route Engine senior — version MVP crédible

## 1. Vision

TrailForge génère des boucles GPS pour course/trail. La confiance est le produit. Un seul trajet raté (trop court, dangereux, sur route) détruit la crédibilité. Phase 1 = définir ce qu'est une **route réussie** et s'y tenir.

---

## 2. Dimensions qualité & seuils MVP

| Dimension | Ce qu'on mesure | Seuil MVP | Pourquoi |
|---|---|---|---|
| **Distance** | Écart vs distance demandée (`distanceErrorPct`) | ≤ 20% (idéal ≤ 8%) | Un coureur demande 10 km ; recevoir 7 km = échec |
| **D+** | Écart vs dénivelé demandé (`elevationErrorPct`) | ≤ 45% pour D+ > 0 | Promettre 250m et livrer 80m = tricherie terrain |
| **Fermeture boucle** | Gap entre point de départ et fin (`loopGapKm`) | ≤ 0,5 km (idéal ≤ 0,3 km) | Demi-boucle = GPS watch refuse ou route chaotique |
| **Proportion sentiers/nature** | Ratio de tracé sur sentiers/forêts (`trailRatio`) | ≥ 25% en mode scenic, ≥ 35% en trail | TrailForge ne vaut que si on échappe au bitume |
| **Sécurité** | Grands axes/fréquentés (`busyRoadRatio`) | ≤ 12% sur running, ≤ 8% sur trail/VTT | Sécurité > distance. Un passage sur périphérique = 0 |
| **Intégrité sens unique** | Violations sens interdit (`onewayViolationRatio`) | **0** | Lethal pour vélo. Si > 0 = blocage immédiat |
| **Répétition** | Tronçons parcourus > 1 fois (`repeatEdgeRatio`) | ≤ 8% | A/R non demandé = tracé laid et frustrant |
| **Score production** | Score composite global (`productionScore`) | ≥ 0,68 (idéal ≥ 0,72) | Alerteur global. Si < 0,68, la route ne part pas |

### Seuils spécifiques trail (sessionType = "trail")

| Critère | Seuil MVP |
|---|---|
| `trailRatio` | ≥ 35% |
| `pavedRatio` | ≤ 45% (idéal ≤ 35%) |
| `busiestRoadRatio` | ≤ 8% |
| `longestTrailSegmentKm` | ≥ 3 km pour distances > 8 km |
| `naturalCorridorRatio` | ≥ 0,50 |
| `trailBeautyScore` | ≥ 0,55 (idéal ≥ 0,65) |

---

## 3. Messages d'erreur / compromis (FR utilisateur)

Quand la route dépasse les seuils, TrailForge ne ment pas. Elle expose les compromises.

| Code interne | Message utilisateur (FR) | Sévérité |
|---|---|---|
| `DISTANCE_OFF_TARGET` | "Distance ajustée" | Info si ≤ 20%, Warning si > 20% |
| `ELEVATION_OFF_TARGET` | "Dénivelé ajusté" | Info si ≤ 45%, Warning si > 45% |
| `LOOP_NOT_CLOSED` | "Boucle imparfaite" | Warning si > 0,3 km |
| `TOO_MUCH_BUSY_ROAD` | "Trop de grands axes" | Warning |
| `ONEWAY_VIOLATION` | "Sécurité : sens interdit détecté" | **Erreur bloquante** |
| `TOO_MUCH_BACKTRACKING` | "Trop de répétitions" | Warning |
| `NOT_ENOUGH_TRAIL` | "Peu de sentiers par ici" | Warning (trail uniquement) |
| `TOO_MUCH_PAVEMENT` | "Trop de bitume pour du trail" | Warning (trail uniquement) |
| `TRAIL_TOO_FRAGMENTED` | "Sentiers fragmentés" | Warning (trail uniquement) |
| `RESTRICTED_ACCESS` | "Passage restreint détecté" | Warning |

### Règle d'or
- **≤ 2 warnings** = route acceptable avec disclaimer
- **≥ 3 warnings** ou **1 erreur bloquante** = refus ou proposition alternative (ex: "Pas assez de sentiers à proximité. Générer en mode route urbaine ?")

---

## 4. Export GPX — exigences minimum

| Exigence | Seuil MVP |
|---|---|
| Format GPX 1.1 valide | Pass xsd/schematron basique |
| Distance totale dans `<metadata>` ou `<trk>` | ± 2% vs mesure interne |
| D+ total dans commentaire ou `<extensions>` | Présent, pas vide |
| Timestamp par point | Oui (même fictif si besoin) |
| Nom du fichier | `trailforge_{ville}_{distance}km.gpx` |
| Compatible Garmin/Wahoo/COROS/Suunto/Strava | Test manuel sur 2 appareils |

---

## 5. Instrumentation minimale (observabilité)

Pour apprendre et diagnostiquer, TrailForge Phase 1 doit collecter :

| Métrique | Où | But |
|---|---|---|
| Taux de succès V2 (200 OK) | API logs | Fiabilité moteur |
| Taux de routes refusées par quality gates | API logs | Où le moteur faiblit |
| Temps de génération par étape | Logs : geocode / Overpass / solver / post-process / GPX | Identifier le bottleneck |
| Distribution `distanceErrorPct`, `elevationErrorPct`, `productionScore` | Logs / dashboard | Tendance qualité |
| Taux de `ONEWAY_VIOLATION`, `TOO_MUCH_BUSY_ROAD` | Logs | Sécurité |
| Feedback utilisateur (good/average/bad + raisons enum) | DB | Dataset d'amélioration |

### Minimum technique
- Un `console.log` structuré par requête avec : `requestId`, `profile`, `targetDistance`, `targetElevation`, `durationMs`, `success`, `qualityWarnings[]`, `productionScore`.
- Stockage feedback en DB (pas JSON local) dès le 1er utilisateur externe.

---

## 6. Benchmark de non-régression (Phase 1)

8 cas critiques. `npm run benchmark:routes` doit passer avant tout push moteur.

| Cas | Id | Pourquoi |
|---|---|---|
| Lille Citadelle 10k | `lille-10k-citadel-loop` | Reddit critique : short routes |
| Paris 19e canal 10k | `paris-19-canal-running` | Urbain dense + nature |
| Paris centre 5k | `paris-centre-5k-safety` | Zone très dense, sécurité |
| Dijon vallon 12k | `dijon-hilly-running` | D+ réaliste |
| Nanterre est 10k | `nanterre-east-avoid-highways` | Blocage axes rapides |
| Rennes → Saint-Malo 70k | `rennes-saint-malo-road-bike` | Vélo route long (branch externe OK) |
| Meudon VTT 40k | `mtb-40k-oneway-safety` | VTT + one-way critique |
| Fontainebleau trail 15k | `fontainebleau-trail-15k` | Trail pur, corridoors forestiers |

Règle : **1 benchmark rouge = pas de push**. On diagnostique ou on documente la régression.

---

## 7. Stratégie de compromis acceptable

Phase 1 = accessible. On accepte les ajustements si expliqués.

| Situation | Comportement MVP |
|---|---|
| Zone sans sentiers en mode trail | Warning + proposition route running "nature" ou urbain calme |
| Distance impossible (graphe trop petit) | Générer la meilleure boucle possible + "Distance ajustée à X km" |
| D+ impossible en zone plate | Warning + génération D+ minimal |
| Timeout Overpass (dense urbain) | Retry 1x, sinon message : "Zone dense : essayer un peu plus loin ?" |
| Long vélo/VTT sans clé externe | Refus clair : "Grands parcours bientôt disponibles" |

---

## 8. Résumé exécutif

Phase 1 crédible = **distance fiable, boucle fermée, peu de bitume, zero danger, GPX propre, feedback visible**.

Les 3 indicateurs clés à afficher à l'utilisateur :
1. **Distance réelle** vs demandée
2. **Qualité terrain** (ratio sentiers / avertissements)
3. **Sécurité** (one-way, grands axes)

Le reste (IA, features, social) attend que ces fondations soient vertes sur les 8 benchmarks.

---

*Document : `docs/criteres-qualite-phase-1.md`*
