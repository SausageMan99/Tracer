# TrailForge — document source pour pitch deck

Date : 2026-05-18  
Objectif : document de référence à transformer en pitch deck investisseur / concours / présentation produit.

---

## 1. Résumé exécutif

TrailForge est un générateur de parcours GPS pour runners, traileurs et cyclistes. L’idée est simple : l’utilisateur choisit un sport, une distance, un type de sortie et un niveau d’exigence terrain ; TrailForge génère une boucle exploitable, exportable en GPX, adaptée au terrain réel autour de lui.

Le problème que l’on attaque n’est pas le tracking sportif. Strava, Garmin, Apple ou Wahoo savent déjà très bien enregistrer une activité. Le problème est l’avant-sortie : trouver un bon parcours prend trop de temps, demande de connaître le terrain, oblige à bricoler des waypoints sur Komoot ou Strava, et finit souvent par produire les mêmes boucles répétées.

La vision de TrailForge : devenir le moteur personnel de découverte outdoor. L’utilisateur n’a plus besoin de tracer manuellement ses parcours. Il ouvre l’app, indique son intention, reçoit une proposition honnête, comprend les compromis, exporte vers sa montre, puis sort courir ou rouler.

La différence clé : TrailForge ne se positionne pas comme une carte, un réseau social ou une bibliothèque de randonnées. TrailForge est un moteur de génération. Là où les concurrents aident surtout à chercher ou éditer un itinéraire, TrailForge décide, compose, vérifie et explique un parcours.

La technologie centrale est le moteur V3 : une architecture de génération de route orientée intention. Il combine OpenStreetMap, audit terrain, classification de surfaces, contraintes sportives, solveur de boucle, quality gates et feedback utilisateur. Sa promesse n’est pas de toujours dire oui ; sa promesse est de produire une route honnête : générée, ajustée ou refusée clairement.

---

## 2. Le problème

Les sportifs outdoor ont déjà des montres, des apps de tracking et des plateformes sociales. Pourtant, préparer une sortie reste anormalement pénible.

Un runner régulier qui veut varier ses sorties doit souvent ouvrir Strava, Komoot, Google Maps, Garmin Connect ou OpenRunner, chercher des chemins, vérifier la distance, ajuster le dénivelé, éviter les grands axes, s’assurer que la boucle ferme correctement, puis exporter le GPX. Ce processus peut prendre 10 à 20 minutes pour une seule sortie.

Le paradoxe est fort : l’objectif est de passer moins de temps devant un écran et plus de temps dehors, mais la préparation impose justement une session de cartographie manuelle. Beaucoup de sportifs finissent donc par refaire les mêmes parcours, pas parce qu’ils manquent d’envie, mais parce que la découverte demande trop d’effort.

Le problème est encore plus visible en trail, gravel ou running nature. Une bonne route ne se résume pas à une distance. Elle doit tenir compte de la surface, du type de chemin, du bruit routier, du relief, de la sécurité, de la continuité naturelle, de l’accès au terrain, et du fait qu’une route “scenic” goudronnée n’est pas forcément une route trail.

Ce que les utilisateurs veulent réellement : une réponse rapide à une intention concrète. Par exemple : “je veux 8 km depuis ici, plutôt chemins, pas trop de route, une vraie boucle, exportable sur ma montre”. Aujourd’hui, aucune app grand public ne répond parfaitement à cette demande.

---

## 3. Pourquoi maintenant

Le marché est mûr pour un outil de génération, pas seulement de tracking.

Le running est devenu massif. L’Observatoire du Running 2026 indique que 13,2 millions de personnes ont déclaré courir en France en 2025, soit un million de plus qu’il y a cinq ans. L’étude décrit le running comme une norme sociale, avec 64 % des répondants courant au moins une fois par semaine et 40 % impliqués dans le trail. Le marché français du running aurait progressé de plus de 20 % en 2025, proche de 1,5 milliard d’euros.

