// charts.js — Chart.js (UMD global `Chart`) rendering. Registry avoids "canvas in use".
import { computeNight } from './stats.js';
import { toMinutes, toHHMM, fmtDuration, zonedHourFloat, zonedDateStr } from './util.js';

const registry = new Map();

// Chart palette — refreshed from the active theme (CSS vars) before each render so
// charts stay legible on both the light (day/morning) and dark (evening/night) themes.
let AXIS = '#8b95a7';
let GRID = 'rgba(128,128,128,0.18)';
let ACCENT = '#5eead4';
let ACCENT2 = '#818cf8';
let BAND = 'rgba(94,234,212,0.15)';

function hexToRgba(hex, a) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || '').trim());
  if (!m) return `rgba(94,234,212,${a})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

function refreshTheme() {
  const cs = getComputedStyle(document.documentElement);
  const g = (n, fb) => cs.getPropertyValue(n).trim() || fb;
  AXIS = g('--text-dim', AXIS);
  ACCENT = g('--accent', ACCENT);
  ACCENT2 = g('--accent-2', ACCENT2);
  GRID = 'rgba(128,128,128,0.18)'; // neutral, works on light and dark
  BAND = hexToRgba(ACCENT, 0.15);
}

function destroyIfExists(id) {
  const prev = registry.get(id);
  if (prev) { prev.destroy(); registry.delete(id); }
}

// True when the Chart.js global is available; otherwise draws a fallback note.
function chartReady(canvas) {
  refreshTheme();
  if (typeof Chart !== 'undefined') return true;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = AXIS;
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Charts need an internet connection', canvas.width / 2, canvas.height / 2);
  return false;
}

function baseOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false, // avoid replaying on the post-sync re-render (and snappier loads)
    indexAxis: extra.indexAxis,
    plugins: {
      legend: { labels: { color: AXIS, font: { size: 11 } } },
      tooltip: { intersect: false, mode: 'index' },
      ...(extra.plugins || {}),
    },
    scales: extra.scales || {},
  };
}

function noData(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = AXIS;
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Not enough data yet', canvas.width / 2, canvas.height / 2);
}

// Per-night timeline: one horizontal row per night, tiled from bedtime → onset
// (falling asleep) → final wake (asleep), plus the nap window (start → start+dur,
// auto-computed). X axis is "minutes after 18:00" so evenings and past-midnight
// read left→right; the daytime nap sits toward the right.
export function renderTimeline(canvas, entries, settings) {
  if (!chartReady(canvas)) return;
  destroyIfExists(canvas.id);
  const ANCHOR = 18 * 60; // 18:00
  const norm = (hhmm) => {
    const m = toMinutes(hhmm);
    if (m == null) return null;
    let x = m - ANCHOR;
    if (x < 0) x += 1440;
    return x;
  };
  const usable = entries.filter((e) => e.bedtime && (e.outOfBedTime || e.wakeTime || e.alarmTime));
  if (!usable.length) return noData(canvas);

  const labels = [];
  const latency = [];
  const asleep = [];
  const nap = [];
  for (const e of usable) {
    const bed = norm(e.bedtime);
    let onset = norm(e.sleepOnset);
    if (onset == null) onset = bed;
    let wake = norm(e.outOfBedTime || e.wakeTime || e.alarmTime);
    let onsetAbs = onset < bed ? onset + 1440 : onset;
    let wakeAbs = wake < bed ? wake + 1440 : wake;
    if (wakeAbs < onsetAbs) wakeAbs += 1440;
    labels.push(e.date.slice(5));
    latency.push([bed, onsetAbs]);
    asleep.push([onsetAbs, wakeAbs]);
    if (e.napTime && e.napMinutes) {
      let ns = norm(e.napTime);
      if (ns != null && ns < bed) ns += 1440;
      nap.push(ns == null ? null : [ns, ns + e.napMinutes]);
    } else {
      nap.push(null);
    }
  }

  registry.set(canvas.id, new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Falling asleep', data: latency, backgroundColor: 'rgba(129,140,248,0.6)', grouped: false, borderWidth: 0, barPercentage: 0.8, categoryPercentage: 0.9 },
        { label: 'Asleep', data: asleep, backgroundColor: ACCENT, grouped: false, borderWidth: 0, barPercentage: 0.8, categoryPercentage: 0.9 },
        { label: 'Nap', data: nap, backgroundColor: 'rgba(251,191,36,0.8)', grouped: false, borderWidth: 0, barPercentage: 0.8, categoryPercentage: 0.9 },
      ],
    },
    options: baseOptions({
      indexAxis: 'y',
      plugins: {
        tooltip: {
          callbacks: {
            label: (c) => {
              if (!c.raw) return '';
              const [a, b] = c.raw;
              return `${c.dataset.label}: ${toHHMM(a + ANCHOR)}–${toHHMM(b + ANCHOR)} (${fmtDuration(b - a)})`;
            },
          },
        },
      },
      scales: {
        x: {
          min: 0, max: 1440,
          ticks: { color: AXIS, stepSize: 120, callback: (v) => toHHMM(v + ANCHOR) },
          grid: { color: GRID },
        },
        y: { ticks: { color: AXIS }, grid: { color: GRID } },
      },
    }),
  }));
}

// TST trend with a shaded target band. Optionally adds a "night + naps (24h)" line.
export function renderTstTrend(canvas, entries, settings) {
  if (!chartReady(canvas)) return;
  destroyIfExists(canvas.id);
  if (!entries.length) return noData(canvas);
  const labels = entries.map((e) => e.date.slice(5));
  const hrs = (m) => (m == null ? null : Math.round((m / 60) * 10) / 10);
  const tst = entries.map((e) => hrs(computeNight(e, settings).tstMin));
  const incl = entries.map((e) => hrs(computeNight(e, settings).total24hMin));
  const tMin = (settings?.defaults?.targetTstMin ?? 510) / 60;
  const tMax = (settings?.defaults?.targetTstMax ?? 540) / 60;

  const hasNap = entries.some((e) => (e.napMinutes || 0) > 0);
  const showIncl = settings?.napsInTotal !== false && hasNap;

  const datasets = [
    { label: 'Target max', data: labels.map(() => tMax), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: BAND },
    { label: 'Target min', data: labels.map(() => tMin), borderWidth: 0, pointRadius: 0, fill: false },
    { label: 'Night sleep', data: tst, borderColor: ACCENT, backgroundColor: ACCENT, tension: 0.3, spanGaps: true, pointRadius: 3 },
  ];
  if (showIncl) {
    datasets.push({ label: 'Night + naps (24h)', data: incl, borderColor: ACCENT2, backgroundColor: ACCENT2, borderDash: [5, 4], tension: 0.3, spanGaps: true, pointRadius: 3 });
  }

  registry.set(canvas.id, new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: baseOptions({
      plugins: { legend: { labels: { color: AXIS, filter: (i) => !i.text.startsWith('Target') } } },
      scales: {
        x: { ticks: { color: AXIS }, grid: { color: GRID } },
        y: { ticks: { color: AXIS }, grid: { color: GRID }, title: { display: true, text: 'hours', color: AXIS } },
      },
    }),
  }));
}

// Quality / morning-alertness trend (1–10 axis; both higher = better).
export function renderQualityTrend(canvas, entries) {
  if (!chartReady(canvas)) return;
  destroyIfExists(canvas.id);
  if (!entries.length) return noData(canvas);
  const labels = entries.map((e) => e.date.slice(5));
  registry.set(canvas.id, new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Quality', data: entries.map((e) => e.quality ?? null), borderColor: ACCENT, backgroundColor: ACCENT, tension: 0.3, spanGaps: true },
        { label: 'Morning alertness', data: entries.map((e) => e.morningAlertness ?? null), borderColor: ACCENT2, backgroundColor: ACCENT2, tension: 0.3, spanGaps: true },
      ],
    },
    options: baseOptions({
      scales: {
        x: { ticks: { color: AXIS }, grid: { color: GRID } },
        y: { min: 1, max: 10, ticks: { color: AXIS, stepSize: 1 }, grid: { color: GRID } },
      },
    }),
  }));
}

// Factor-vs-outcome scatter; title carries r.
export function renderFactorScatter(canvas, corr, factorLabel, outcomeLabel) {
  if (!chartReady(canvas)) return;
  destroyIfExists(canvas.id);
  if (!corr || corr.n < 3) return noData(canvas);
  registry.set(canvas.id, new Chart(canvas, {
    type: 'scatter',
    data: {
      datasets: [{
        label: `${factorLabel} vs ${outcomeLabel}` + (corr.r != null ? ` (r=${corr.r})` : ''),
        data: corr.points,
        backgroundColor: ACCENT,
        pointRadius: 5,
      }],
    },
    options: baseOptions({
      plugins: {
        tooltip: { callbacks: { label: (c) => `${c.raw.date}: (${c.raw.x}, ${c.raw.y})` } },
      },
      scales: {
        x: { title: { display: true, text: factorLabel, color: AXIS }, ticks: { color: AXIS }, grid: { color: GRID } },
        y: { title: { display: true, text: outcomeLabel, color: AXIS }, ticks: { color: AXIS }, grid: { color: GRID } },
      },
    }),
  }));
}

// Free alertness check-ins by hour-of-day.
export function renderSleepinessByHour(canvas, logs, tz) {
  if (!chartReady(canvas)) return;
  destroyIfExists(canvas.id);
  if (!logs.length) return noData(canvas);
  const points = logs.map((l) => ({
    x: zonedHourFloat(l.datetime, tz), y: l.level, note: l.note, date: zonedDateStr(l.datetime, tz),
  }));
  registry.set(canvas.id, new Chart(canvas, {
    type: 'scatter',
    data: { datasets: [{ label: 'Alertness', data: points, backgroundColor: ACCENT2, pointRadius: 5 }] },
    options: baseOptions({
      plugins: {
        tooltip: { callbacks: { label: (c) => `${c.raw.date} ${String(Math.floor(c.raw.x)).padStart(2, '0')}:00 — level ${c.raw.y}${c.raw.note ? ` (${c.raw.note})` : ''}` } },
      },
      scales: {
        x: { min: 0, max: 24, ticks: { color: AXIS, stepSize: 3, callback: (v) => `${v}:00` }, grid: { color: GRID }, title: { display: true, text: 'hour of day', color: AXIS } },
        y: { min: 1, max: 10, ticks: { color: AXIS, stepSize: 1 }, grid: { color: GRID } },
      },
    }),
  }));
}
