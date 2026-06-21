# CI

TrailForge uses GitHub Actions on the protected branch
`trailforge-v3-clean-from-04b7409`. This document explains what each gate
validates, how to read a failure, and the merge-gate contract.

## Workflows

| File | Purpose | Required for merge |
|------|---------|--------------------|
| `.github/workflows/ci.yml` | Typecheck, lint, tests, `tf:verify`, build | **Yes** — required check |
| `.github/workflows/codeql.yml` | Weekly + PR security scan | **No** — warn-only visibility in Phase 1 |
| `.github/dependabot.yml` | Weekly npm + GitHub Actions updates | n/a — opens PRs, never auto-merge |

## CI commands (in order)

The `CI` workflow runs on every pull request and every push to
`main` and `trailforge-v3-clean-from-04b7409`. Steps in order:

1. `npm ci` — clean install from `package-lock.json`
2. `npm run typecheck` — `tsc --noEmit`
3. `npm run lint` — `eslint .`
4. `npm run test:run -- --reporter=verbose` — Vitest in jsdom
5. `npm run tf:verify` — 8-gate agentic harness (see below)
6. `npm run build` — `next build --webpack`
7. Upload `artifacts/engine-v3-benchmarks/agent-verify-*` on every outcome

## `tf:verify` — 8 sequential gates

The TrailForge agentic verification harness runs 8 gates. A failure on any
blocking gate fails the workflow.

| # | Gate | Blocking? |
|---|------|-----------|
| 1 | git working tree clean | yes |
| 2 | HEAD on expected branch | yes |
| 3 | `stash@{0}` integrity | yes |
| 4 | `tsc --noEmit` | yes |
| 5 | `eslint .` | yes |
| 6 | Vitest profile vs `baselines.json` | yes |
| 7 | Fontainebleau benchmark | yes |
| 8 | Tourville benchmark | yes |

Gate 6 baseline is `0 failed / 551 passed / 6 todo`. Gates 7-8 require
Fontainebleau `outcome=adjusted`, `naturalDwellKm ≥ 11`, `trailRatio ≥ 0.95`;
Tourville `outcome=refused`, `targetRepeatKm > 3`, `repeatBudgetExceeded=true`.

## CodeQL — warn-only in Phase 1

CodeQL runs weekly + on every PR, but findings are **not** a required
status check in Phase 1. The first run typically surfaces a backlog of
historical findings. Track them in the GitHub Security tab; promote them
to required status in Phase 1.1 once triaged.

## Dependabot — no auto-merge

Dependabot opens PRs for npm and GitHub Actions updates every Monday at
09:00 Europe/Paris. **No auto-merge is configured.** Every dependency PR
requires human review by `@SausageMan99`.

Engine-touching dependency updates (anything affecting `lib/engine-v3/**`
or `lib/engine/**`) must be reviewed by `@SausageMan99` before merge
regardless of the Dependabot config.

## Branch protection (manual, apply on GitHub UI)

Settings → Branches → `trailforge-v3-clean-from-04b7409`:

- ☑ Require a pull request before merging
- ☑ Require approvals: 1 (single-owner repo, self-review blocked by UI)
- ☑ Dismiss stale pull request approvals when new commits are pushed
- ☑ Require status checks to pass before merging
  - Required checks: `ci`
- ☑ Require conversation resolution before merging
- ☑ Require linear history (no merge commits)
- ☑ Include administrators
- ☐ Allow force pushes: NO
- ☐ Allow deletions: NO

## Reading a CI failure

1. Click the failed check → expand the failing step.
2. If it's `tf:verify` gate X, see `.trailforge-agent/reports/` for the
   ticket MAP/PLAN that authorized the patch.
3. Download the `tf-verify-<run-id>` artifact for the per-case JSONs.
4. Compare measured values against `.trailforge-agent/baselines.json`.
5. Engine regression = roll back the PR commit; never relax a gate threshold.