Les plateformes outdoor ont déjà éduqué le marché. Strava revendique plus de 195 millions d’athlètes dans plus de 185 pays. Komoot a dépassé 40 millions d’utilisateurs enregistrés et se présente comme la plus grande plateforme outdoor européenne. AllTrails revendique plus de 500 000 sentiers vérifiés accessibles et une communauté de 90 millions de membres.

Ces chiffres montrent deux choses. D’abord, la demande outdoor digitale est déjà énorme. Ensuite, les utilisateurs sont prêts à payer pour de meilleurs outils : Strava, AllTrails, Komoot, Garmin et d’autres ont normalisé l’abonnement sportif/outdoor.

Mais le marché reste structuré autour de trois modèles incomplets : tracking social, catalogue de parcours ou éditeur manuel. TrailForge arrive au moment où le besoin suivant devient évident : l’automatisation intelligente et personnalisée de la découverte.

Sources utilisées : Strava Press “About” ; Komoot Newsroom, annonce des 40M d’utilisateurs ; AllTrails press release “Introducing AllTrails in ChatGPT” ; Marathons.com / Observatoire du Running 2026.

---

## 4. Vision produit

La vision long terme de TrailForge est de devenir le Spotify des parcours outdoor.

Spotify a remplacé la construction manuelle de playlists par des recommandations adaptées au contexte, aux goûts et au moment. TrailForge applique cette logique au terrain : au lieu de tracer une boucle à la main, l’utilisateur exprime son intention et reçoit une proposition prête à l’usage.

Mais TrailForge doit rester un outil outdoor, pas une app addictive. La philosophie produit est anti-screen time : ouvrir, générer, comprendre, exporter, sortir. Pas de feed infini, pas de gamification artificielle, pas de réseau social bruyant. La valeur est dehors, pas dans l’app.

La vision se construit en trois temps.

Année 1 : prouver que des runners peuvent générer, comprendre, exporter et juger des boucles honnêtes dans des zones compatibles. Le produit n’a pas besoin d’être parfait nationalement ; il doit être fiable sur des cas réels, avec des retours terrain.

Année 2 : élargir la couverture, ajouter le vélo/gravel, renforcer l’import d’historique Strava, proposer l’anti-répétition et améliorer la personnalisation.

Année 3 : construire un moteur de goût outdoor : TrailForge apprend les préférences de l’utilisateur, distingue ce qu’il appelle “beau”, “roulant”, “technique”, “calme”, “nature”, “efficace”, et génère des parcours de plus en plus alignés.

La vision ultime n’est pas “encore une app de sport”. C’est une couche d’intelligence entre l’intention humaine et le territoire.

---

## 5. Positionnement

TrailForge se positionne sur un espace distinct : génération automatique, multi-sport, orientée entraînement et découverte.

Strava est d’abord un réseau social et un tracker. Sa force est la donnée communautaire et l’effet réseau. Sa faiblesse est la création de parcours : l’utilisateur doit encore planifier, corriger et interpréter.

Komoot est très fort sur la planification outdoor et la navigation, notamment en Europe. Mais son usage central reste manuel : l’utilisateur construit ou ajuste son itinéraire par points et recommandations.

AllTrails est très fort sur la recherche de sentiers et la randonnée. Mais il part d’un catalogue de trails existants, pas d’un besoin sportif personnel depuis la position de l’utilisateur.

Garmin Connect propose du round-trip routing, mais il reste enfermé dans l’écosystème Garmin, avec une intelligence terrain limitée et peu d’explication produit.

TrailForge prend un angle différent : générer un parcours depuis une intention sportive. Le concurrent principal n’est donc pas seulement une app ; c’est le temps perdu à bricoler une route.

Positionnement synthétique :

TrailForge = génération automatique + intention sportive + honnêteté terrain + export GPX universel.

Le wedge initial doit rester serré : running / trail léger / nature urbaine sur 5 à 10 km, en France, avec des testeurs capables de donner un feedback dur. Le risque serait de se présenter trop tôt comme “le générateur universel de parcours”. Le bon positionnement de départ est plus crédible : “le moyen le plus rapide de générer une boucle outdoor honnête autour de toi”.

