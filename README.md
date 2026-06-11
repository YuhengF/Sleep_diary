# Sleep Diary

A clean, mobile- and desktop-friendly sleep diary web app you can run on GitHub Pages.
It helps you log the factors that affect your sleep and shows doctor-style summary stats
and charts so you can pinpoint patterns — ideally tracking **one factor at a time** over
several days.

## Features
- **Fast logging** of wake/alarm/out-of-bed times, bedtime and last attempt to sleep,
  melatonin dose & timing, morning sunlight, exercise, dinner (time + amount), before-bed
  snack, caffeine, bedroom temperature, notes, and three 1–10 ratings: sleep quality,
  wake difficulty, and morning grogginess (~1h after waking).
- **Quick sleepiness log** — a floating button to record how sleepy you feel (1–10) at any
  time of day.
- **Time-of-day theme** — the UI subtly re-tints for morning, day, evening, and night.
- **Clear diary-date notice** — every entry shows which night → morning it covers, since
  you usually log after waking (already the next calendar day).
- **Auto bedroom temperature** via the free [Open-Meteo](https://open-meteo.com) API
  (no API key) using your location, with manual override.
- **Doctor-style stats**: sleep efficiency, sleep onset latency, total sleep time vs a
  target band, bedtime/wake regularity, trends, and a factor-vs-outcome correlation for
  your current experiment — plus plain-language comments.
- **Experiment mode** to study one factor (e.g. melatonin dose) against an outcome
  (e.g. quality) over N days.
- **Sync across devices** to your own **private** data repo, with an offline cache so it
  keeps working without a connection.

## How data is stored
The app is a static site (no backend). Your entries live in a **separate private GitHub
repo** (not this one). The app talks to GitHub's Contents API from your browser using a
token you provide; entries are saved as monthly JSON files (`entries/YYYY-MM.json`) plus a
`settings.json`. A local cache (browser `localStorage`) keeps things fast and works offline,
syncing when you reconnect. Multiple devices using the same token converge on one dataset
(per-day last-writer-wins).

## Setup
1. **Create a private data repo** (e.g. `sleep_diary_data_YF`) under your GitHub account.
2. **Create a fine-grained Personal Access Token** scoped to *only* that repo, with
   **Contents: Read and write**.
3. Open the app, go to **Settings**, paste the token, and click **Test connection** then
   **Save token**.
4. Start logging. Your data syncs to the private repo automatically.

## Deploy on GitHub Pages
1. Push this repo to GitHub with `index.html` at the root.
2. Repo → **Settings → Pages → Deploy from a branch** → `main` / `/ (root)`.
3. Visit `https://<user>.github.io/<repo>/`.

## Run locally
ES modules need to be served over HTTP (not `file://`):
```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Privacy
This public repo contains only app code — no personal data. All real entries stay in your
private data repo. The token lives only in your browser's local storage and is never
committed anywhere.
