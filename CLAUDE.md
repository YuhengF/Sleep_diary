# Developer Notes — Sleep Diary

A static, zero-build single-page web app (vanilla HTML/CSS/JS + Chart.js via CDN)
hosted on GitHub Pages. It is a generic sleep-tracking tool.

## Privacy rule (important)
- Keep ALL personal information and any specific health conditions OUT of the app UI
  and out of the committed code. Keep wording generic ("sleep tracking").
- Real user data lives ONLY in the separate **private** repo `sleep_diary_data_YF`
  (owner: YuhengF). Never commit any real entries, tokens, coordinates, or health
  details to this public repo.
- The Personal Access Token lives only in the browser's localStorage (`sd.token`).
  Never log it, never write it to any repo file.

## Architecture
- Data model + sync: monthly files `entries/YYYY-MM.json` in the data repo, plus
  `settings.json`. Multi-device convergence via per-date last-writer-wins merge.
- localStorage is an offline cache + offline write queue (`sd.dirty`).
- All rating scales are 1–10.
- Entries are keyed by the **wake-up morning date** (you log after waking). The Log form
  shows a notice clarifying which night → morning each record covers.
- The UI theme re-tints by time of day via `data-daypart` on `<html>` (see tokens.css).

## Conventions
- Do NOT add Claude / AI as a git contributor, committer, author, or co-author.
- Asset paths must be relative (app served under the `/Sleep_diary/` subpath).