---

## 6. Le produit

L’expérience cible doit durer moins d’une minute.

L’utilisateur choisit son mode : trail / chemins, nature urbaine, boucle simple, puis indique une distance et éventuellement un dénivelé souhaité. TrailForge génère une ou plusieurs propositions, affiche clairement le statut de la route et permet l’export GPX.

Les trois états produit sont fondamentaux.

Premier état : généré. La route respecte suffisamment la promesse : distance acceptable, boucle propre, terrain cohérent, GPX exploitable, pas de route manifestement absurde.

Deuxième état : ajusté. TrailForge propose une route utile mais différente de la demande. Exemple : l’utilisateur demande 8 km dans un petit parc, mais le moteur propose une boucle propre de 5,4 km au lieu de forcer une trace sale, répétitive ou trompeuse.

Troisième état : refusé. TrailForge refuse quand accepter serait mensonger. Exemple : demande trail dans une zone où il n’y a que du bitume, accès privé, graphe OSM insuffisant, ou impossibilité de produire une boucle exploitable.

Cette logique est importante pour la confiance. Les autres outils essaient souvent de fournir quelque chose coûte que coûte. TrailForge doit devenir l’outil qui préfère dire la vérité plutôt que générer une mauvaise trace.

Fonctionnalités MVP prioritaires : génération de boucle, affichage carte cohérent avec le GPX, export GPX, métriques de surface lisibles, raisons d’ajustement/refus compréhensibles, feedback utilisateur après génération.

Fonctionnalités premium futures : générations illimitées, variantes multiples, import Strava personnel, anti-répétition, indice de découverte, préférences terrain, historique, favoris, modes vélo/gravel, score scenic, aperçu visuel.

---

## 7. Technologie : le moteur V3

Le moteur V3 est le cœur défendable de TrailForge. Son rôle n’est pas seulement de trouver un chemin entre deux points. Son rôle est de transformer une intention utilisateur en boucle outdoor exploitable, puis de prouver que la route tient sa promesse.

V3 doit être présenté comme une évolution de V2/V2.5, pas comme une rupture floue. Les apprentissages actuels sont clairs : la génération de parcours ne peut pas reposer uniquement sur un score local par segment. Une route peut avoir plusieurs bons segments mais rester mauvaise en tant que parcours : trop de bitume, boucle artificielle, entrée trop courte en forêt, retours sur les mêmes edges, géométrie sale, ou promesse trail non tenue.

Le moteur V3 repose sur sept couches.

Couche 1 : Graph Builder. Il récupère les données OpenStreetMap et construit un graphe routable borné autour du départ. Il conserve les informations de surface, type de voie, accès, contexte naturel, sécurité et connectivité.

Couche 2 : Terrain Audit. Il lit le territoire avant de générer. Il estime le potentiel trail, la densité de chemins, la part de surfaces inconnues, les zones naturelles, les corridors, les parcs, les routes calmes, les fragments inutiles et les ambiguïtés OSM.

Couche 3 : Route Intent Planner. C’est la couche stratégique. Elle décide quelle promesse est réaliste : forest loop, transition to woods, park loop, urban nature loop, low trail potential. Elle ne trace pas la route ; elle donne une intention claire au solveur.

Couche 4 : Edge Scorer. Chaque segment reçoit des features interprétables : surface pavée/non pavée/inconnue, route calme ou dangereuse, contexte naturel, corridor scenic, accès, pente, pénalité grands axes. Le scorer ne doit pas masquer la réalité : une route asphaltée en forêt reste asphaltée.

Couche 5 : Intentional Solver. Le solveur cherche une boucle qui respecte l’intention route-level, pas seulement le meilleur score local. Il suit des états globaux : distance déjà parcourue, distance pavée cumulée, temps passé en zone naturelle, continuité non revêtue, aire de boucle, répétition d’edges, clean return, budget temps.

