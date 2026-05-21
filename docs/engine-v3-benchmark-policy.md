# TrailForge V3 — Benchmark policy anti-gaming

Statut: policy P0 pour le rework assembleur V3.
Branche de travail observée: `wip/v3-fontainebleau-loop-quality`.
Source de vérité actuelle: panel `beta-multiterrain` du 2026-05-19, 8/8 `refused`, 0 `generated`, 0 `adjusted`, 0 `fake_success`, 0 `engine_failure`.

## 1. Principe produit

Le benchmark V3 ne doit pas servir à verdir une démo. Il doit vérifier que le moteur sait produire une trace utile quand le terrain le permet, et refuser proprement quand la promesse serait mensongère.

Le but P0 n'est pas 8/8 routes générées. Le but P0 est un moteur honnête avec quelques routes réellement exploitables sur les terrains cœur, sans spécialisation par cas ni baisse de seuil.

Architecture à protéger pendant les itérations:

`TerrainOpportunityReport -> Intent -> Mission contract -> StrategyAssembler -> SharedTraversalCore -> CandidatePortfolio -> Metrics/Gates -> OutcomeDecider`

Si une correction contourne ce flux par un patch local Fontainebleau/Tourville, elle est hors scope.

## 2. Panel P0 réaliste

### Doivent générer ou ajuster utilement avant GO beta

Ces cas sont le cœur de promesse. Un refus peut rester temporairement honnête, mais il bloque le GO beta tant qu'il n'est pas expliqué par une vraie insuffisance terrain, pas par un handoff assembleur.

| Cas | Stratégie attendue | Verdict attendu P0 |
| --- | --- | --- |
| `fontainebleau-croix-augas-trail-12k` | `forest_loop` | `good_route` ou `acceptable_adjusted`; c’est le benchmark durable de capacité forestière propre Fontainebleau après ASM-3h (départ Croix d’Augas ~48.4054, 2.6786, GPX/GeoJSON attendus). |
| `fontainebleau-trail-12k` | `forest_loop` diagnostic town-edge | Cas d’ancre sur-demandant: `adjusted` / `refused` / sous-distance honnête attendu depuis ce départ, sans affaiblir les seuils et sans maquiller le paved. Ne pas le traiter comme le benchmark produit clean 12k. |
| `meudon-forest-trail-10k` | `forest_loop` périurbain | `good_route` ou `acceptable_adjusted`; le candidat rejeté 10.117 km / 7.361 km dwell montre qu'un simple refus global n'est pas suffisant. |
| `tourville-pommiers-trail-8k` | `transition_to_woods` | `good_route` ou `acceptable_adjusted`; les connecteurs routiers sont acceptables uniquement s'ils débloquent un vrai dwell bois/chemins. |
| `caen-colline-aux-oiseaux-6k-soft` | `park_loop` / `urban_nature` | `acceptable_adjusted` au minimum; ne pas vendre comme trail forestier. |

### Peuvent refuser honnêtement en P0

Ces cas ne doivent pas bloquer le rework assembleur si le refus est bien typé, inspectable et cohérent avec l'opportunité terrain.

| Cas | Raison acceptable |
| --- | --- |
| `tourville-pommiers-trail-12k` | Stress long transition-to-woods; refus acceptable si 8k fonctionne et si 12k prouve manque de capacité non-paved continue, pas seulement timeout/assemblage incomplet. |
| `osm-poor-rural-trail-8k` | OSM/surface confidence faible; refus ou best-effort très averti préférable à fabrication de natural/trail. |
| `paris-19-canal-running` | Nature urbaine dense; refus acceptable si l'alternative serait quasi tout paved ou busy-road. Sinon futur scope urban_nature, pas P0 forest. |

### Stress non-bloquant

`caen-prairie-8k-mixed` est utile pour vérifier `urban_nature` / corridor Orne, mais ne doit pas conduire le design du moteur trail forestier P0. Il devient bloquant plus tard pour la couverture running urbain, pas pour la sortie du cul-de-sac assembleur.

