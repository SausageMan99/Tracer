# V3 assembler current truth — WF-0 freeze

Date: 2026-05-20
Branch: `wip/v3-fontainebleau-loop-quality`
Checkpoint: `a73909a feat(engine-v3): improve mission-driven assembler evidence`
Evidence:
- Aggregate: `/tmp/trailforge-v3-assembler-review.json`
- Tourville case: `/tmp/trailforge-v3-assembler-review-routes/tourville-pommiers-trail-8k.json`
- Fontainebleau case: `/tmp/trailforge-v3-assembler-review-routes/fontainebleau-trail-12k.json`

## Executive truth

ASM-3 moved the real two-case V3 assembler review from refused/no-geometry to `adjusted` outcomes with selected candidates, GeoJSON and GPX artifacts. This is real engineering progress, but it is not beta-ready and not product-green.

The current assembler can now produce route evidence, ordered geometry, export artifacts, route metrics, candidate lanes and selected-candidate diagnostics. The remaining blockers are algorithmic route-quality blockers, not missing artifact plumbing.

Do not treat the aggregate `success: true` as product success. It means the benchmark command completed and wrote artifacts. The product truth is: `generated: 0`, `adjusted: 2`, `refused: 0`, `errored: 0`.

## Tourville Pommiers 8k

Outcome: `adjusted`.

Current metrics from `/tmp/trailforge-v3-assembler-review-routes/tourville-pommiers-trail-8k.json`:
- targetDistanceKm: 8
- distanceProducedKm: 10.710
- strictTrailKm / naturalDwellKm: 6.531
- trailRatio / naturalWayRatio: 0.610
- pavedKm: 0.080
- pavedRatio: 0.008
- repeatEdgeKm: 5.355
- targetRepeatKm: 3.266
- connectorRepeatKm: 2.089
- repeatRatio / overlapRatio: 0.305
- longestTrailSegmentKm: 6.531
- selectedReason: `mission-driven:long_dirty`
- candidateCount: 2
- inEnvelopeCount: 1

Current blocker: entry/exit-lateral target repeat. The route reaches useful field-path/natural dwell and is low-paved, but it does so with too much repeated target terrain. The repeat/overlap ratio exceeds the generated limit of 0.2, so the honest outcome remains `adjusted`.

Implication: the next Tourville work should focus on entry/exit alternatives and lateral target traversal that preserves natural dwell without repeating the same target edges. Do not “fix” this by reducing distance, abandoning target dwell, or hiding target repeat under connector repeat.

## Fontainebleau 12k

Outcome: `adjusted`.

Current metrics from `/tmp/trailforge-v3-assembler-review-routes/fontainebleau-trail-12k.json`:
- targetDistanceKm: 12
- distanceProducedKm: 10.000
- strictTrailKm / naturalDwellKm: 5.994
- trailRatio / naturalWayRatio: 0.599
- pavedKm: 1.558
- pavedRatio: 0.156
- repeatEdgeKm: 2.003
- targetRepeatKm: 0.591
- connectorRepeatKm: 1.412
- repeatRatio / overlapRatio: 0.059
- longestTrailSegmentKm: 5.994
- selectedReason: `mission-driven:cycle_or_lateral`
- candidateCount: 7
- inEnvelopeCount: 6
- complete_valid: 0
- complete_adjustable: 6

Current blocker: distance-envelope multi-cycle chaining. The cycle/lateral path is much cleaner than previous Fontainebleau attempts and keeps repeat low, but it under-delivers the requested 12km at about 10km. The forest component has enough theoretical capacity, yet the selected candidate does not chain enough usable cycles/corridors to hit the distance envelope.

Implication: the next Fontainebleau work should extend multi-cycle or corridor chaining while preserving the low target-repeat profile. Do not call the current route generated/product-green until it reaches the distance envelope with exportable geometry and honest paved/natural metrics.

## Shared warnings to preserve

- V3 API wiring remains intentionally disabled in this evidence path.
- Paved/asphalt evidence remains paved; scenic paved is not reclassified as trail.
- The graph adapter still infers large mixed-surface unknown buckets: 32.664km in Tourville and 117.205km in Fontainebleau.
- Current results are useful for assembler truth and next-step planning, not for beta release claims.

## Next workflow

Continue with the already scoped sequence:

1. ASM-2f — repair Tourville entry/exit-lateral target repeat.
2. ASM-2g — repair Fontainebleau distance-envelope multi-cycle chaining.
3. ASM-3b — rerun independent two-case QA/product verdict after those repairs.
4. ASM-4b — create a local checkpoint only if QA is green-for-checkpoint; no push unless explicitly authorized.

Acceptance for the next algorithm wave should remain product-honest: generated or acceptable adjusted routes with GeoJSON/GPX, distance envelope respected where terrain supports it, no silent under-distance, no target-repeat gaming, and no surface-ratio laundering.