Couche 6 : Post-processor + Quality Gates. Les candidats sont classés et rejetés si nécessaire. Une route ne passe pas parce qu’elle a un bon score abstrait ; elle passe si elle respecte la promesse utilisateur. Les quality gates vérifient distance, D+, surface, répétition, grands axes, géométrie, cohérence GPX/carte et temps de génération.

Couche 7 : Feedback Loop. Chaque génération reçoit un identifiant, des diagnostics et un retour utilisateur. Le feedback permet de transformer les jugements terrain en benchmarks, puis en amélioration moteur. À terme, cela construit un dataset propriétaire de goût outdoor légal, basé sur OSM, données ouvertes et feedback volontaire, pas sur le scraping de plateformes propriétaires.

Le principe fort de V3 : route honnête avant route parfaite.

TrailForge ne doit pas maquiller une route bitumée en trail parce qu’elle traverse un bois. Il ne doit pas forcer une boucle sale pour atteindre une distance exacte. Il ne doit pas cacher les limites d’OSM. Cette rigueur peut sembler moins “magique” au début, mais elle crée la confiance nécessaire pour exporter un GPX et partir réellement dehors.

---

## 8. Pourquoi la technologie est difficile

Générer un bon parcours est beaucoup plus dur que calculer un itinéraire classique.

Un itinéraire classique optimise souvent un trajet A → B. TrailForge doit créer une boucle A → A, avec une distance cible, un type de surface, une forme agréable, un niveau de sécurité, une cohérence sportive, un D+ raisonnable et une promesse de découverte.

Le moteur doit aussi gérer des données imparfaites. OpenStreetMap est puissant mais hétérogène : certaines surfaces sont bien taguées, d’autres inconnues, certains chemins sont fragmentés, certains accès sont ambigus. Un bon moteur doit distinguer “terrain inexistant”, “terrain existant mais mal tagué”, “terrain existant mais non adapté à la promesse”, et “terrain adapté mais difficile à connecter”.

Les cas terrain réels montrent la difficulté. À Tourville, une route peut longer des bois sans vraiment les utiliser, ou emprunter des corridors forestiers goudronnés qui sont agréables mais pas trail. À Caen, un parc peut produire une bonne boucle nature urbaine mais pas une promesse trail exacte de 8 km. À Meudon, l’ambiguïté d’accès peut rendre une route techniquement calculable mais produit-risquée.

C’est précisément cette difficulté qui rend le moteur défendable. La valeur n’est pas dans une carte ; elle est dans l’accumulation de décisions terrain, de tests, de benchmarks, de refus honnêtes et de feedbacks réels.

---

## 9. Marché et opportunité

Le marché adressable peut être vu en trois cercles.

Premier cercle : runners réguliers français. La France compte 13,2 millions de personnes ayant déclaré courir en 2025. Le segment vraiment adressable au départ est plus petit : runners qui courent au moins une fois par semaine, possèdent ou utilisent une montre/app GPS, cherchent à varier leurs parcours, et acceptent d’essayer une app spécialisée. C’est déjà un marché suffisant pour une première traction.

Deuxième cercle : trail, running nature, gravel et cyclisme endurance. Ces utilisateurs ont une douleur plus forte car la qualité du terrain compte davantage. Ils sont aussi plus habitués aux GPX, montres GPS et abonnements.

Troisième cercle : marché outdoor digital global. Strava, Komoot et AllTrails prouvent l’existence d’une base utilisateur massive. TrailForge ne doit pas les affronter frontalement au début ; il doit s’intégrer à leurs usages. Exemple : l’utilisateur tracke sur Strava, exporte vers Garmin, mais génère son parcours avec TrailForge.

L’opportunité business vient d’un wedge premium : payer pour gagner du temps, découvrir de nouvelles routes et éviter les mauvaises traces. Un abonnement autour de 49–59 €/an est cohérent si le produit devient un utilitaire récurrent, surtout pour des sportifs équipés qui dépensent déjà en chaussures, montres, dossards et apps.

