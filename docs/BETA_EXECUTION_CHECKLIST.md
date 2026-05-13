# TrailForge — Closed Beta Execution Checklist

Date: 2026-05-12
Status: active checklist

## 0. Freeze

- [x] Pause active TrailForge cron/watch jobs.
- [x] Kill profile-scoped TrailForge Kanban dispatcher loop.
- [x] Confirm no TrailForge worker is running.
- [x] Confirm Kanban has 0 running / 0 ready tasks.

## 1. Repo baseline decision

Current state:

- Branch: `feat/p1-2-quality-ratio-interpretation`
- Local HEAD: `071b933 Refine IGN terrain context artifacts`
- Remote feature HEAD: `02970a1 Add IGN terrain context POC artifacts`
- Local ahead: 1 commit
- Working tree: clean before adding this beta documentation

Decision needed before code resumes:

- Do not push `071b933` as beta-critical.
- Decide whether to:
  - keep `071b933` local as R&D,
  - push it to feature as R&D-only documentation/data work,
  - or branch beta from `02970a1` / earlier clean beta-scope commit.

Recommended default:

- Branch beta from `origin/feat/p1-2-quality-ratio-interpretation` at `02970a1`.
- Keep `071b933` as R&D unless Clément explicitly wants to preserve it remotely.

## 2. Product contract work

Implement or verify these user-facing statuses:

- `generated`
- `adjusted`
- `refused`

Each generation must expose:

- requested distance
- produced distance
- mode / route promise
- status
- human-readable reason if adjusted/refused
- paved/natural/trail or non-paved summary
- GPX export availability
- feedback capture id / generation id

## 3. Beta behavior panel

Create a small beta behavior panel, not a national readiness panel.

Required categories:

- Tourville 8k transition-to-woods
- Caen Colline aux Oiseaux 5–6k nature-urban / park recovery
- one strong forest case
- one Suisse normande / Clécy-style case
- one small Normandy town / semi-rural path network
- one dense urban negative case
- one small-park-too-long negative case
- optional Fontainebleau if stable

Pass rule:

- Outputs must be honest, not necessarily all “success”.
- Adjusted/refused can pass if the product promise is clear and correct.

## 4. Beta launch gates

Hard gates before tester recruitment:

- Map route and exported GPX match.
- GPX opens in common tools.
- Trail mode does not silently accept mostly paved routes.
- Adjusted distance is explicit.
- Refusal reasons are understandable.
- Simple compatible zones do not time out regularly.
- Feedback collection works.
- No autonomous agent is modifying the repo during beta prep unless explicitly restarted.

## 5. Tester loop

Target:

- 15–30 testers.
- 10 route generations.
- 5 GPX exports.
- 5 qualitative feedbacks.
- 3 explicit reuse signals.

Feedback fields:

- route id / generation id
- location
- requested mode/distance
- output status
- tester verdict: usable / too paved / private access / bad geometry / too short / other
- screenshot or GPX if available
- would reuse: yes/no/maybe

## 6. Work intentionally excluded

Do not make these beta blockers:

- IGN scoring
- Meudon restricted-access perfection
- Tourville 12k
- Paris dense
- full readiness panel
- ML/taste dataset
- advanced D+ optimization
- making every historical benchmark green
