# Sleep Diary — Design & Handoff Log

A desensitized record of how this tool is built and why, for anyone picking it up next.
It contains **no personal or health information** — only architecture and decisions.

## What it is
A static, zero-build single-page web app (vanilla HTML/CSS/JS + Chart.js via CDN) hosted on
GitHub Pages. It's a generic sleep-tracking tool: log nightly factors, see doctor-style
stats and charts, and optionally export a privacy-preserving prompt to ask an AI.

## Principles
- **No backend.** Everything runs in the browser; GitHub Pages serves static files.
- **Privacy first.** No personal/health wording in the committed code or UI. Real data
  lives only in a separate **private** data repo. Tokens/coordinates are never committed.
- **Offline-first.** localStorage is the working store; the network is an enhancement.
- **Zero build.** Native ES modules + CDN Chart.js, so deploying is just `git push`.

## Architecture
```
index.html            SPA shell (3 tabs: Summary / Log / Settings) + modal + motto bar
sw.js                 Network-first service worker (cache:no-store) → fresh after deploy, offline fallback
css/                  tokens (incl. time-of-day themes) · base · layout (responsive) · components
js/
  config.js           Constants: scales, words, doses, defaults, experiment options, LS keys
  util.js             Pure helpers: time math (midnight-crossing), base64, stats (mean/std/pearson), dates
  storage.js          localStorage: monthly buckets, settings, sha cache, dirty queue, token, check-ins
  github-sync.js      GitHub Contents API: getFile(404-aware)/putFile(sha), merge, flushDirty
  weather.js          Open-Meteo (no key) + geolocation → bedroom temp proxy, manual override
  util.js             …plus timezone helpers (UTC ↔ configured IANA zone)
  stats.js            computeNight (efficiency/TST/WASO/naps), summarize, correlate, comments
  charts.js           Chart.js renderers (timeline, TST±naps, quality, scatter, exercise,
                      alertness-by-hour, custom-tracker traces); reads theme colors at render
  ai-export.js        Pseudonymized prompt/JSON builder + clipboard/download
  ui.js               DOM build/read; calendar; check-ins editor; ratings; multi-slider
                      check-in modal; mottos; theme; settings (trackers, chart toggles, tz)
  app.js              Controller: load → migrate → render → sync; wiring; date-driven Log
```

## Data model (in the private data repo)
- Monthly file `entries/YYYY-MM.json`: `{ month, schemaVersion, entries{date→Entry}, sleepiness[] }`.
- `settings.json`: `defaults` (alarm, target sleep band), `experiment`, `timezone`,
  `trackers` (custom check-ins), `charts` (which Summary plots show), `napsInTotal`,
  `includeNotes`, `aiPrompt`, `mottos`.
- **Entry** keyed by the **wake-up morning date**. Clock times are wall-clock `HH:MM`
  (`alarmTime` may be `null` for no-alarm days). Ratings are **1–10, higher = better**
  (`quality`, `wakeEase`, `morningAlertness`). Other fields: `wakeTime`, `outOfBedTime`
  (= final get-up), `bedtime`, `sleepOnset`, `waso` (min awake in the night),
  `napTime` + `napMinutes`, melatonin, sunlight, exercise, dinner, bedSnack, caffeine,
  `bedroomTempC`, `notes`, `tstMinutes`/`tstSource`.
- **Check-in** (`sleepiness[]`): `{ id, datetime (UTC ISO), type, level (1–10), note,
  _v2, deleted? }`. `type` is `"alertness"` (built-in) or a custom tracker name. Soft-delete
  tombstones converge removals across devices; `_v2` marks records already on the current
  scale (see Migrations).

## Sync & multi-device convergence
- PUT/GET via the GitHub Contents API using a fine-grained PAT (Contents: read/write) held
  only in localStorage. SHA tracked per path; 404 = first-write.
- **Merge:** per-date last-writer-wins (`updatedAt`) for entries; union-by-id (newer wins)
  for check-ins. Conflicts (409/422) re-fetch + merge + retry once. An offline dirty queue
  flushes on reconnect/visibility.

## Key decisions
- **Date attribution:** entry = the morning you woke; evening factors belong to the night
  before; a post-midnight bedtime (02:00) counts as the wake-up day. Duration math uses a
  +24h rule, so it's correct regardless of calendar date.
- **Timezone:** check-in timestamps are stored **UTC**, displayed/edited/charted through a
  **configurable IANA timezone** (`settings.timezone`, default Pacific); bucket by zoned date
  so logging near midnight lands on the right day. Never slice an ISO string for display.
- **Sleep efficiency:** `TST / TIB`, with `TIB = bedtime → final get-up` and
  `TST = (onset → final get-up) − WASO` (final get-up = `outOfBedTime || wakeTime`, so
  sleeping in is counted; awake time in that window goes to WASO). Naps are excluded from
  efficiency and added to a separate 24h total.
- **Unified scales:** all ratings reframed to higher = better so one red→green ramp and one
  word ladder apply everywhere; calendar dots are colored by quality.
- **Single date-driven Log:** a month calendar (dots = logged, colored by quality) drives a
  reusable form (calendar | nap | check-ins on top). The editable check-ins panel manages a
  day's logs. No separate history tab.
- **Custom check-ins:** users define extra trackers in Settings; one shared modal shows a
  slider per tracker (enable + drag), logged together. Custom trackers get **trace plots**
  but are **private** (excluded from the AI export).
- **Configurable Summary:** each chart (timeline, total-sleep ±naps line, quality/alertness,
  experiment scatter, exercise, daytime alertness, custom-tracker traces) can be toggled.
- **Theming:** `data-daypart` on `<html>` swaps light (morning/day, 08:00–20:00) vs dark
  (evening/night, 20:00–08:00) palettes; charts read CSS variables so they stay legible on
  both; a rotating motto bar sits at the very top.
- **Freshness:** network-first SW with `cache:no-store` avoids "new HTML + stale JS" skew
  on mobile and enables offline use.
- **Migrations:** `storage.migrateScales()` is **idempotent** and runs on load **and after
  every sync** (not a one-shot flag). Entries detected by old field names; check-ins inverted
  once via the `_v2` marker. *(Lesson: gate migrations on per-record state, not a boot flag.)*
- **Ask-AI export:** a paste-ready prompt = editable patient-framed persona + field legend +
  question + data, with **dates shifted to a neutral year** (intervals + weekdays preserved),
  zoned check-in times, token/location/custom-trackers excluded, and an optional notes toggle.

## Deploy
- App in the public repo, `index.html` at root, `.nojekyll` present.
- `.github/workflows/pages.yml` deploys to GitHub Pages on every push to `main`.
- Served under a `/<repo>/` subpath → **all asset paths are relative**.

## Run locally
ES modules need HTTP (not `file://`):
```
python3 -m http.server 8000   # then open http://localhost:8000
```
Pure modules (`stats.js`, `util.js`, `ai-export.js` helpers) can be exercised under Node.

## Conventions
- Do **not** add AI/assistant as a git contributor, committer, author, or co-author.
- Keep all wording generic; never commit real entries, tokens, coordinates, or health detail.

## Possible next steps
- SRI hash for the pinned Chart.js; split custom-tracker chart into per-tracker mini-plots.
- Richer experiment analytics (multi-factor, effect sizes); CSV export.
- Reminders/notifications for nightly logging.

> See also `docs/LESSONS.md` for the bugs-and-requests retrospective (root causes + lessons).
