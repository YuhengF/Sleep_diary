// ui.js — DOM building, form read/fill, rendering. Talks to no network directly.
import {
  MELATONIN_DOSES, MEAL_AMOUNTS, SNACK_AMOUNTS, SCALES, RATING_MIN, RATING_MAX,
  EXPERIMENT_FACTORS, EXPERIMENT_OUTCOMES,
} from './config.js';
import { computeNight } from './stats.js';
import { toMinutes, durationMinutes, fmtDuration, todayISO, uuid } from './util.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---- One-time builders -------------------------------------------------------

export function buildRatings() {
  for (const el of $$('.rating')) {
    const key = el.dataset.key;
    const meta = SCALES[key];
    if (!meta) continue;
    el.innerHTML = `
      <div class="rating-head">
        <span class="rating-label">${meta.label}</span>
        <span class="rating-value" data-out>0</span>
      </div>
      <input type="range" min="${RATING_MIN}" max="${RATING_MAX}" step="1" value="0" data-range />
      <div class="rating-ends"><small>${meta.low}</small><small>${meta.high}</small></div>`;
    const range = $('[data-range]', el);
    const out = $('[data-out]', el);
    range.addEventListener('input', () => { out.textContent = range.value; });
  }
}

function buildSegment(containerId, values, formatter = (v) => v) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  for (const v of values) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.value = String(v);
    btn.textContent = formatter(v);
    btn.addEventListener('click', () => {
      $$('.chip', el).forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      el.dataset.value = String(v);
    });
    el.appendChild(btn);
  }
}

export function buildSegmented() {
  buildSegment('seg-melatonin', MELATONIN_DOSES, (v) => (v === 0 ? 'none' : v));
  buildSegment('seg-dinner', MEAL_AMOUNTS);
  buildSegment('seg-snack', SNACK_AMOUNTS);
}

export function buildExperimentSelects() {
  const f = $('#f-exp-factor');
  f.innerHTML = EXPERIMENT_FACTORS.map((x) => `<option value="${x.path}">${x.label}</option>`).join('');
  const o = $('#f-exp-outcome');
  o.innerHTML = EXPERIMENT_OUTCOMES.map((x) => `<option value="${x.key}">${x.label}</option>`).join('');
}

function setSegment(containerId, value) {
  const el = document.getElementById(containerId);
  el.dataset.value = value == null ? '' : String(value);
  $$('.chip', el).forEach((c) => c.classList.toggle('active', c.dataset.value === String(value)));
}

function getSegment(containerId) {
  const el = document.getElementById(containerId);
  return el.dataset.value ?? '';
}

function setRating(key, val) {
  const el = $(`.rating[data-key="${key}"]`);
  if (!el) return;
  const range = $('[data-range]', el);
  range.value = val == null ? 0 : val;
  $('[data-out]', el).textContent = range.value;
}

function getRating(key, rootSel = '.rating') {
  const el = $(`${rootSel}[data-key="${key}"]`);
  if (!el) return null;
  return +$('[data-range]', el).value;
}

// ---- Log form ----------------------------------------------------------------

export function clearForm(settings) {
  fillForm(null, settings);
}

export function fillForm(entry, settings) {
  const d = settings.defaults || {};
  const e = entry || {};
  $('#f-date').value = e.date || todayISO();
  $('#f-alarm').value = e.alarmTime || d.alarmTime || '08:00';
  $('#f-wake').value = e.wakeTime || ($('#f-alarm').value);
  $('#f-outofbed').value = e.outOfBedTime || '';
  setRating('quality', e.quality ?? 0);
  setRating('wakeDifficulty', e.wakeDifficulty ?? 0);
  setRating('grogginess1h', e.grogginess1h ?? 0);
  $('#f-bedtime').value = e.bedtime || '';
  $('#f-onset').value = e.sleepOnset || '';

  const manual = e.tstSource === 'entered';
  $('#f-tst-override').checked = manual;
  $('#f-tst').readOnly = !manual;
  $('#f-tst').value = e.tstMinutes != null ? e.tstMinutes : '';
  updateTstHint();

  setSegment('seg-melatonin', e.melatonin?.doseMg ?? 0);
  $('#f-melatonin-time').value = e.melatonin?.time || '';
  $('#f-sunlight-time').value = e.sunlight?.time || '';
  $('#f-sunlight-min').value = e.sunlight?.minutes ?? '';
  $('#f-exercise-start').value = e.exercise?.startTime || '';
  $('#f-exercise-dur').value = e.exercise?.durationMin ?? '';
  $('#f-dinner-time').value = e.dinner?.time || '';
  setSegment('seg-dinner', e.dinner?.amount || '');
  setSegment('seg-snack', e.bedSnack?.amount || 'none');
  $('#f-caffeine-time').value = e.caffeine?.time || '';
  $('#f-temp').value = e.bedroomTempC ?? '';
  $('#tempHint').textContent = e.tempSource === 'open-meteo'
    ? 'Estimated outdoor temperature (proxy). Override if you have a thermostat reading.'
    : '';
  $('#f-notes').value = e.notes || '';
}

