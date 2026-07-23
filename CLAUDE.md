# CLAUDE.md — Fairway Vatos

## Architecture

Pure HTML/CSS/JS PWA. No build step, no framework, no npm. Everything is in three files:

- `index.html` — all screens as `<div class="screen">` elements, only one visible at a time via `show(id)`
- `app.js` — all logic in one IIFE; globals at the top, functions below
- `styles.css` — all styles; uses CSS custom properties for theming

Firebase compat SDK (v10.12.0) loaded via CDN in `index.html`. Never use the modular SDK — it requires a build step.

## Deployment

Every change must bump the SW cache version in `sw.js`:
```js
const CACHE = 'fairway-vatos-vN'; // increment N on every push
```
Push to `main` → GitHub Pages deploys automatically. No CI, no build.

## Key Globals (app.js)

| Variable | Type | Description |
|----------|------|-------------|
| `currentUser` | Firebase User | Signed-in user, null if logged out |
| `players` | `[{name, uid}]` | Players in the current round |
| `scores` | `score[hole][playerIdx]` | 2D array, null = not entered |
| `touched` | `bool[hole][playerIdx]` | Whether a score has been entered |
| `puttOff` | object | Active putt-off state (`{pot, winnerIdx}` or `{pot, winTeamIdxs, loseTeamIdxs}`) |
| `knownUsers` | `[{name, uid}]` | Current user + their friends, used by player picker |
| `gameType` | `'hog' \| 'scramble' \| 'stroke' \| 'card'` | Active game type |
| `stake` | number | Dollar amount per hole/skin |
| `currentDetailId` | number | Round ID open in history detail |

## Auth & Users

- Email format: `username@fairwayvatos.app`
- Firestore user doc: `users/{uid}` → `{ firstName, lastName, username, name: firstName, uid }`
- Legacy accounts (before structured signup) only have `name` and `uid`
- `displayName` in Firebase Auth = first name only
- `shortName(p)` returns first word of `pname(p)` — used everywhere on scorecards
- Friends stored in `users/{uid}/friends/{friendUid}` subcollection

## History / Round Data

Rounds saved to:
1. `localStorage` key `hog_rounds` (primary, fast)
2. `users/{uid}/rounds/{id}` in Firestore (backup, sync)

Round object shape: `{ id, date, courseName, courseSub, tee, gameType, players, scores, money, puttOff?, scrambleTeams?, holeCount, nineChoice }`

- `calcHistMoney(r)` — read-only money recalculation, no writes. Use this in `viewRound`.
- `recalcHistRound(r)` — full recalculation with localStorage + Firestore save. Use after editing scores.
- Never call `recomputeAll()` directly in history context without first reconstructing `touched` from scores.

## Screens

Navigate with `show('sc-id')`. All screens:

| ID | Description |
|----|-------------|
| `sc-login` | Sign in / create account |
| `sc-home` | Home with primary action + secondary grid |
| `sc-courses` | Course picker |
| `sc-setup` | Round setup (game type, players, stake) |
| `sc-game` | Active scoring |
| `sc-totals` | Scorecard + money breakdown after round |
| `sc-history` | Saved rounds list |
| `sc-history-detail` | Individual round detail |
| `sc-handicap` | Handicap tracker |
| `sc-leaderboard` | All-time leaderboard |
| `sc-friends` | Friends management + account deletion |

## CSS Conventions

- Custom properties defined on `:root` in `styles.css`; dark mode via `@media (prefers-color-scheme: dark)` and `:root[data-theme]`
- Key tokens: `--bg`, `--bg2`, `--bg3`, `--bg4`, `--tx`, `--tx2`, `--tx3`, `--blue`, `--green`, `--red`, `--sep2`, `--shadow`, `--r`, `--r-sm`
- Nav bar pattern: `<div class="nav-bar"><div class="nav-row">` with `.nav-btn` left, `.nav-center > .nav-title` center, spacer right
- Cards: `background: var(--bg2); border-radius: var(--r); box-shadow: var(--shadow);`

## Important Invariants

- **Never call `recomputeAll()` in history context** without setting `touched` first
- **Never use `r.money` directly in `viewRound`** — always call `calcHistMoney(r)` to get a fresh calculation
- **Firestore writes always use `merge: true`** on user docs to avoid overwriting fields
- **Account deletion order:** delete Firestore data first, then `currentUser.delete()` last — so the user stays authenticated throughout cleanup and can retry if anything fails
- **Service worker must be bumped** on every deploy or clients won't get the update

## Things to Avoid

- Do not switch to the modular Firebase SDK — no build tooling exists
- Do not add npm, webpack, or any build step
- Do not import external fonts via CDN — CSP blocks them in the PWA context
- Do not use `r.money` in history views — it can be stale from pre-putt-off saves