## 3. Critères GO beta

GO beta V3 exige une combinaison de routes utiles et de refus honnêtes. Un benchmark qui s'exécute sans erreur n'est pas un GO.

Minimum recommandé pour P0 beta:

- au moins 4 cas cœur avec verdict produit `good_route` ou `acceptable_adjusted`: Fontainebleau Croix d’Augas 12k, Meudon, Tourville 8k, Caen Colline;
- au moins 1 cas négatif avec `honest_refusal` prouvé par opportunité terrain, idéalement OSM-poor ou Paris 19;
- 0 `fake_success`;
- 0 `engine_failure` sur le panel P0;
- GeoJSON et GPX présents, cohérents et inspectables pour chaque `generated` / `adjusted`;
- GeoJSON/GPX vides ou explicitement non disponibles pour `refused`, sans fausse trace silencieuse;
- comparaison V2.5/V3 disponible sur les mêmes requêtes: V3 ne peut pas être déclaré meilleur s'il refuse là où V2.5 produit une route honnête avec export;
- `trailRatio`, `naturalWayRatio` et `pavedRatio` restent séparés dans les métriques, artifacts et verdicts;
- surfaces asphalt/concrete/paved/scenic paved restent paved, jamais reclassées trail.

Un cas généré utile doit respecter au minimum:

- distance proche de la cible ou `adjusted` avec compromis explicite;
- boucle fermée propre;
- pas de route privée/interdite connue;
- paved/busy-road compatibles avec la promesse du cas;
- natural dwell réel dans le composant cible quand la promesse est trail/forest;
- pas d'overlap/backtracking ou self-intersection grossière;
- route visuellement plausible comme sortie humaine.

## 4. Holdouts et metamorphic tests anti-gaming

Le moteur ne doit pas pouvoir passer en reconnaissant des IDs de benchmark ou des coordonnées exactes.

Holdouts obligatoires:

- un deuxième départ Fontainebleau à 300-800 m du départ benchmark, même distance, non documenté dans le panel principal;
- un autre massif forestier périurbain que Meudon, même ordre 8-12 km;
- un deuxième cas transition-to-woods en Normandie, départ décalé hors Tourville;
- un petit parc urbain hors Caen, 5-7 km, promesse recovery/nature urbaine;
- un cas rural OSM pauvre hors Clécy/Tourville, surface confidence faible.

Metamorphic tests obligatoires:

- même départ en 8 / 10 / 12 km: la stratégie doit scaler, pas basculer en comportement sans rapport;
- départ déplacé de 100-300 m: le composant cible et le verdict doivent rester cohérents si l'accès terrain ne change pas;
- `running_trail` vs `running_endurance` / `nature_urbaine`: le trail doit être plus strict sur paved/natural dwell ou refuser plus clairement;
- répétition du même cas: métriques stables dans une tolérance bornée;
- terrain riche vs terrain pauvre: le moteur doit être plus exigeant en forêt riche et plus explicatif en terrain pauvre;
- inversion anti-ID: renommer un cas ne doit changer aucun résultat.

Signal d'alerte immédiat: une correction améliore Fontainebleau ou Tourville mais dégrade le holdout équivalent. Dans ce cas, considérer la correction comme benchmark-gaming jusqu'à preuve contraire.

## 5. Règles d'interdiction

Interdit pendant le rework V3:

- baisser des seuils produit pour transformer un refus en succès;
- maquiller asphalt, concrete, paved ou scenic paved en trail;
- fusionner `trailRatio`, `naturalWayRatio` et `pavedRatio` dans une métrique flatteuse;
- ajouter des conditions par ID de benchmark, nom de ville, coordonnées exactes ou tags de panel;
- spécialiser le moteur pour Fontainebleau/Tourville sans généralisation strategy-level;
- interpréter `harnessSuccess: true`, exit code 0 ou `success: true` comme verdict produit;
- retourner une route sous-distance ou non fermée comme `generated`;
- produire un GPX/GeoJSON non cohérent avec la route canonique;
- cacher les candidats rejetés quand le verdict est `refused`;
- optimiser la vitesse d'un refus au détriment d'une route utile;
- traiter un refus sur terrain riche comme succès sans preuve d'impossibilité terrain.

