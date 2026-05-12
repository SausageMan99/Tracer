# TrailForge — Closed Beta Implementation Audit

Date: 2026-05-12
Branch: `beta/closed-scope-2026-05-12`
Base: `02970a1 Add IGN terrain context POC artifacts`

## Current implementation status

### Already present

- API returns typed refusals for major generation failures:
  - `NO_ROAD_NETWORK`
  - `ROUTE_CANDIDATES_REJECTED`
  - `IMPOSSIBLE_ELEVATION`
  - `GEOCODING_FAILED`
- Human French messages already exist for:
  - `PARK_TOO_SMALL_FOR_DISTANCE`
  - `RESTRICTED_ACCESS_BLOCKED`
  - `TRAIL_PROMISE_UNMET`
  - `OVERPASS_TIMEOUT`
  - `EMPTY_GRAPH`
  - `SOLVER_EMPTY`
- `distanceAdjustment` already exists on `GeneratedRoute` for park recovery adjusted-distance cases.
- Route result UI already shows:
  - GPX download button
  - distance / D+ / duration
  - distance and elevation error
  - trail ratio / terrain confidence
  - route explanation
  - quality warnings
  - feedback buttons
- Feedback infrastructure exists:
  - client local feedback store
  - `/api/feedback` server endpoint
  - feedback reasons whitelist
  - admin export with `ADMIN_SECRET`

### Missing or weak for closed beta

#### 1. No first-class beta status

Current app state is still `success` / `error`.

Closed beta needs product status:

- `generated`
- `adjusted`
- `refused`

Today, a route with `distanceAdjustment` is still just `success`. The UI can mention metrics, but the product contract is not explicit enough.

Required change:

- Add a derived or explicit `betaStatus` / `routeOutcome` in the response or UI layer.
- If `distanceAdjustment` exists, render it as `adjusted`, not normal success.
- If API error is typed, render as `refused`, not generic error.

#### 2. Adjusted route UX is not strong enough

`distanceAdjustment` exists in the backend, but the main result header still says labels like “Boucle exploitable” and `GPX prêt`.

Required change:

- Add a visible banner:
  - “Distance adaptée”
  - “Demandé: X km / proposé: Y km”
  - human explanation from `messageCode` / `reason`
- Do not make adjusted routes look like pure generated successes.

#### 3. Refusal UX exists but is too generic

Current error header says “Pas de boucle fiable trouvée” and prints the error message.

Required change:

- Keep it, but add closed-beta framing:
  - “Refus honnête beta”
  - reason chip from `errorCode` / `subCode`
  - suggested next action: lower distance, switch mode, move start point.

#### 4. Feedback is success-route-only

`FeedbackButtons` only receives `GeneratedRoute`. Refused/adjusted feedback is not first-class.

Closed beta needs feedback on all outcomes, especially refusals and adjustments.

Required change:

- Extend feedback model with:
  - `outcome: generated | adjusted | refused`
  - `errorCode?: string`
  - `subCode?: string`
  - `routeId` or `generationId`
- Allow feedback from refusal screen:
  - “Refus clair”
  - “Je m’attendais à une route”
  - “Distance plus courte acceptable”
  - “Mauvais diagnostic terrain”

#### 5. No stable generation id in API response

Feedback has its own random id, but there is no obvious generation id connecting input → output → feedback.

Required change:

- Add `generationId` server-side or client-side at request start.
- Include it in feedback payload.
- Include request fields: location/address, profile, distance, elevation, scenicMode.

#### 6. Beta behavior panel not yet encoded

Existing benchmark scripts are still engine/release oriented:

- `benchmark:routes:sprint4-smoke`
- `benchmark:routes:beta-smoke`
- `benchmark:routes:readiness-unstable`

Closed beta needs a behavior panel with pass criteria based on honest outcomes, not only success routes.

Required change:

- Add `benchmark:routes:beta-behavior` or equivalent.
- Panel should include 8–10 cases from `docs/BETA_CLOSED_SCOPE.md`.
- The report should classify each case as:
  - honest generated
  - honest adjusted
  - honest refused
  - dishonest / no-go

#### 7. Landing/app copy still over-promises

Some copy still says “Crée une boucle trail fiable autour d’un point de départ” or “Crée une boucle trail GPX”.

Closed beta copy should say:

- “Boucles outdoor honnêtes en zones compatibles.”
- “TrailForge peut adapter ou refuser si le terrain ne tient pas la promesse.”

Required change:

- Update app metadata and app form copy before tester recruitment.
- Avoid “trail fiable partout”.

## Recommended next implementation order

### P0 — Product contract UI/API

Files likely touched:

- `lib/types.ts`
- `app/api/generate-route/route.ts`
- `lib/store.ts`
- `components/sidebar/RouteResult.tsx`
- `components/sidebar/FeedbackButtons.tsx`
- tests for API/UI contract

Goal:

- First-class `generated / adjusted / refused` behavior.
- Adjusted routes clearly labelled.
- Typed refusals rendered as product refusals, not generic errors.
- Feedback works for generated, adjusted, and refused outcomes.

### P1 — Beta behavior panel

Files likely touched:

- `lib/route-benchmarks-data.json`
- `scripts/run-route-benchmarks.mjs`
- `lib/route-benchmarks.ts`
- `tests/route-benchmarks.test.ts`
- package script in `package.json`

Goal:

- One command validates honest beta behavior.
- Panel is small and launch-oriented.

### P2 — Copy / tester readiness

Files likely touched:

- `app/layout.tsx`
- `components/sidebar/SessionForm.tsx`
- `components/map/MapView.tsx`
- landing/app copy files if used in beta

Goal:

- Product no longer over-promises.
- Tester understands compatible zones, adjusted routes, and refusals.

## CTO recommendation

Do not restart autonomous agents yet.

Next work should be one controlled CODE pass on P0 only: product contract/status + feedback coverage. No engine/scoring changes. No IGN. No Tourville12/Meudon work. No smoke war-room.

Exit criteria for P0:

- Unit/UI tests prove adjusted/refused rendering.
- Feedback can be submitted for all three outcomes.
- Existing route generation tests still pass.
- `git diff --check`, typecheck, lint, tests, build pass.