export function readForm() {
  const date = $('#f-date').value;
  if (!date) return null;
  const tstManual = $('#f-tst-override').checked;
  const dose = parseFloat(getSegment('seg-melatonin'));
  const num = (v) => (v === '' || v == null ? null : Number(v));

  return {
    date,
    alarmTime: $('#f-alarm').value || null,
    wakeTime: $('#f-wake').value || null,
    outOfBedTime: $('#f-outofbed').value || null,
    quality: getRating('quality'),
    wakeDifficulty: getRating('wakeDifficulty'),
    grogginess1h: getRating('grogginess1h'),
    bedtime: $('#f-bedtime').value || null,
    sleepOnset: $('#f-onset').value || null,
    tstMinutes: tstManual ? num($('#f-tst').value) : null,
    tstSource: tstManual ? 'entered' : 'computed',
    melatonin: { doseMg: isNaN(dose) ? 0 : dose, time: $('#f-melatonin-time').value || null },
    sunlight: { time: $('#f-sunlight-time').value || null, minutes: num($('#f-sunlight-min').value) },
    exercise: { startTime: $('#f-exercise-start').value || null, durationMin: num($('#f-exercise-dur').value) },
    dinner: { time: $('#f-dinner-time').value || null, amount: getSegment('seg-dinner') || null },
    bedSnack: { amount: getSegment('seg-snack') || 'none' },
    caffeine: { time: $('#f-caffeine-time').value || null },
    bedroomTempC: num($('#f-temp').value),
    tempSource: $('#f-temp').value ? ($('#tempHint').textContent ? 'open-meteo' : 'manual') : null,
    notes: $('#f-notes').value.trim(),
    updatedAt: new Date().toISOString(),
  };
}

// Live TST hint when not in manual mode.
export function updateTstHint() {
  const manual = $('#f-tst-override').checked;
  $('#f-tst').readOnly = !manual;
  if (manual) { $('#tstHint').textContent = '(manual, minutes)'; return; }
  const wake = $('#f-wake').value || $('#f-alarm').value;
  const start = $('#f-onset').value || $('#f-bedtime').value;
  const dur = durationMinutes(start, wake);
  $('#f-tst').value = dur != null ? dur : '';
  $('#tstHint').textContent = dur != null ? `(auto · ${fmtDuration(dur)})` : '(auto)';
}

// ---- Summary -----------------------------------------------------------------