Autorisé:

- ajouter diagnostics, artifacts et opportunity reports observation-only;
- durcir les gates anti-fake-success;
- refuser plus honnêtement une trace qui aurait été mensongère;
- créer des assembleurs séparés par stratégie si le contrat mission/traversal reste partagé;
- accepter un `acceptable_adjusted` explicite quand la distance ou la surface ne permet pas la promesse pleine.

## 6. Product verdict contract

### `good_route`

Route générée qui tient la promesse du cas. Distance, boucle, surfaces, shape, natural dwell et exports sont bons. Le runner peut l'utiliser sans lire dix avertissements.

### `acceptable_adjusted`

Route exploitable avec compromis explicite: distance légèrement réduite, promesse terrain ajustée, ou connecteurs nécessaires. Le compromis est visible dans l'outcome, les warnings et l'explication. Ce n'est pas un faux succès.

### `honest_refusal`

Aucune route n'est retournée parce que le terrain, la sécurité, les surfaces, l'accès ou la confiance OSM ne permettent pas la promesse. Le refus doit être typé, expliquer la contrainte, conserver les diagnostics/candidats rejetés, et ne pas produire de fausse trace.

### `engine_failure`

Le moteur échoue alors que le terrain semble exploitable, timeoute, perd les exports, produit des artifacts incohérents, refuse sans diagnostic suffisant, ou régresse contre V2.5 sans justification produit.

### `fake_success`

Le moteur annonce `generated` ou `adjusted` alors que la trace est sous-distance, non fermée, trop pavée pour la promesse, sans dwell terrain réel, trop répétée, visuellement absurde, ou classifie du paved/scenic paved comme trail. C'est pire qu'un refus.

## 7. Gates rapides vs benchmarks live

`npm run test:run` reste la gate rapide/déterministe: elle vérifie les contrats, fixtures synthétiques et wiring CLI sans lancer Overpass en live. Les validations OSM réelles sont séparées dans les scripts benchmark dédiés, avec artifacts inspectables.

Commandes live V3:

- `npm run benchmark:engine-v3`: panel readiness RAM-safe à deux cas, artifacts sous `artifacts/engine-v3-benchmarks/latest-*` par défaut.
- `npm run benchmark:v3-golden`: panel ASM golden à 7 cas (`paris-buttes-chaumont-urban-nature`, `paris-19-canal-running`, `caen-colline-aux-oiseaux-6k-soft`, `tourville-pommiers-trail-8k`, `tourville-pommiers-trail-12k`, `fontainebleau-croix-augas-trail-12k`, `osm-poor-rural-trail-8k`) avec aggregate `/tmp/trailforge-v3-asm-3z-latest.json` et routes `/tmp/trailforge-v3-asm-3z-routes`.
- `npm run benchmark:engine-v3:beta-multiterrain`: panel beta court à 8 cas, plus large que la golden gate ASM.

Ces commandes peuvent être longues et dépendre d’Overpass; leur succès technique signifie seulement que le harness a produit des artifacts, pas que les routes sont produit-ready.

## 8. Décision opérationnelle

Tant que le panel reste à 8/8 `refused`, V3 est observability-only et non beta-ready.

La prochaine étape ne doit pas être un patch de scoring pour obtenir 8/8 verts. La bonne étape est un rework assembleur mesuré: mission contract clair, strategy assemblers séparés, traversal core partagé, candidate portfolio inspectable, puis outcome decider strict.

Le premier GO partiel doit viser: Fontainebleau, Meudon, Tourville 8k et Caen Colline utiles ou ajustés, plus un refus négatif honnête. Tout le reste est secondaire tant que cette base n'existe pas.
