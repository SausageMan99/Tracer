# TrailForge — Redesign DA/UX Phase 1

## Direction retenue

TrailForge quitte l’image “app sport générique” pour devenir un atelier GPS trail premium : sombre, topographique, technique, forêt, D+ et GPX. La Phase 1 assume un focus strict : boucles trail/running 5–15 km, pas vélo.

Promesse produit : boucles trail fiables, exportables sur montre, avec compromis affichés au lieu de fausses promesses.

## Changements UX principaux

- Suppression du sélecteur de sport dans l’app : plus de Vélo Route, Gravel, VTT.
- Profils exposés uniquement : Découverte, Trail, Endurance.
- Distance plafonnée à 15 km côté UI Phase 1.
- Profil par défaut : `running_trail`.
- CTA app : `TRACER LA BOUCLE →` au lieu d’un générateur générique.
- Mode renommé en Surface : `Régulier` / `Nature`.
- Résultat : `Nouvelle boucle`, affichage du profil sans rappeler le sport.
- Waitlist : plus de choix Cyclisme / Les deux, badge `Trail running uniquement`.

## Changements DA visibles

- Palette revue : fond vert-noir profond, crème, sauge, lime plus premium, ambre topo.
- Ajout de textures topographiques via `--topo-lines` et surfaces `topo-surface`.
- Cartes et contrôles arrondis, plus premium, moins “wireframe carré”.
- Landing V2 sans photo montagne plein écran : hero abstrait, terrain/topo, message “GPS field lab · trail only”.
- Chiffres landing alignés Phase 1 : 3 intentions trail, focus 15 km, 0 choix vélo, sortie GPX.

## Fichiers principaux modifiés

- `components/landing/HeroSection.tsx`
- `components/landing/ManifestoSection.tsx`
- `components/landing/MetricsSection.tsx`
- `components/landing/FeatureShowcase.tsx`
- `components/landing/FinalCTASection.tsx`
- `components/landing/FooterSection.tsx`
- `components/sidebar/SessionForm.tsx`
- `components/sidebar/RouteResult.tsx`
- `components/ui/WaitlistForm.tsx`
- `app/globals.css`
- `lib/store.ts`

## Validation effectuée

```bash
npm run lint
npm run test:run
npm run build
```

Les trois passent. Vérification visuelle locale effectuée sur `/` et `/app` : l’ancien hero photo montagne a disparu, le choix vélo n’est plus visible dans l’app, et la DA topographique est active.
