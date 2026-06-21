## TrailForge V3 protocol — required fields

Every PR must declare its mode and follow HERMES.md. Fill in every section; do not leave placeholders.

### Mode

- [ ] MAP (read-only call graph)
- [ ] PLAN (minimal patch plan)
- [ ] PATCH (apply only what PLAN authorizes)
- [ ] VERIFY (re-run tf:verify, report deltas)
- [ ] RETRO (closure of a T-series ticket or wave)

### Scope

- **Branch** : `<source>` → `<target>`
- **Mode declared in PR title** : `Mode X — <name>`
- **Files changed** :
  - `<path/to/file>` — `<one-line reason>`
- **Engine files touched** (`lib/engine-v3/**`, `lib/engine/**`) :
  - `<list or "none">`
- **Tests changed** :
  - `<list or "none">`
- **Baselines touched** (`.trailforge-agent/baselines.json`) :
  - `<yes / no>` (separate `chore(agent)` commit if yes)

### Verification commands run

- [ ] `npm run typecheck` — PASS
- [ ] `npm run lint` — PASS
- [ ] `npm run test:run` — PASS, profile = `<failed>/<passed>/<todo>` (baseline = `0/551/6`)
- [ ] `npm run tf:verify` — PASS, 8/8 gates green
- [ ] `npm run build` — PASS (if engine files or deps changed)

### Baseline policy

- [ ] Test profile delta vs baseline `0/551/6` is `+0/+0/+0` (or drift explained)
- [ ] Fontainebleau `naturalDwellKm ≥ 11`, `trailRatio ≥ 0.95`, `outcome=adjusted`
- [ ] Tourville `outcome=refused`, `targetRepeatKm > 3`, `repeatBudgetExceeded=true`

### Risk

- [ ] SAFE — docs only, tests only, type plumbing
- [ ] SEMI_AUTONOMOUS — scripts, non-engine fixtures
- [ ] HUMAN_REQUIRED — engine files (`lib/engine-v3/**`, `lib/engine/**`)

### Forbidden confirmations

- [ ] No `git stash pop`, `git cherry-pick`, `git push --force`
- [ ] No `lib/engine-v3/**` modifications outside authorized list
- [ ] No baseline mutation in this commit (separate `chore(agent)` commit if needed)
- [ ] No WIP stash reapplication in one block

### Linked ticket

- `.trailforge-agent/queue.json` ticket id : `<T##-...> or none>`
- `.trailforge-agent/reports/<T##-PLAN.md>` : `<attached or none>`