function card(label, value, sub, tone = '') {
  return `<div class="card stat ${tone}"><div class="stat-value">${value}</div>
    <div class="stat-label">${label}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
}

function effTone(pct) {
  if (pct == null) return '';
  return pct >= 85 ? 'good' : pct >= 75 ? 'warn' : 'bad';
}

export function renderSummary(summary) {
  const host = $('#summaryCards');
  if (!summary || !summary.n) {
    host.innerHTML = '<div class="card empty">No entries yet. Log a few nights to see your stats.</div>';
    return;
  }
  const h = (m) => (m == null ? '—' : fmtDuration(m));
  host.innerHTML = [
    card('Avg sleep efficiency', summary.avgEfficiency != null ? `${summary.avgEfficiency}%` : '—',
      summary.pctInBand != null ? `${summary.pctInBand}% nights in target` : '', effTone(summary.avgEfficiency)),
    card('Avg total sleep', h(summary.avgTst), `target ${(summary.targetMin/60).toFixed(1)}–${(summary.targetMax/60).toFixed(1)}h`),
    card('Avg time to fall asleep', h(summary.avgSol), summary.avgSol != null && summary.avgSol > 30 ? 'elevated' : ''),
    card('Avg quality', summary.avgQuality != null ? `${summary.avgQuality}/5` : '—', ''),
    card('Avg grogginess', summary.avgGrogginess != null ? `${summary.avgGrogginess}/5` : '—', ''),
    card('Wake-time regularity', summary.wakeRegularity != null ? `±${summary.wakeRegularity}m` : '—',
      summary.wakeRegularity != null && summary.wakeRegularity > 60 ? 'variable' : 'steady'),
    card('Bedtime regularity', summary.bedtimeRegularity != null ? `±${summary.bedtimeRegularity}m` : '—',
      summary.bedtimeRegularity != null && summary.bedtimeRegularity > 60 ? 'variable' : 'steady'),
    card('Nights logged', String(summary.n), ''),
  ].join('');
}

export function renderComments(lines) {
  $('#summaryComments').innerHTML =
    '<h4>What the diary suggests</h4><ul>' + lines.map((l) => `<li>${l}</li>`).join('') + '</ul>';
}

export function renderExpBanner(settings, corr) {
  const el = $('#expBanner');
  const exp = settings.experiment;
  if (!exp || !exp.active) { el.hidden = true; return; }
  el.hidden = false;
  let dayInfo = '';
  if (exp.startDate) {
    const day = Math.floor((Date.parse(todayISO()) - Date.parse(exp.startDate)) / 86400000) + 1;
    dayInfo = ` — day ${Math.max(1, day)} of ${exp.days}`;
  }
  const rInfo = corr && corr.r != null ? ` · r=${corr.r} (n=${corr.n})` : '';
  el.innerHTML = `<span class="exp-dot"></span> Studying: <strong>${exp.factorLabel}</strong>${dayInfo}${rInfo}`;
}

// ---- History -----------------------------------------------------------------

export function renderEntryList(entries, settings, onEdit) {
  const host = $('#entryList');
  if (!entries.length) {
    host.innerHTML = '<div class="card empty">No entries this month.</div>';
    return;
  }
  host.innerHTML = '';
  for (const e of [...entries].reverse()) {
    const m = computeNight(e, settings);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'entry-row card';
    row.innerHTML = `
      <div class="entry-date">${e.date}</div>
      <div class="entry-meta">
        <span>TST ${m.tstMin != null ? fmtDuration(m.tstMin) : '—'}</span>
        <span>Eff ${m.efficiencyPct != null ? m.efficiencyPct + '%' : '—'}</span>
        <span>Q ${e.quality ?? '—'}/5</span>
      </div>`;
    row.addEventListener('click', () => onEdit(e.date));
    host.appendChild(row);
  }
}

// ---- Settings ----------------------------------------------------------------

export function fillSettings(settings, hasToken) {
  $('#f-token').value = '';
  $('#f-token').placeholder = hasToken ? '•••••• (saved)' : 'github_pat_…';
  $('#f-default-alarm').value = settings.defaults.alarmTime || '08:00';
  $('#f-target-min').value = (settings.defaults.targetTstMin / 60).toFixed(1);
  $('#f-target-max').value = (settings.defaults.targetTstMax / 60).toFixed(1);
  $('#f-loc-mode').value = settings.location.mode || 'geo';
  $('#f-manual-temp').value = settings.location.manualTempC ?? '';
  $('#f-exp-active').checked = !!settings.experiment.active;
  $('#f-exp-factor').value = settings.experiment.factor;
  $('#f-exp-outcome').value = settings.experiment.outcome || 'quality';
  $('#f-exp-days').value = settings.experiment.days || 7;
  $('#f-exp-start').value = settings.experiment.startDate || '';
}

export function readSettings(prev) {
  const factorPath = $('#f-exp-factor').value;
  const factorLabel = EXPERIMENT_FACTORS.find((f) => f.path === factorPath)?.label || factorPath;
  const tMin = parseFloat($('#f-target-min').value);
  const tMax = parseFloat($('#f-target-max').value);
  return {
    ...prev,
    defaults: {
      alarmTime: $('#f-default-alarm').value || '08:00',
      targetTstMin: Math.round((isNaN(tMin) ? 8.5 : tMin) * 60),
      targetTstMax: Math.round((isNaN(tMax) ? 9 : tMax) * 60),
    },
    location: {
      ...prev.location,
      mode: $('#f-loc-mode').value,
      manualTempC: $('#f-manual-temp').value === '' ? null : Number($('#f-manual-temp').value),
    },
    experiment: {
      active: $('#f-exp-active').checked,
      factor: factorPath,
      factorLabel,
      outcome: $('#f-exp-outcome').value,
      days: Number($('#f-exp-days').value) || 7,
      startDate: $('#f-exp-start').value || null,
    },
  };
}

// ---- Sleepiness modal --------------------------------------------------------

export function openSleepModal() {
  setRating('sleepiness', 0);
  $('#sleep-note').value = '';
  $('#sleepModal').hidden = false;
}
export function closeSleepModal() { $('#sleepModal').hidden = true; }

export function readSleepiness() {
  return {
    id: uuid(),
    datetime: new Date().toISOString(),
    level: getRating('sleepiness'),
    note: $('#sleep-note').value.trim() || null,
    updatedAt: new Date().toISOString(),
  };
}

// ---- Chrome: tabs, toasts, sync status ---------------------------------------

export function setupTabs() {
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const go = btn.dataset.go;
      $$('.tab-panel').forEach((p) => { p.hidden = p.dataset.tab !== go; });
      window.dispatchEvent(new CustomEvent('tabchange', { detail: go }));
    });
  });
}

export function toast(msg, type = 'info') {
  const host = $('#toastHost');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

export function setSyncStatus(state, text) {
  const dot = $('#syncDot');
  $('#syncText').textContent = text;
  dot.className = `dot ${state}`; // synced | syncing | offline | local | error
}
