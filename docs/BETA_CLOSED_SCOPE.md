# TrailForge — Closed Beta Scope

Date: 2026-05-12
Owner: Clément / Hermes CTO
Status: decision document

## CTO decision

TrailForge closed beta is **not** a national route-generation release and not a proof that V2.5 is solved everywhere.

The closed beta exists to prove one thing: real runners can generate, understand, export, and judge honest outdoor loops in compatible areas.

The beta promise is:

> TrailForge generates honest outdoor loops in compatible terrain, exposes compromises clearly, and refuses when the requested route would be misleading.

No false green. No forced trail success. No hiding paved/asphalt routes behind scenic or natural wording.

## Product states

Every generation must resolve into one of three user-facing states.

### 1. Generated

Use only when the requested promise is substantially held.

Minimum expectations:

- GPX is usable.
- Map line and GPX represent the same route.
- Distance is within the accepted tolerance for the selected mode.
- Surface/trail/natural ratios are not misleading for the selected mode.
- No major hidden restriction/private-access issue is known.
- The route is something a tester could plausibly run/ride.

### 2. Adjusted

Use when TrailForge can offer a useful route, but not the exact requested promise.

Examples:

- Requested 8 km, clean route is 5.4 km.
- Requested trail, output is mostly paved park/nature-urban.
- Requested elevation is not feasible or not reliable.
- Exact-distance route would create dirty loops, excessive repeats, or bad geometry.

Required UX:

- Show requested distance vs proposed distance.
- Show why it was adjusted.
- Do not count adjusted routes as pure generated success.

### 3. Refused

Use when accepting the route would mislead the user.

Valid refusal reasons:

- `TRAIL_PROMISE_UNMET`
- `PARK_TOO_SMALL_FOR_DISTANCE`
- `DISTANCE_UNATTAINABLE`
- `RESTRICTED_ACCESS_BLOCKED`
- `NO_ROAD_NETWORK`
- `ROUTE_CANDIDATES_REJECTED`
- `OVERPASS_TIMEOUT` / infrastructure failure when applicable

Required UX:

- Human-readable reason.
- No technical-only 422 wording.
- If possible, suggest a lower distance or another mode.

## Beta modes

Keep the beta modes few and explicit.

### Trail / chemins

Promise: non-paved/path/track/forest/field-oriented loop.

Rules:

- Refuse more easily when route is mostly paved.
- Natural context alone does not make a trail route.
- Asphalt/concrete/paved remains paved even in forest/park.

### Nature urbaine

Promise: pleasant green/park/river/quiet-road running, not pure trail.

Rules:

- Paved park routes can be acceptable if labelled honestly.
- Good for Caen-like park recovery cases.
- Must not be marketed as trail.

### Boucle simple

Promise: usable outdoor loop with fewer trail constraints.

Rules:

- Good for early product utility.
- Still must avoid unsafe/broken/absurd routes.
- Surface ratios remain visible.

## Geography scope

### Allowed first

- Caen / Normandy areas Clément can inspect or understand.
- Suisse normande / Clécy-style outdoor zones, if routing is stable.
- Forests, parks, and semi-rural zones with visible path networks.
- Small towns with quick access to trails/fields/woods.
- Fontainebleau only if stable enough and not performance-blocked.

### Not part of first beta

- Paris dense.
- National readiness panel.
- Meudon-like restricted-access ambiguity as a launch criterion.
- Tiny parks for 8–15 km exact trail promises.
- Tourville 12k as a beta launch blocker.
- Dense urban fallback as a proof of trail quality.

## Distance scope

Running/trail beta distances:

- Primary: 5 km, 8 km, 10 km.
- Conditional: 12 km only in clearly compatible areas.
- Avoid: 15 km except in strong forest/nature zones.

Elevation:

- Display as estimate.
- Do not make fine D+ control a beta blocker.
- If elevation is unreliable, disclose it instead of forcing route success.

