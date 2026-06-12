// ui.js — DOM building, form read/fill, rendering. Talks to no network directly.
import {
  MELATONIN_DOSES, MEAL_AMOUNTS, SNACK_AMOUNTS, SCALES, RATING_WORDS,
  RATING_MIN, RATING_MAX, RATING_DEFAULT, EXPERIMENT_FACTORS, EXPERIMENT_OUTCOMES,
} from './config.js';
import { toMinutes, toHHMM, durationMinutes, fmtDuration, todayISO, uuid, addDays, formatNice, zonedTimeStr } from './util.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Red→amber→green color for a 1..10 value (all scales: higher = better).
export function ratingColor(v) {
  if (v == null || isNaN(v)) return 'var(--accent)';
  const t = Math.max(0, Math.min(1, (v - 1) / 9));
  return `hsl(${Math.round(t * 125)}, 68%, 48%)`; // 0=red … 125=green
}

function ratingLabelText(v) {
  return `${RATING_WORDS[v] || ''} ${v}`.trim();
}

// ---- One-time builders -------------------------------------------------------

export function buildRatings() {
  for (const el of $$('.rating')) {
    const key = el.dataset.key;
    const meta = SCALES[key];
    if (!meta) continue;
    el.innerHTML = `
      <div class="rating-head">
        <span class="rating-label">${meta.label}</span>
        <span class="rating-value" data-out>${ratingLabelText(RATING_DEFAULT)}</span>
      </div>
      <input type="range" min="${RATING_MIN}" max="${RATING_MAX}" step="1" value="${RATING_DEFAULT}" data-range />
      <div class="rating-ends"><small>${meta.low}</small><small>${meta.high}</small></div>`;
    const range = $('[data-range]', el);
    const out = $('[data-out]', el);
    const paint = () => {
      const v = +range.value;
      out.textContent = ratingLabelText(v);
      el.style.setProperty('--rate-color', ratingColor(v));
    };
    range.addEventListener('input', paint);
    paint();
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
  const v = val == null ? RATING_DEFAULT : val;
  range.value = v;
  $('[data-out]', el).textContent = ratingLabelText(+range.value);
  el.style.setProperty('--rate-color', ratingColor(+range.value));
}

function getRating(key, rootSel = '.rating') {
  const el = $(`${rootSel}[data-key="${key}"]`);
  if (!el) return null;
  return +$('[data-range]', el).value;
}

// ---- Log form ----------------------------------------------------------------

export function fillForm(entry, settings) {
  const d = settings.defaults || {};
  const e = entry || {};
  $('#f-date').value = e.date || todayISO();
  updateDateNotice();
  // alarmTime === null means the user explicitly turned the alarm off for that day.
  const noAlarm = !!entry && e.alarmTime === null;
  $('#f-no-alarm').checked = noAlarm;
  $('#f-alarm').disabled = noAlarm;
  $('#f-alarm').value = noAlarm ? '' : (e.alarmTime || d.alarmTime || '08:00');
  $('#f-wake').value = e.wakeTime || (noAlarm ? '' : $('#f-alarm').value);
  $('#f-outofbed').value = e.outOfBedTime || '';
  setRating('quality', e.quality ?? RATING_DEFAULT);
  setRating('wakeEase', e.wakeEase ?? RATING_DEFAULT);
  setRating('morningAlertness', e.morningAlertness ?? RATING_DEFAULT);
  $('#f-nap-time').value = e.napTime || '';
  $('#f-nap-min').value = e.napMinutes ?? '';
  updateNapEnd();
  $('#f-waso').value = e.waso ?? '';
  $('#f-bedtime').value = e.bedtime || '';
  $('#f-onset').value = e.sleepOnset || '';
  updateNightTimes();

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

  const noAlarm = $('#f-no-alarm').checked;
  return {
    date,
    alarmTime: noAlarm ? null : ($('#f-alarm').value || null),
    wakeTime: $('#f-wake').value || null,
    outOfBedTime: $('#f-outofbed').value || null,
    quality: getRating('quality'),
    wakeEase: getRating('wakeEase'),
    morningAlertness: getRating('morningAlertness'),
    bedtime: $('#f-bedtime').value || null,
    sleepOnset: $('#f-onset').value || null,
    waso: num($('#f-waso').value),
    napTime: $('#f-nap-time').value || null,
    napMinutes: num($('#f-nap-min').value),
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
  // End at the final wake-up (out-of-bed if given) so sleeping in is counted; subtract WASO.
  const finalWake = $('#f-outofbed').value || $('#f-wake').value || $('#f-alarm').value;
  const start = $('#f-onset').value || $('#f-bedtime').value;
  const waso = Number($('#f-waso').value) || 0;
  let dur = durationMinutes(start, finalWake);
  if (dur != null) dur = Math.max(0, dur - waso);
  $('#f-tst').value = dur != null ? dur : '';
  $('#tstHint').textContent = dur != null ? `(auto · ${fmtDuration(dur)})` : '(auto)';
}

// Live "nap ends at" from start + duration.
export function updateNapEnd() {
  const el = $('#napEnd');
  if (!el) return;
  const start = toMinutes($('#f-nap-time').value);
  const dur = Number($('#f-nap-min').value) || 0;
  el.textContent = (start != null && dur > 0) ? toHHMM(start + dur) : '—';
}

// Toggle the alarm field on/off (some days have no alarm).
export function onAlarmToggle() {
  const off = $('#f-no-alarm').checked;
  $('#f-alarm').disabled = off;
  if (off) $('#f-alarm').value = '';
  updateTstHint();
}

// Label the two dated form sections so each shows which calendar day it covers.
export function updateDateNotice() {
  const date = $('#f-date').value;
  if (!date) return;
  const prev = addDays(date, -1);
  const secM = $('#sec-morning'), secN = $('#sec-night');
  if (secM) secM.innerHTML = `☀️ This morning · <span class="sec-date">${formatNice(date)}</span>`;
  if (secN) secN.innerHTML = `🌙 Last evening &amp; night · <span class="sec-date">${formatNice(prev)} → ${formatNice(date)}</span>`;
  updateNightTimes();
}

// Editing vs new is visible from the calendar; here we just adjust the Save label.
export function setMode(mode, date) {
  const saveBtn = $('#btn-save');
  if (saveBtn) saveBtn.textContent = mode === 'edit' ? 'Update entry' : 'Save entry';
}

// Show which calendar day bedtime / last-attempt actually fall on. A time at/after
// noon is the previous evening; before noon is the early hours of the wake-up day —
// so a 2:00 bedtime correctly reads as "this morning", not yesterday.
export function updateNightTimes() {
  const date = $('#f-date').value;
  const resolve = (hhmm) => {
    const min = toMinutes(hhmm);
    if (date === '' || min == null) return '';
    return formatNice(min >= 720 ? addDays(date, -1) : date);
  };
  const b = $('#bedtimeDay'), o = $('#onsetDay');
  if (b) b.textContent = resolve($('#f-bedtime').value);
  if (o) o.textContent = resolve($('#f-onset').value);
}

// Month calendar that dots days with entries (dot colored by that night's quality);
// tap a day to load it. Navigation + selection are driven by `handlers`.
// `entries` is a date→entry map for the displayed month.
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
export function renderCalendar(container, monthKey, selectedDate, entries, handlers) {
  if (!container) return;
  const [y, m] = monthKey.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = todayISO();
  const title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  let cells = '';
  for (let i = 0; i < startDow; i++) cells += '<span class="cal-cell empty"></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${monthKey}-${String(d).padStart(2, '0')}`;
    const entry = entries[iso];
    const cls = ['cal-cell', 'cal-day'];
    if (entry) cls.push('has-entry');
    if (iso === selectedDate) cls.push('selected');
    if (iso === today) cls.push('today');
    const dotStyle = entry ? ` style="background:${ratingColor(entry.quality)}"` : '';
    cells += `<button type="button" class="${cls.join(' ')}" data-date="${iso}">${d}<span class="cal-dot"${dotStyle}></span></button>`;
  }

  container.innerHTML =
    `<div class="cal-head">
       <button type="button" class="btn ghost icon" data-cal="prev" aria-label="Previous month">‹</button>
       <div class="cal-title">${title}</div>
       <button type="button" class="btn ghost icon" data-cal="next" aria-label="Next month">›</button>
       <button type="button" class="btn ghost small" data-cal="today">Today</button>
     </div>
     <div class="cal-dows">${DOW.map((d) => `<span class="cal-dow">${d}</span>`).join('')}</div>
     <div class="cal-grid">${cells}</div>
     <div class="cal-legend">dot = logged night, colored by quality (red→green)</div>`;

  container.onclick = (e) => {
    const day = e.target.closest('[data-date]');
    if (day) { handlers.onPick(day.dataset.date); return; }
    const nav = e.target.closest('[data-cal]');
    if (!nav) return;
    if (nav.dataset.cal === 'prev') handlers.onPrev();
    else if (nav.dataset.cal === 'next') handlers.onNext();
    else if (nav.dataset.cal === 'today') handlers.onToday();
  };
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
    card('Avg quality', summary.avgQuality != null ? `${summary.avgQuality}/10` : '—', ''),
    card('Avg wake ease', summary.avgWakeEase != null ? `${summary.avgWakeEase}/10` : '—', ''),
    card('Avg morning alertness', summary.avgMorningAlertness != null ? `${summary.avgMorningAlertness}/10` : '—', ''),
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

// ---- Alertness check-ins (editable in place) ---------------------------------

// Render the selected day's check-ins: each row has an editable time + score and a
// delete button. `handlers` = { onEdit(id, {time?, level?}), onDelete(id), onAdd() }.
export function renderCheckins(dateStr, logs, tz, handlers) {
  const host = $('#checkinList');
  if (!host) return;
  const title = $('#checkinTitle');
  if (title) title.textContent = `Check-ins · ${formatNice(dateStr)}`;

  if (!logs.length) {
    host.innerHTML = '<div class="checkin-empty">No check-ins this day.</div>';
  } else {
    host.innerHTML = logs.map((l) => {
      const time = zonedTimeStr(l.datetime, tz);
      const type = l.type || 'alertness';
      const tag = type === 'alertness' ? 'alert' : type;
      return `<div class="checkin-row" data-id="${l.id}" style="--rate-color:${ratingColor(l.level)}">
        <span class="checkin-type" title="${type}">${tag}</span>
        <input type="time" class="checkin-time" value="${time}" data-edit="time" aria-label="Check-in time" />
        <input type="range" class="checkin-score" min="${RATING_MIN}" max="${RATING_MAX}" step="1" value="${l.level}" data-edit="level" aria-label="Score" />
        <span class="checkin-val">${ratingLabelText(l.level)}</span>
        <button type="button" class="checkin-del" data-del aria-label="Delete check-in">✕</button>
      </div>`;
    }).join('');
  }

  host.oninput = (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.dataset.edit === 'level') {
      const v = +e.target.value;
      row.style.setProperty('--rate-color', ratingColor(v));
      const val = row.querySelector('.checkin-val');
      if (val) val.textContent = ratingLabelText(v);
      handlers.onEdit(id, { level: v });
    } else if (e.target.dataset.edit === 'time') {
      if (e.target.value) handlers.onEdit(id, { time: e.target.value });
    }
  };
  host.onclick = (e) => {
    const del = e.target.closest('[data-del]');
    if (del) handlers.onDelete(del.closest('[data-id]').dataset.id);
  };

  const addBtn = $('#checkinAdd');
  if (addBtn) addBtn.onclick = () => handlers.onAdd();
}

// ---- Settings ----------------------------------------------------------------

export function fillSettings(settings, hasToken) {
  $('#f-token').value = '';
  $('#f-token').placeholder = hasToken ? '•••••• (saved)' : 'github_pat_…';
  $('#f-default-alarm').value = settings.defaults.alarmTime || '08:00';
  $('#f-target-min').value = (settings.defaults.targetTstMin / 60).toFixed(1);
  $('#f-target-max').value = (settings.defaults.targetTstMax / 60).toFixed(1);
  $('#f-naps-in-total').checked = settings.napsInTotal !== false;
  $('#f-trackers').value = (settings.trackers || []).join('\n');
  const charts = settings.charts || {};
  $$('[data-chart]').forEach((cb) => { cb.checked = charts[cb.dataset.chart] !== false; });
  $('#f-loc-mode').value = settings.location.mode || 'geo';
  $('#f-manual-temp').value = settings.location.manualTempC ?? '';
  $('#f-timezone').value = settings.timezone || 'America/Los_Angeles';
  $('#f-ai-prompt').value = settings.aiPrompt || '';
  $('#f-include-notes').checked = settings.includeNotes !== false;
  $('#f-mottos').value = (settings.mottos || []).join('\n');
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
    timezone: $('#f-timezone').value || 'America/Los_Angeles',
    napsInTotal: $('#f-naps-in-total').checked,
    trackers: $('#f-trackers').value.split('\n').map((s) => s.trim()).filter(Boolean),
    charts: Object.fromEntries($$('[data-chart]').map((cb) => [cb.dataset.chart, cb.checked])),
    aiPrompt: $('#f-ai-prompt').value.trim() || undefined,
    includeNotes: $('#f-include-notes').checked,
    mottos: $('#f-mottos').value.split('\n').map((s) => s.trim()).filter(Boolean),
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

// ---- Quick check-in modal (one slider per tracker, logged together) ----------

// Build a slider row per tracker (Alertness + customs). Each has an enable
// checkbox so you can log just the ones you want in one go.
export function buildCheckinForm(settings) {
  const host = $('#checkinForm');
  if (!host) return;
  const keys = ['alertness', ...((settings.trackers || []).filter(Boolean))];
  host.innerHTML = keys.map((key) => {
    const label = key === 'alertness' ? SCALES.alertness.label : key;
    return `<div class="ci-row" data-tracker="${key}" style="--rate-color:${ratingColor(RATING_DEFAULT)}">
      <label class="ci-head">
        <input type="checkbox" class="ci-enable" checked />
        <span class="ci-name">${label}</span>
        <span class="ci-val" data-out>${ratingLabelText(RATING_DEFAULT)}</span>
      </label>
      <input type="range" min="${RATING_MIN}" max="${RATING_MAX}" step="1" value="${RATING_DEFAULT}" data-range />
    </div>`;
  }).join('');
  host.querySelectorAll('.ci-row').forEach((row) => {
    const range = row.querySelector('[data-range]');
    const out = row.querySelector('[data-out]');
    const paint = () => { const v = +range.value; out.textContent = ratingLabelText(v); row.style.setProperty('--rate-color', ratingColor(v)); };
    range.addEventListener('input', paint);
    paint();
  });
}

export function openSleepModal(settings) {
  buildCheckinForm(settings);
  $('#sleep-note').value = '';
  $('#sleepModal').hidden = false;
}
export function closeSleepModal() { $('#sleepModal').hidden = true; }

// Return one check-in per enabled tracker, all sharing the same timestamp + note.
export function readCheckins() {
  const now = new Date().toISOString();
  const note = $('#sleep-note').value.trim() || null;
  const logs = [];
  $$('#checkinForm .ci-row').forEach((row) => {
    if (!row.querySelector('.ci-enable').checked) return;
    logs.push({
      id: uuid(), datetime: now, type: row.dataset.tracker,
      level: +row.querySelector('[data-range]').value, note, _v2: true, updatedAt: now,
    });
  });
  return logs;
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

// Rotating motto banner at the very top. Restartable when settings change.
let mottoTimer = null;
export function startMottos(mottos) {
  const bar = $('#mottoBar');
  if (!bar) return;
  if (mottoTimer) { clearInterval(mottoTimer); mottoTimer = null; }
  const list = (mottos || []).filter(Boolean);
  if (!list.length) { bar.hidden = true; bar.textContent = ''; return; }
  bar.hidden = false;
  let i = Math.floor(Math.random() * list.length);
  const show = () => {
    bar.style.opacity = '0';
    setTimeout(() => { bar.textContent = list[i % list.length]; bar.style.opacity = '1'; }, 200);
    i++;
  };
  show();
  if (list.length > 1) mottoTimer = setInterval(show, 12000);
}

// Tint the whole UI by time of day. Sets data-daypart on <html> (CSS does the rest).
const DAYPART_META = {
  morning: { color: '#0e0b07', icon: '🌅' },
  day:     { color: '#0a0f18', icon: '☀️' },
  evening: { color: '#0d0916', icon: '🌆' },
  night:   { color: '#05070d', icon: '🌙' },
};
export function setDaypartTheme(now = new Date()) {
  const h = now.getHours();
  // Dark from 8pm; evening 20:00–24:00, night 00:00–08:00, then light day.
  const part = h < 8 ? 'night' : h < 11 ? 'morning' : h < 20 ? 'day' : 'evening';
  document.documentElement.dataset.daypart = part;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', DAYPART_META[part].color);
  const badge = $('#daypartBadge');
  if (badge) badge.textContent = `${DAYPART_META[part].icon} ${part}`;
  return part;
}