Hypothèse réaliste de démarrage : 15 à 30 bêta-testeurs terrain, puis 500 utilisateurs en liste d’attente, puis 2 000 à 6 000 MAU à 12 mois si le moteur prouve une valeur claire. L’objectif initial n’est pas de promettre 1M€ ARR ; l’objectif est de prouver un comportement produit que les concurrents ne fournissent pas.

---

## 10. Business model

Le modèle naturel est freemium + abonnement premium.

La version gratuite doit permettre de tester la promesse : quelques générations par mois, export GPX basique, modes limités. Elle sert à créer la confiance.

La version premium doit débloquer l’usage récurrent : générations illimitées, variantes multiples, anti-répétition via historique personnel, préférences terrain, indice de découverte, historique, favoris, exports avancés, modes spécialisés.

Prix cible : 4,99 €/mois ou 49,99 €/an au lancement. Ce prix reste inférieur à beaucoup d’abonnements outdoor majeurs tout en étant assez élevé pour signaler un produit sérieux.

Structure de coûts : relativement légère au départ si l’architecture reste maîtrisée. Le backend peut tourner sur Next.js/Vercel ou équivalent, avec cache Redis, base Supabase/PostgreSQL, données OSM/Overpass, services d’élévation et monitoring. Le vrai coût n’est pas l’infrastructure brute ; c’est le temps de développement, la qualité moteur, la validation terrain et le support utilisateur.

---

## 11. Go-to-market

La stratégie de lancement doit éviter le piège “app grand public trop tôt”. TrailForge doit d’abord gagner la confiance d’un petit groupe de sportifs exigeants.

Phase 1 : bêta fermée terrain. 15 à 30 testeurs en Normandie / France, capables de générer des parcours, exporter un GPX, courir réellement, puis donner un retour brutal : route utile ou non, terrain conforme ou non, export fiable ou non. Les métriques de succès : au moins 10 testeurs génèrent une route, 5 exportent un GPX, 5 donnent un feedback, 3 disent qu’ils réutiliseraient TrailForge, moins de 20 % des routes acceptées sont jugées trompeuses ou inutilisables.

Phase 2 : contenu preuve. Publier des exemples concrets avant/après : demande utilisateur, carte générée, surface, raison d’ajustement, GPX exporté, retour terrain. Le contenu doit vendre la preuve, pas la promesse abstraite.

Phase 3 : communautés ciblées. Clubs running locaux, groupes Strava, Reddit, forums trail, micro-créateurs running, clubs étudiants, groupes Garmin/Wahoo. Demander une critique concrète plutôt qu’un like.

Phase 4 : lancement public restreint. Ouvrir seulement quand les zones compatibles et les états produit sont propres. Le message doit rester honnête : “TrailForge génère des boucles outdoor quand le terrain le permet, ajuste ou refuse quand ce serait trompeur.”

Le canal le plus puissant au début n’est pas une publicité. C’est une trace GPX réussie que quelqu’un court vraiment et partage en disant : “je n’aurais pas trouvé cette boucle seul”.

---

## 12. Différenciation défendable

La différenciation de TrailForge se construit sur cinq actifs.

Premier actif : le moteur de génération. Les concurrents ont des cartes, des communautés ou des catalogues. TrailForge construit une logique de décision : intention, terrain, boucle, compromis, refus.

Deuxième actif : la vérité terrain. Beaucoup d’outils vendent de l’inspiration. TrailForge doit vendre de la confiance : surface honnête, GPX cohérent, refus compréhensible, pas de promesse trail sur bitume.

Troisième actif : la boucle feedback → benchmark. Chaque retour terrain devient une preuve ou un test. Cela permet de durcir le moteur de façon cumulative.

Quatrième actif : l’anti-répétition personnelle. Avec l’historique Strava personnel, TrailForge peut générer des parcours qui maximisent la nouveauté pour chaque utilisateur, pas seulement des routes populaires déjà vues.

Cinquième actif : l’intention sportive. Un fractionné, une sortie longue, une récupération, un trail léger ou un gravel exploration ne demandent pas les mêmes routes. Cette compréhension différencie TrailForge d’un simple route builder.

