# TrailForge beta evidence check

`npm run release:evidence-check` verifies the post-push beta-scope evidence without rerunning live smoke benchmarks.

It reads `artifacts/route-benchmark-results/beta-smoke-latest.json` and `lib/route-benchmarks-data.json`, then fails if the beta evidence is incomplete or overclaims readiness.

Checks covered:

- current git branch is `main`;
- local `HEAD` contains the expected beta base commit, and `origin/main` is still either that beta base or the same local head if pushed later;
- working tree is clean at sign-off time;
- beta smoke remains exactly 4/4 with no failed or skipped case;
- beta smoke contains exactly these four case IDs once each: `fontainebleau-trail-15k`, `caen-colline-aux-oiseaux-6k-soft`, `meudon-forest-trail-10k`, `tourville-pommiers-trail-8k`;
- `ga_status` remains `NO-GO_GA` and Tourville 12 km remains a readiness blocker;
- anti-laundering flags stay false: `thresholdsChanged`, `surfaceReclassification`, `typedRefusalMasked`;
- expected typed refusals keep an explicit `actualOutcome: "typed_refusal"` and the expected sub-code;
- adjusted-distance outcomes expose `metrics.adjustedDistanceKm` and stay inside the approved range when one exists;
- successful beta routes keep route JSON and edge diagnostics artifacts;
- typed refusals keep rejected-candidate diagnostics either as an artifact or inline in the report;
- result thresholds, when emitted, match the benchmark data rather than silently drifting.

For local unit tests only, `scripts/release-evidence-check.mjs --skip-git --report <tmp-report> --benchmark-data <tmp-data>` skips git branch/head/status checks. Do not use `--skip-git` for QA sign-off.

This check is deliberately conservative. It proves “beta candidate evidence is coherent”, not “GA ready”. Tourville 12 km/readiness blockers must stay visible until solved by a separate engine/scoring mission.
