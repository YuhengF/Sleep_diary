# Lessons Log — Bugs & Requests

A desensitized retrospective of what broke, why, and what was asked for while building
this tool — so future iterations (and similar apps) avoid the same traps. No personal or
health data here; only engineering and product lessons.

## Top bugs & root causes (the high-value ones)

1. **Mobile "dead buttons / missing UI" = version skew.**
   New HTML loaded with **stale cached JavaScript**, so event handlers never attached.
   Cause: a "network-first" service worker whose `fetch()` still went through the browser
   HTTP cache. *Fix:* `fetch(url, { cache: 'no-store' })` in the SW so deploys are always
   fresh; offline falls back to cache. *Lesson:* decide the cache strategy **first**; verify
   the SW actually bypasses the HTTP cache.

2. **Telling users to "clear site data" wiped their token.**
   Clearing cache also clears `localStorage` (where the PAT lives). *Lesson:* never rely on
   users clearing data; solve freshness with the SW + cache-busting. Keep recoverable state
   (tokens) separate in the user's mind.

3. **CSS load-order bug.** Responsive overrides lived in `layout.css`, but `components.css`
   loaded **after** and re-declared the base rule at equal specificity, so the later rule
   won and the responsive override silently did nothing (form didn't go single-column on
   mobile; panels didn't sit side by side). *Lesson:* keep a rule's responsive overrides in
   the **same file, after** its base rule — or adopt CSS `@layer`/a single source of truth.

4. **One-shot data migration ran before data existed.** A scale migration was gated by a
   one-time `localStorage` flag; it fired on first load **before** records synced from the
   repo (and especially right after a cache clear), set the flag, and never touched the real
   data that arrived later. *Fix:* make migrations **idempotent** and **re-run after every
   sync**; mark each record with a version (`_v2`) so value-inverting migrations run exactly
   once per record. *Lesson:* migrations must be sync-aware and idempotent, not boot-once.

5. **Changing a scale's meaning without migrating values.** Reframing ratings to
   "higher = better" (and renaming fields) left old records numerically wrong. *Lesson:* a
   semantic change to stored data **is** a data migration; ship them together and make the
   irreversible part explicit/verifiable.

6. **Timezone confusion on timestamps.** Check-ins were stored as UTC ISO but **displayed by
   slicing the ISO string** (raw UTC), while charts used the **device's** local hour and
   edits were parsed as device-local — three inconsistent interpretations. *Fix:* store UTC,
   convert everywhere through a **configurable IANA timezone**; bucket by zoned date (handles
   midnight). *Lesson:* never slice ISO for display; pick one tz and convert at the edges.

7. **Chart didn't render (sleep timeline).** `indexAxis: 'y'` was set **after** chart
   creation; floating-bar datasets were also grouped. *Fix:* set structural options
   (`indexAxis`) in the config at creation; use `grouped: false` so disjoint segments tile a
   single row. *Lesson:* set structural chart options up front, not post-hoc.

8. **Native mobile inputs over-size.** `input[type=time|date]` don't shrink to their column
   by default. *Fix:* `min-width: 0; box-sizing: border-box`.

9. **Editing was confusing / data carried between days.** The Log form wasn't date-driven, so
   switching dates kept the prior entry's values and saved entries didn't reappear. *Fix:* a
   **date-driven** editor (calendar selects the day → loads that entry or a blank). Merging
   the separate "History" tab into the calendar removed the confusion.

10. **Fixed nav bars across mobile/desktop are fiddly.** Two distinct bugs from one shared bar:
    (a) **Mobile bottom bar** — Chrome's collapsing URL toolbar resizes the visual viewport, so
    a `bottom`-anchored active-tab indicator overlapped the label. *Fix:* anchor the indicator
    to the **top edge** of the tab. (b) **Desktop top bar** — a **transparent** fixed bar let
    page content scroll **visibly under it and stay clickable through** it. *Fix:* give the bar
    an **opaque background** so it occludes and captures clicks. *Lesson:* fixed bars need a
    solid/opaque background and viewport-resize-safe indicator placement.

11. **Popovers should overlay, not reflow.** A help panel that toggles in the document flow
    shoves the page around. *Fix:* anchor it `position: absolute` to its trigger (hover +
    `:focus-within`, plus a click toggle to pin for touch) so it overlays without moving content.

12. **Ambiguous one-letter tags collide.** A built-in tag abbreviated to a single letter clashed
    with a user's custom tracker of the same letter. *Fix:* use a distinct short word for the
    built-in and keep custom labels verbatim.

## Environment / ops gotchas (not app bugs)
- Sandbox **network is allowlisted** — couldn't fetch a CDN to compute an SRI hash; don't
  ship a guessed `integrity=` (a wrong hash blocks the script). The live browser is fine.
- **Pushes 403'd** until the GitHub App had write access; **commit signing** needs the
  expected committer email to show "Verified". Author was set to the human; assistant is
  never a committer/author/contributor.
- Deploy is a **GitHub Pages Actions workflow** on push to `main`; served under a subpath →
  **relative asset paths** are mandatory.

## Product requests, in themes
- **Logging breadth:** wake/alarm/final get-up, bedtime + last attempt, melatonin dose/time,
  morning sunlight, exercise, dinner (time+amount), bed snack, caffeine, bedroom temp, notes,
  WASO, **naps (start + duration, auto end)**, a **no-alarm** day toggle.
- **Ratings evolution:** 0–5 → 1–10 → **unified "higher = better"** (wake ease, morning
  alertness, alertness), one red→green ramp, a word per value, calendar dots colored by
  quality.
- **Check-ins:** quick alertness logs any time, **editable in place** (time/score), delete
  with sync-safe tombstones, newest-first, compact + scroll.
- **Day attribution:** entries keyed to the **wake-up morning**; evening factors = night
  before; a post-midnight bedtime counts as the wake day; explanation tucked behind a "?".
- **Clinical accuracy:** efficiency = TST/TIB; TST ends at **final get-up** (captures
  sleep-in) minus WASO; naps excluded from efficiency but added to a 24h total.
- **Insight & sharing:** doctor-style summary + collapsible comments; **Ask-AI export** — a
  paste-ready, **pseudonymized** prompt (+JSON), editable **patient-framed** persona, notes
  toggle, timezone stated.
- **UX/》polish:** Summary as the main page; single Log tab; time-of-day **light/dark theme**;
  rotating **motto bar**; wider desktop; compact cards; equal-height side-by-side cards.

## Principles for next time
- Offline-first + **SW network-first (no-store)**; never depend on users clearing cache.
- **Idempotent, sync-aware migrations**; version your records.
- **UTC in storage, configured tz at the edges.**
- Decide **data-day attribution** early — many features depend on it.
- CSS: one source of truth for responsive rules (file order or `@layer`).
- Set **structural chart options at creation**.
- Treat **semantic data changes as migrations**; make irreversible steps explicit.
- **Privacy by construction:** keep tokens/PII out of the repo; pseudonymize on export;
  de-identify (third-person) when sharing.