## Required beta functionality

Must have:

- Map route display coherent with GPX.
- Reliable GPX export.
- Clear status: generated / adjusted / refused.
- Distance requested vs distance produced.
- Surface honesty: paved, natural, trail/non-paved metrics visible or explainable.
- Human-readable refusal/adjustment reason.
- Feedback collection after generation.
- Server-side traceability: generation input, output status, reason, route id/artifact/log reference.

Nice but not required:

- Accounts.
- Payments.
- National coverage.
- IGN scoring.
- ML/taste dataset.
- Advanced D+ optimization.
- Perfect landing page.

## Beta behavior validation panel

Use a behavior panel, not a national readiness panel.

Initial panel should cover 8–10 cases:

1. Tourville 8k — transition-to-woods behavior; must enter/use real wooded paths or refuse/adjust honestly.
2. Caen Colline aux Oiseaux 5–6k — nature urbaine / park recovery, not trail.
3. Fontainebleau 10–15k — strong trail/nature candidate only if stable.
4. Suisse normande / Clécy 8–10k — nature/trail candidate.
5. Small Normandy town 8k — semi-rural path network.
6. Simple forest case 8–10k — high-confidence trail behavior.
7. Dense urban negative case — refused or nature-urban, not trail.
8. Small park too-long request — adjusted distance or typed refusal.
9. Optional cycling simple loop — only if bike mode is stable.
10. Optional poor OSM case — diagnostic only, not launch blocker.

Pass condition is not “everything green”. Pass condition is “every output is honest”.

## Closed beta success metrics

With 15–30 testers:

- At least 10 testers generate a route.
- At least 5 export a GPX.
- At least 5 provide qualitative feedback.
- At least 3 say they would reuse TrailForge.
- Less than 20% of accepted routes are judged misleading or unusable.
- Refusals are understood as honest product behavior, not random bugs.

## No-go criteria

Do not launch beta if any of these are true:

- GPX export is broken or mismatched with the map.
- Map shows a route different from exported GPX.
- Trail mode accepts mostly paved routes without clear compromise wording.
- Errors are technical and incomprehensible.
- Simple compatible zones often time out.
- There is no feedback capture.
- The product claims trail success for restricted/private/access-ambiguous routes.

## R&D / out of beta scope

Keep these out of the beta-critical path:

- IGN scoring integration.
- Meudon restricted-access resolution.
- Tourville 12k stability.
- National readiness panel.
- Paris dense routing.
- ML/taste dataset.
- Advanced scenic ranking.
- Fine D+ optimization.
- Trying to make every benchmark green.

## Current branch/base decision

Current local state on 2026-05-12:

- Branch: `feat/p1-2-quality-ratio-interpretation`
- Local HEAD: `071b933 Refine IGN terrain context artifacts`
- Remote feature branch: `02970a1 Add IGN terrain context POC artifacts`
- Local is ahead by 1 commit.

Decision:

- Do not push `071b933` as beta-critical work yet.
- Treat `071b933` as R&D/data-refinement work until the `usefulCorridorKm`/surface-honesty issue is resolved.
- Candidate beta base should be the remote feature branch (`02970a1`) or an earlier clean beta-scope commit after a fresh audit.
- Beta work should proceed on a new branch from the chosen clean base, focused on product states, UX honesty, GPX/map coherence, feedback capture, and a beta behavior panel.

## Immediate execution plan

1. Freeze autonomous TrailForge agents and crons. Done 2026-05-12.
2. Keep current local `071b933` unpushed unless explicitly accepted as R&D.
3. Create a beta branch from clean chosen base.
4. Implement/verify generated-adjusted-refused product contract.
5. Build the beta behavior panel.
6. Verify GPX/map coherence and error/feedback UX.
7. Recruit 15–30 testers in compatible zones.
8. Use tester feedback, not benchmark count alone, to decide next engine work.
