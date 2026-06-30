# LOCAL-STASH-GATE-ORDER

## Context

PR #6 (commit 62d297e) made the local stash integrity gate skip in CI so that
GitHub Actions runs stop failing on a stash state the runner cannot preserve.
That fix was correct but the underlying gate was still fragile: it required
the protected `wip-v3-extraction-fix-7files-04b7409-20260616T222406Z` stash
to be at the exact `stash@{0}` index.

On 2026-06-29 14:21:38 a routine
`trailforge-weekly-cleanup-20260629-142138 before repo cleanup` stash was
pushed on top of the protected one, dropping the WIP to `stash@{1}`. The
local `npm run tf:verify` then failed at gate `[3/8]` even though the
protected WIP was still present, intact (7 files, 1001 insertions, same set
as `baselines.json.expected_stash.files`), and only two slots deep.

The gate's job is to detect loss or corruption of the protected WIP, not to
enforce a specific stash-list ordering. Requiring `stash@{0}` was an
incidental implementation detail masquerading as a safety net.

## Decision

Make the gate independent of stash ordering.

The protected stash is identified by its message
`wip-v3-extraction-fix-7files-04b7409-20260616T222406Z`, not by its position
in the list. The gate scans the full output of `git stash list`, finds the
first entry whose subject contains the protected message, extracts its real
index (e.g. `stash@{1}`), and reports it. If the message is absent, the
gate fails.

## Constraints honored

- No engine files modified.
- No tests modified.
- `baselines.json` untouched.
- `policy.json` untouched.
- `package.json` / `package-lock.json` untouched.
- No workflow files modified.
- `HERMES.md` untouched.
- No `git stash pop` / `apply` / `drop` / `clear`.
- No `git push`.
- No `git reset`.
- CI skip behavior preserved (same `isCi` condition as gate 2 branch check).

## Files changed

- `scripts/trailforge-verify.mjs` — gate 3 logic rewritten
- `.trailforge-agent/reports/LOCAL-STASH-GATE-ORDER.md` — this report

## Validation results

- `git status --short --branch`: clean, branch in sync with origin pre-patch
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run test:run -- --reporter=verbose`: 551 passed / 0 failed / 6 todo
- `npm run tf:verify` (local): PASS — gate [3/8] reports
  `protected stash found at stash@{1}`
- `GITHUB_ACTIONS=true CI=true npm run tf:verify` (simulated CI): PASS —
  gate [3/8] reports `[SKIP in CI] ...`
- `git diff --stat`: 2 files, +report / +verify gate rewrite
- Protected stash index detected: `stash@{1}`
- No stash mutation between MAP and final state.

## Strictness preserved

The gate does not:

- Accept the weekly-cleanup stash as a valid substitute.
- Soften to a warning on miss.
- Change the protected message literal.

The gate still fails hard if the protected message is absent from the stash
list, and CI still skips entirely (the same protection PR #6 added).
