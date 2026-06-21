# T12 — urban_nature_loop closure contract tolerance

Mode: PATCH (formalization of in-flight dirty patch)
Risk: HUMAN_REQUIRED (touches lib/engine-v3/assemblers/park-loop-assembler.ts)
Phase 0 stabilization commit, no Phase 1 CI/CD.

---

## 1. Files authorized

- `lib/engine-v3/assemblers/park-loop-assembler.ts` — engine patch
- `tests/engine-v3-synthetic-suite.test.ts` — RED tests (6 cases)
- `.trailforge-agent/queue.json` — register T12, cancel T5
- `.trailforge-agent/reports/T12-PLAN.md` — this report

## 2. Files forbidden

Same as T-series protocol — every `lib/engine-v3/**` file other than
`park-loop-assembler.ts`, plus `lib/engine/**`, the benchmark runner,
the script wiring, `lib/engine-v3/types.ts`, `.github/**`.

## 3. Call graph (MAP summary)

`selectUrbanNatureComponentRouteEdges` lives in
`lib/engine-v3/assemblers/park-loop-assembler.ts` at line ~687.

Direct callers in this file:
- `selectUrbanNatureComponentRouteEdges` is called only by the
  `urban_nature_loop` branch of `assembleGraphRouteV3` /
  `assembleMissionV3`'s strategy dispatcher.
- Other strategies (`park_loop`, `forest_loop`, `transition_to_woods`)
  take different code paths and never reach this function.

Inside the function, the patch introduces two new locals:
- `distanceOvershootToleranceKm` — guarded by
  `mission.strategy === 'urban_nature_loop'`, otherwise 0.
- `targetRepeatToleranceKm` — same guard, otherwise 0.001 (current strict cap).

Two comparison sites are touched:
- L738 (was L725): `relaxedConnectorAudit.targetRepeatKm <= targetRepeatToleranceKm`
  (was `<= 0.001`).
- L770 (was L757):
  `metrics.distanceProducedKm > maxDistanceKm + distanceOvershootToleranceKm + 0.001`
  (was `> maxDistanceKm + 0.001`).

Shared mutable state touched: `diagnostics.closureRejectedReasons`
(incremented for `distance_above_max_contract` and
`no_routable_connector_to_start`). No new keys introduced.

## 4. PATCH shape

```
+ 13 lines inside selectUrbanNatureComponentRouteEdges (locals + comment)
+ 2 line modifications at the two existing comparison sites
```

Net: +15 / -2 on `park-loop-assembler.ts`.

Plus 242 insertions on `tests/engine-v3-synthetic-suite.test.ts`:
one `describe('T12: urban_nature_loop closure contract tolerance')` with
6 cases:

| Test | Scope | Verifies |
|------|-------|----------|
| T12-A1 | urban_nature_loop | small overshoot accepted (0.15 km < 0.48 km tolerance) |
| T12-A2 | urban_nature_loop | large overshoot rejected (1.0 km > 0.48 km tolerance) |
| T12-B1 | urban_nature_loop | small targetRepeat accepted (0.2 km < 0.4 km tolerance) |
| T12-B2 | urban_nature_loop | large targetRepeat rejected (0.5 km > 0.4 km tolerance) |
| T12-scope-park | park_loop | no tolerance applied (regression guard) |
| T12-scope-ttw | transition_to_woods | no tolerance applied (regression guard) |

The positive tests (A1, B1) force the assembler into the ONLY viable
closure candidate being slightly out of strict budget, so the patch is
actually exercised (avoids the synthetic-test pitfall documented in
the loaded `trailforge-v3-t12-closure-contract-tolerance` skill).

## 5. Expected metrics

### Fontainebleau (forest_loop, gatekeeper)
Baseline `baselines.json`:
- outcome: `adjusted`
- naturalDwellKm: 11.91 (≥ 11.0 required)
- trailRatio: 0.982 (≥ 0.95 required)
- distanceProducedKm: 12.124 (within ±0.001)
- repeatRatio: 0.0089 (< 0.05)
- repeatBudgetExceeded: false

Expected after T12: BYTE-IDENTICAL. The patch is scoped to
`urban_nature_loop` only; `forest_loop` does not reach
`selectUrbanNatureComponentRouteEdges`.

### Tourville (transition_to_woods, secondary gatekeeper)
Baseline:
- outcome: `refused`
- targetRepeatKm: 3.27 (> 3.0 required)
- repeatBudgetExceeded: true
- rejectedBecauseTargetRepeat: false

Expected after T12: BYTE-IDENTICAL. The patch is scoped to
`urban_nature_loop` only; `transition_to_woods` does not reach
`selectUrbanNatureComponentRouteEdges`.

### Tests
- Before T12 commit: 545 passed / 0 failed / 6 todo (533 baseline + 12 T15 IGN POC tests @ 285b3c6)
- After T12 commit: 551 passed / 0 failed / 6 todo (533 + 12 T15 + 6 T12 new RED→GREEN)

## 6. Rejection criteria

- HOLD if any T12 test fails on the dirty tree (TypeScript, lint,
  vitest).
- HOLD if Fontainebleau `naturalDwellKm < 11` or `trailRatio < 0.95`
  or `distanceProducedKm` drift > 0.001 km.
- HOLD if Tourville `outcome !== refused` or `targetRepeatKm ≤ 3.0`
  or `repeatBudgetExceeded === false` or
  `rejectedBecauseTargetRepeat === true`.
- HOLD if the patch touches any file outside the authorized list.
- HOLD if `tf:verify` fails for any reason OTHER than the expected
  test profile drift (533 → 551 passed after T12 commit: +12 from
  T15 IGN POC at 285b3c6 + 6 from T12).

## 7. Limits

- T12 does NOT validate urban_nature benchmark panels; only
  Fontainebleau + Tourville. The `npm run benchmark:engine-v3:beta-multiterrain`
  panel is NOT run in Phase 0; it is deferred to a future T13 or
  later ticket.
- T12 does NOT touch the WIP stash@{0} (7-file extraction-fix WIP).
  That stash remains protected per policy.json.
- T12 does NOT push 285b3c6 (T15 IGN POC wiring attempt). Per Phase 0
  Option F, the T15 commit is deferred to a separate T17 ticket.

## 8. Verification gate

After dirty patch verification passes:
1. Atomic commit of engine + tests + queue + this report.
2. Re-run `npm run tf:verify` on the committed state to capture
   measured values.
3. If measured `tests.passed = 551` and benchmarks are byte-identical,
   refresh `.trailforge-agent/baselines.json` with measured numbers.
4. Separate `chore(agent)` commit for the baseline refresh.
5. Final state: repo clean, 2 commits ahead of origin, 0 unpushed,
   0 stashed, no Phase 1 CI/CD.