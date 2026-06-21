# CI: tf:verify stash gate skip — Phase 1 follow-up

## Context

After Phase 1 CI/CD hardening landed on commit `2e32f5a`, GitHub Actions
began running `npm run tf:verify` on every push. The harness has 8 gates
sequentially, and gate [3/8] is the **local stash@{0} integrity check**:
it expects `git stash list` to contain a top entry with the message
`wip-v3-extraction-fix-7files-04b7409-20260616T222406Z`.

That stash is a VPS-local artifact of the V3 engine change protocol:
it holds the WIP of an extraction-fix branch that the engine change
protocol explicitly forbids applying via `stash pop` / `cherry-pick`.
Its presence on the developer's VPS is a deliberate invariant of the
local workflow — not something a CI runner can reproduce.

## Failure (exact)

```
[FAIL] stash@{0} message — actual="" expected contains "wip-v3-extraction-fix-7files-04b7409-20260616T222406Z"
```

All other gates passed (typecheck, lint, tests 551/0/6, Fontainebleau, Tourville).

## Root cause

The stash integrity gate is **VPS-local safety net**. It is not part of
the contract the engine code must satisfy in CI — it is part of the
contract the *local Hermes workflow* must satisfy on the developer's
machine. On a fresh GitHub Actions runner, `git stash list` is empty
because the runner has no local repository state, no local WIP stash,
and no developer-machine git refs.

## Fix (minimal)

`scripts/trailforge-verify.mjs`, gate 3 only:

- Detect CI via the **dual check** `process.env.GITHUB_ACTIONS === "true" && process.env.CI === "true"`. Both must be true to skip — a single trigger is too loose (e.g. some IDEs set `CI=true` locally).
- In CI, mark the gate as **passed with explicit skip reason**:
  `[SKIP in CI] skipped in CI because GitHub Actions runners do not preserve local Hermes stash state`
- Local behavior is **byte-identical** to the previous path: same
  failure detection, same error message format, same `recordFailure` call.
- The `git stash list` *command failure* path (e.g. git not installed)
  still fails the gate in CI — we only skip the **content check**, not
  the command execution.

## Files touched

- `scripts/trailforge-verify.mjs` — gate 3 block only (+12 / -0)
- `.trailforge-agent/reports/CI-TFVERIFY-STASH-GATE.md` — this file (new)

## Forbidden actions (respected)

- Engine files (`lib/engine-v3/**`, `lib/engine/**`): untouched
- Tests: untouched
- `baselines.json`: untouched
- `package.json`: untouched
- `HERMES.md`: untouched
- Workflows (`.github/workflows/*.yml`): untouched
- Stash gate: still enforced locally, not removed anywhere
- Local `npm run tf:verify`: PASS unchanged (stash@{0} integrity still checked on VPS)

## Validation gates run

1. `git status --short --branch` — clean except for the two intended files
2. `npm run typecheck` — PASS
3. `npm run lint` — PASS
4. `npm run test:run -- --reporter=verbose` — PASS, profile matches baseline
5. `npm run tf:verify` (local, no CI env) — PASS, stash gate still enforced
6. `GITHUB_ACTIONS=true CI=true npm run tf:verify` — PASS, gate 3 marked `[SKIP in CI]`
7. `git diff --stat` — exactly the two intended files
8. `git diff -- scripts/trailforge-verify.mjs` — review-ready diff

## Why this is safe

- The stash gate is a **local-Hermes workflow invariant**, not a code-correctness invariant. The code being verified is committed to git, not sitting in a stash.
- Engine files unchanged → zero impact on benchmarks, baselines, or product behavior.
- The CI gate count stays at 8/8 — the SKIP is explicit and visible in the run log, not a silent omission.
- A future `git stash list` command failure on the runner still fails the gate, so CI doesn't become a rubber-stamp.
- If anyone later wants to make the stash gate mandatory in CI (e.g. by replicating the WIP as a fixture in the repo), this patch is a single-file revert away.