# CI tf:verify branch gate fix

## Context

PR #6 (`fix(ci): skip local stash integrity gate in GitHub Actions`) added a
CI-aware skip on gate [3/8] (stash@{0} integrity). The stash gate fix landed
cleanly, but a second CI-incompatible gate remained: gate [2/8] (git HEAD on
expected branch).

## Root cause

GitHub Actions PR workflows check out the merge ref
`refs/pull/<id>/merge` as a **detached HEAD**. Inside that checkout:

- `git rev-parse --abbrev-ref HEAD` returns `HEAD`
- `git branch --show-current` returns empty

Both are correct git semantics, but they make the local branch gate
("HEAD must be on `trailforge-v3-clean-from-04b7409`") impossible to satisfy
in CI even when the PR is structurally correct.

The branch gate is a **VPS-specific safety net** that protects the developer
from running the verify harness while on a transient fix branch. It is not
load-bearing in CI — the runner cannot choose a different branch anyway, and
the actual change being verified is the diff of the PR.

## Fix

Mirror the same pattern used for the stash gate:

1. Promote the `isCi` constant to the top of the script (after Gate 1 setup)
   so it can be referenced by both Gate 2 and Gate 3 without temporal dead
   zone issues.
2. In Gate 2, when `isCi` is true **and** the branch check fails, mark the
   gate as `PASS` with a `[SKIP in CI]` reason explaining the detached HEAD
   behavior.
3. Local behavior is unchanged: when `isCi` is false, the gate still fails
   with `actual=<branch> expected=trailforge-v3-clean-from-04b7409`.

`isCi` detection requires **both** `GITHUB_ACTIONS=true` and `CI=true`. A
single trigger is too loose — dev shells sometimes export one of these env
vars by accident and we must not silently bypass local verification.

## Validation

Local (`npm run tf:verify`):
- Gate [2/8] FAILs on `fix/ci-stash-gate-skip` (proves local enforcement intact)
- Gate [3/8] FAILs on current stash drift (pre-existing, unrelated)
- All other gates PASS
- Stash gate fix still works (no regression)

Simulated CI (`GITHUB_ACTIONS=true CI=true npm run tf:verify`):
- Gate [2/8] PASS `[SKIP in CI] skipped in CI because GitHub Actions PR checkout uses detached HEAD merge refs`
- Gate [3/8] PASS `[SKIP in CI] skipped in CI because GitHub Actions runners do not preserve local Hermes stash state`
- All other gates PASS
- RESULT: PASS — all gates green

Partial-trigger guard:
- `GITHUB_ACTIONS=true CI=false` → branch gate still FAILs locally (correct)
- `GITHUB_ACTIONS=false CI=true` → branch gate still FAILs locally (correct)

## Files changed

- `scripts/trailforge-verify.mjs` (1 file, 19 insertions, 4 deletions)

## Out of scope

- No engine files modified
- No tests modified
- No baselines modified
- No package.json or package-lock.json modified
- No workflows modified
- No HERMES.md modified
- Branch gate not removed, only CI-adapted
- Local Hermes verification protocol intact