---

## 13. Risques

Le premier risque est technique : promettre trop large trop tôt. Générer partout, pour tous les sports, toutes distances, toutes surfaces, serait une erreur. La bonne stratégie est de contrôler le scope : 5–10 km, running/trail/nature, zones compatibles, bêta fermée, états généré/ajusté/refusé.

Le deuxième risque est produit : confondre “route calculée” et “route désirable”. Une trace peut être techniquement valide mais mauvaise à courir. TrailForge doit juger comme un sportif, pas comme un routeur.

Le troisième risque est data/legal : utiliser des données propriétaires sans droits, comme les heatmaps ou traces issues de plateformes fermées. La bonne voie est de construire un dataset légal à partir d’OSM, données ouvertes, GPX volontaires et feedbacks utilisateurs.

Le quatrième risque est marketing : se présenter comme une IA magique. Ce serait faible et peu crédible. Le positionnement doit être plus robuste : moteur terrain, décisions explicables, génération honnête.

Le cinquième risque est concurrence : Strava, Komoot, AllTrails ou Garmin peuvent ajouter davantage d’IA. La défense de TrailForge doit donc être la vitesse d’apprentissage sur un wedge précis : les boucles sportives outdoor personnalisées, validées terrain, exportables.

---

## 14. Roadmap proposée

Étape 1 : stabiliser le contrat bêta. Chaque génération doit sortir en généré, ajusté ou refusé, avec une raison claire et un identifiant de génération. La carte et le GPX doivent représenter la même route.

Étape 2 : finir le moteur V3 core. Route Intent Planner, quality gates, diagnostics, feedback loop, benchmarks terrain. Priorité à quelques cas réels plutôt qu’à une couverture nationale.

Étape 3 : bêta fermée. 15 à 30 testeurs, zones compatibles, feedback terrain structuré, correction rapide des routes trompeuses.

Étape 4 : première version publique web ou iOS TestFlight. Expérience premium simple : générer, comprendre, exporter.

Étape 5 : personnalisation. Import historique Strava personnel, anti-répétition, préférences terrain, indice de découverte.

Étape 6 : extension sport. Ajouter progressivement vélo route, gravel, VTT, puis randonnée si les données et la qualité moteur suivent.

---

## 15. Message pitch deck

Phrase courte : TrailForge génère des boucles GPS outdoor en quelques secondes, adaptées au terrain réel et prêtes à exporter sur montre.

Phrase problème : Les sportifs passent trop de temps à tracer des parcours manuellement, puis finissent souvent par refaire les mêmes routes.

Phrase solution : TrailForge transforme une intention sportive — distance, terrain, type de sortie — en route honnête : générée, ajustée ou refusée clairement.

Phrase technologie : Notre moteur V3 analyse le graphe OSM, audite le terrain, choisit une stratégie de route, génère des boucles, vérifie les quality gates et apprend du feedback terrain.

Phrase positionnement : Nous ne sommes pas un tracker, pas un réseau social et pas un catalogue de randonnées. Nous sommes le moteur de génération de parcours pour sportifs outdoor.

Phrase vision : À terme, TrailForge devient le moteur personnel de découverte outdoor : chaque sortie commence par une intention, pas par 20 minutes de cartographie manuelle.

---

## 16. Structure recommandée du pitch deck

Slide 1 — Titre : TrailForge, le générateur de parcours GPS outdoor.

Slide 2 — Problème : préparer une bonne sortie prend trop de temps et finit souvent en répétition.

Slide 3 — Marché : running/outdoor massif, abonnements déjà normalisés, 13,2M runners en France, plateformes mondiales à dizaines/centaines de millions d’utilisateurs.

Slide 4 — Insight : le marché a résolu le tracking, pas la génération intelligente.

Slide 5 — Solution : une intention → une boucle GPX honnête.

Slide 6 — Démo produit : choix sport/distance/mode → génération → carte → export GPX.

