# Route production benchmarks

TrailForge doit être évalué comme un produit outdoor, pas seulement comme une API qui répond 200. Le script `npm run benchmark:routes` rejoue les cas terrain critiques contre `/api/generate-route` et échoue dès qu'une route manque un seuil produit.

## Lancer le banc

```bash
ROUTE_BENCHMARK_BASE_URL=http://localhost:3000 npm run benchmark:routes
```

Par défaut, le script cible `http://localhost:3000`. Pour tester Vercel ou une preview :

```bash
ROUTE_BENCHMARK_BASE_URL=https://trailforge.example.vercel.app npm run benchmark:routes
```

Un rapport JSON est écrit dans `artifacts/route-benchmark-results/latest.json`, sauf avec `--no-output`.

## Source de vérité

Les scénarios sont définis dans `lib/route-benchmarks-data.json`. Ce fichier est consommé à la fois par le domaine TypeScript (`lib/route-benchmarks.ts`) et par le runner Node (`scripts/run-route-benchmarks.mjs`) pour éviter deux listes divergentes.

Chaque cas fixe : adresse, profil, distance, D+, mode scenic éventuel, puis seuils qualité. Les seuils couvrent l'écart distance, l'écart D+, le score production, la fermeture de boucle, le ratio grands axes et, quand pertinent, le ratio nature.

## Principe CTO

Une route qui revient avec succès HTTP mais qui fait 7,8 km au lieu de 10 km, passe trop par de grands axes ou ne ferme pas correctement la boucle est une régression produit. Le benchmark doit donc échouer même si l'API n'a pas crashé.