Slide 7 — Moteur V3 : Graph Builder, Terrain Audit, Route Intent Planner, Solver, Quality Gates, Feedback Loop.

Slide 8 — Pourquoi c’est dur : boucle A→A, surfaces imparfaites, terrain réel, promesse sportive, OSM ambigu, refus honnête.

Slide 9 — Positionnement concurrentiel : Strava tracke, Komoot planifie, AllTrails catalogue, Garmin route dans son écosystème, TrailForge génère.

Slide 10 — Business model : freemium + premium 49,99 €/an.

Slide 11 — Go-to-market : bêta fermée terrain, preuve GPX, communautés running/trail, contenu preuve.

Slide 12 — Roadmap : bêta → V3 core → Strava import → anti-répétition → iOS/premium → extension sports.

Slide 13 — Vision : le Spotify des parcours outdoor, mais anti-screen time.

Slide 14 — Ask : bêta testeurs, mentors produit/tech, partenaires running/outdoor, financement si deck investisseur.

---

## 17. Version ultra-courte pour ouverture orale

TrailForge part d’un problème très simple : les runners et cyclistes ont des montres, des apps de tracking, des cartes, mais préparer un bon parcours reste pénible. On passe 15 minutes à tracer une boucle, vérifier les chemins, corriger la distance, puis on finit souvent par refaire la même sortie.

TrailForge génère cette boucle automatiquement. L’utilisateur indique son sport, sa distance et son type de terrain. Le moteur analyse le graphe autour de lui, comprend si le terrain permet vraiment une sortie trail, nature ou route, puis produit un GPX exploitable. Et si la demande est irréaliste, TrailForge ajuste ou refuse clairement au lieu de mentir.

Notre technologie clé est le moteur V3 : un route engine orienté intention. Il ne se contente pas de calculer un trajet ; il audite le terrain, choisit une stratégie, cherche une vraie boucle, vérifie les surfaces, la forme, les répétitions, la sécurité et la cohérence avec la promesse utilisateur.

Notre positionnement est clair : Strava tracke, Komoot aide à planifier, AllTrails référence des sentiers. TrailForge génère le parcours. La vision long terme est de devenir le moteur personnel de découverte outdoor : tu ouvres l’app, tu appuies, tu sors.

---

## 18. Points à ne pas sur-vendre dans le deck

Ne pas dire que TrailForge est déjà prêt nationalement. La version crédible est : bêta fermée sur zones compatibles, avec une architecture pensée pour scaler.

Ne pas dire que le moteur est une IA magique. Dire : moteur algorithmique terrain + feedback utilisateur + apprentissage progressif.

Ne pas dire que tous les concurrents sont mauvais. Ils sont forts, mais centrés sur d’autres usages : tracking, communauté, navigation, catalogue, édition manuelle.

Ne pas vendre le trail si la route est pavée. C’est un principe produit fort et différenciant.

Ne pas promettre toutes les disciplines dès le début. Le wedge le plus crédible : running / trail léger / nature urbaine / 5–10 km.

---

## 19. Sources marché à citer dans le deck

Strava Press — About : plus de 195 millions d’athlètes dans plus de 185 pays.  
https://press.strava.com/about

Komoot Newsroom — 40M registered users : Komoot dépasse 40 millions d’utilisateurs enregistrés, se présente comme la plus grande plateforme outdoor européenne.  
https://newsroom.komoot.com/238612-komoot-breaks-the-40-million-mark-for-registered-users/

AllTrails Press — Introducing AllTrails in ChatGPT : plus de 500 000 sentiers vérifiés, communauté de 90 millions de membres.  
https://www.alltrails.com/press/introducing-alltrails-in-chatgpt

Marathons.com — Observatoire du Running 2026 : 13,2 millions de runners en France en 2025, 64 % courent au moins une fois par semaine, 40 % impliqués dans le trail, marché running français proche de 1,5 Md€ après +20 % en 2025.  
https://www.marathons.com/en/tips-recos/running-observatory-2026-13-2-million-participants-and-a-market-still-growing/
