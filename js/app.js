// app.js — controller. Offline-first: render from localStorage, then sync if possible.
import * as store from './storage.js';
import * as sync from './github-sync.js';
import * as ui from './ui.js';
import * as charts from './charts.js';
import { resolveBedroomTemp } from './weather.js';
import * as ai from './ai-export.js';
import { summarize, correlate, comments } from './stats.js';
import { monthKeyOf, todayISO, debounce, zonedDateStr, zonedTimeStr, wallToUTC } from './util.js';

let settings = store.getSettings();

// ---- Data window helpers -----------------------------------------------------

function visibleMonthKeys() {
  // Current month + any cached months, deduped & sorted.
  const set = new Set(store.cachedMonthKeys());
  set.add(monthKeyOf(todayISO()));
  return [...set].sort();
}

function allEntries() {
  return store.listEntries(visibleMonthKeys());
}

// ---- Rendering ---------------------------------------------------------------

function renderSummaryView() {
  const entries = allEntries();
  const sum = summarize(entries, settings);
  const exp = settings.experiment;
  let corr = null;
  if (exp?.active) {
    corr = correlate(entries, exp.factor, exp.outcome || 'quality', settings);
  }
  ui.renderSummary(sum);
  ui.renderComments(comments(sum, exp, corr));
  ui.renderExpBanner(settings, corr);

  charts.renderTimeline(document.getElementById('chartTimeline'), entries, settings);
  charts.renderTstTrend(document.getElementById('chartTst'), entries, settings);
  charts.renderQualityTrend(document.getElementById('chartQuality'), entries);
  charts.renderSleepinessByHour(document.getElementById('chartSleepiness'), store.listSleepiness(visibleMonthKeys()), settings.timezone || 'America/Los_Angeles');

  const scatterCard = document.getElementById('scatterCard');
  if (exp?.active) {
    scatterCard.hidden = false;
    const outLabel = (exp.outcome || 'quality');
    document.getElementById('scatterTitle').textContent = `${exp.factorLabel} vs ${outLabel}`;
    charts.renderFactorScatter(document.getElementById('chartScatter'), corr, exp.factorLabel, outLabel);
  } else {
    scatterCard.hidden = true;
  }
}

// The month currently shown in the calendar / recent list.
let calMonth = monthKeyOf(todayISO());

function shiftMonth(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Render the calendar for calMonth; dots are colored by each night's quality.
function renderCalendar() {
  const month = store.getMonth(calMonth);
  const entries = month ? month.entries : {};
  const selected = document.getElementById('f-date').value;
  ui.renderCalendar(document.getElementById('calendar'), calMonth, selected, entries, {
    onPick: (date) => { setDate(date); },
    onPrev: () => { calMonth = shiftMonth(calMonth, -1); refreshMonthView(); },
    onNext: () => { calMonth = shiftMonth(calMonth, 1); refreshMonthView(); },
    onToday: () => { calMonth = monthKeyOf(todayISO()); setDate(todayISO()); },
  });
}

// Editable alertness check-ins for the selected day (times shown in the user's tz).
function renderCheckins() {
  const date = document.getElementById('f-date').value || todayISO();
  const tz = settings.timezone || 'America/Los_Angeles';
  // Check-ins are stored in UTC; bucket them by their zoned date so they land on
  // the day the user actually logged them, not the UTC date.
  const dayLogs = store.listSleepiness(store.cachedMonthKeys())
    .filter((c) => zonedDateStr(c.datetime, tz) === date);

  ui.renderCheckins(date, dayLogs, tz, {
    onEdit: (id, patch) => {
      const p = {};
      if (patch.level != null) p.level = patch.level;
      if (patch.time) p.datetime = wallToUTC(date, patch.time, tz);
      store.updateSleepiness(id, p);
      renderSummaryView();
      syncAfterWrite(monthKeyOf(zonedDateStr(p.datetime || new Date().toISOString(), tz)));
    },
    onDelete: (id) => {
      store.deleteSleepiness(id);
      renderCheckins();
      renderSummaryView();
      syncAfterWrite(monthKeyOf(date));
    },
    onAdd: () => {
      // Backfill at the current time (if today) or noon, interpreted in the user's tz.
      const time = (zonedDateStr(new Date().toISOString(), tz) === date)
        ? zonedTimeStr(new Date().toISOString(), tz) : '12:00';
      const datetime = wallToUTC(date, time, tz);
      store.addSleepiness({
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        datetime, level: 5, note: null, updatedAt: new Date().toISOString(),
      });
      renderCheckins();
      renderSummaryView();
      syncAfterWrite(monthKeyOf(zonedDateStr(datetime, tz)));
    },
  });
}

// Re-render calendar + check-ins after changing the displayed month.
function refreshMonthView() {
  renderCalendar();
  renderCheckins();
  if (sync.hasToken() && sync.isOnline()) {
    sync.pullMonth(calMonth).then(() => { renderCalendar(); renderCheckins(); }).catch(() => {});
  }
}

// ---- Date-driven Log editor --------------------------------------------------

// Load a date into the form; Edit mode if it already has a saved entry, else New.
function loadDate(date) {
  const e = store.getEntry(date);
  ui.fillForm(e || { date }, settings);
  ui.setMode(e ? 'edit' : 'new', date);
  return !!e;
}

// Select a date everywhere: form + calendar highlight + that day's check-ins.
function setDate(date) {
  document.getElementById('f-date').value = date;
  calMonth = monthKeyOf(date);
  loadDate(date);
  renderCalendar();
  renderCheckins();
}

// Most recent logged date across cached months, or null.
function newestEntryDate() {
  const entries = allEntries();
  return entries.length ? entries[entries.length - 1].date : null;
}

// On open: show the newest entry (or a new entry for today if none yet).
function loadInitialLog() {
  setDate(newestEntryDate() || todayISO());
}

// Tap a recent entry → load it and bring the form into view.
function goTab(name) {
  const btn = document.querySelector(`.tab-btn[data-go="${name}"]`);
  if (btn) btn.click();
}

// ---- Sync orchestration ------------------------------------------------------

function updateStatusIdle() {
  if (!sync.hasToken()) return ui.setSyncStatus('local', 'local only');
  if (!sync.isOnline()) return ui.setSyncStatus('offline', 'offline');
  const pending = store.getDirty().length;
  ui.setSyncStatus(pending ? 'syncing' : 'synced', pending ? `${pending} pending` : 'synced');
}

async function backgroundSync() {
  if (!sync.hasToken() || !sync.isOnline()) { updateStatusIdle(); return; }
  try {
    ui.setSyncStatus('syncing', 'syncing…');
    await sync.pullSettings();
    settings = store.getSettings();
    await sync.pullMonth(monthKeyOf(todayISO()));
    await sync.flushDirty();
    renderSummaryView();
    renderCalendar();
    renderCheckins();
    updateStatusIdle();
  } catch (err) {
    if (err instanceof sync.AuthError) {
      ui.setSyncStatus('error', 'bad token');
      ui.toast('GitHub token invalid or expired — re-enter it in Settings.', 'error');
    } else {
      ui.setSyncStatus('error', 'sync error');
      console.warn('Sync failed:', err.message);
    }
  }
}

// Sync a single month after a local write (or queue it for later).
async function syncAfterWrite(monthKey) {
  if (!sync.hasToken() || !sync.isOnline()) { updateStatusIdle(); return; }
  try {
    ui.setSyncStatus('syncing', 'saving…');
    await sync.syncMonth(monthKey);
    updateStatusIdle();
  } catch (err) {
    if (err instanceof sync.AuthError) {
      ui.setSyncStatus('error', 'bad token');
      ui.toast('Token invalid — saved locally, will retry after you update it.', 'error');
    } else {
      ui.setSyncStatus('offline', 'saved locally');
      console.warn('Write sync failed:', err.message);
    }
  }
}

// ---- Event handlers ----------------------------------------------------------

function onSave(ev) {
  ev.preventDefault();
  const entry = ui.readForm();
  if (!entry) { ui.toast('Pick a date first', 'error'); return; }
  store.upsertEntry(entry);
  ui.setMode('edit', entry.date); // updates the Save→Update button label
  calMonth = monthKeyOf(entry.date);
  renderSummaryView();
  renderCalendar();
  ui.toast(`Saved ${entry.date}`, 'success');
  syncAfterWrite(monthKeyOf(entry.date));
}

async function onAutoTemp() {
  const dateEl = document.getElementById('f-date');
  const entry = { date: dateEl.value || todayISO() };
  ui.toast('Fetching temperature…');
  try {
    const res = await resolveBedroomTemp(entry, settings);
    if (res && res.bedroomTempC != null) {
      document.getElementById('f-temp').value = res.bedroomTempC;
      document.getElementById('tempHint').textContent =
        'Estimated outdoor temperature (proxy). Override if you have a thermostat reading.';
      // Cache resolved coordinates so we don't re-prompt each time.
      if (res.lat != null) {
        settings.location = { ...settings.location, lat: res.lat, lon: res.lon };
        store.saveSettings(settings);
      }
    } else {
      ui.toast('Could not get temperature — enter manually.', 'error');
    }
  } catch (err) {
    ui.toast('Location/temperature unavailable — enter manually.', 'error');
  }
}

function onSaveToken() {
  const val = document.getElementById('f-token').value.trim();
  if (!val) { ui.toast('Paste a token first', 'error'); return; }
  store.setToken(val);
  document.getElementById('f-token').value = '';
  ui.fillSettings(settings, true);
  ui.toast('Token saved', 'success');
  backgroundSync();
}

async function onTestConnection() {
  const typed = document.getElementById('f-token').value.trim();
  if (typed) store.setToken(typed); // test what the user just typed
  const hint = document.getElementById('tokenHint');
  if (!sync.hasToken()) { ui.toast('Paste a token first', 'error'); return; }
  hint.textContent = 'Testing…';
  try {
    await sync.testConnection();
    hint.textContent = '✓ Connected — token can read & write the data repo.';
    ui.toast('Connection OK', 'success');
  } catch (err) {
    hint.textContent = `✗ ${err.message}`;
    ui.toast('Connection failed', 'error');
  }
}

function onSaveSettings() {
  settings = ui.readSettings(settings);
  store.saveSettings(settings);
  store.markDirty('settings.json');
  ui.toast('Settings saved', 'success');
  ui.startMottos(settings.mottos);
  renderSummaryView();
  renderCheckins();
  if (sync.hasToken() && sync.isOnline()) {
    sync.syncSettings().then(updateStatusIdle).catch(() => updateStatusIdle());
  } else {
    updateStatusIdle();
  }
}

function onSaveSleepiness() {
  const log = ui.readSleepiness();
  store.addSleepiness(log);
  ui.closeSleepModal();
  ui.toast('Alertness logged', 'success');
  renderSummaryView();
  renderCheckins();
  syncAfterWrite(monthKeyOf(log.datetime.slice(0, 10)));
}

async function onAiCopy() {
  const q = document.getElementById('aiQuestion').value.trim();
  const text = ai.buildPrompt(q, settings);
  const ok = await ai.copyText(text);
  ui.toast(ok ? 'Prompt copied — paste into any AI chat' : 'Copy failed — use Download JSON instead', ok ? 'success' : 'error');
}

function onAiDownload() {
  const q = document.getElementById('aiQuestion').value.trim();
  ai.downloadJSON(q, settings);
  ui.toast('Downloaded sleep-diary-for-ai.json', 'success');
}

function toggleAttrib() {
  const text = document.getElementById('attribText');
  const btn = document.getElementById('attribToggle');
  if (!text) return;
  const show = text.hidden;
  text.hidden = !show;
  if (btn) btn.setAttribute('aria-expanded', String(show));
}

// ---- Wiring ------------------------------------------------------------------

// Defensive binder: never let one missing element break the rest of the wiring.
function on(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

function toggleComments() {
  const card = document.getElementById('summaryComments');
  const btn = document.getElementById('commentsToggle');
  if (!card) return;
  const show = card.hidden;
  card.hidden = !show;
  if (btn) btn.setAttribute('aria-expanded', String(show));
}

function wire() {
  ui.buildRatings();
  ui.buildSegmented();
  ui.buildExperimentSelects();
  ui.setupTabs();
  ui.fillSettings(settings, sync.hasToken());

  on('logForm', 'submit', onSave);
  // Reset discards unsaved edits: reload the saved entry, or blank if it's a new date.
  on('btn-clear', 'click', () => loadDate(document.getElementById('f-date').value));
  on('btn-temp', 'click', onAutoTemp);
  on('btn-save-token', 'click', onSaveToken);
  on('btn-test', 'click', onTestConnection);
  on('btn-save-settings', 'click', onSaveSettings);
  on('commentsToggle', 'click', toggleComments);
  on('attribToggle', 'click', toggleAttrib);
  on('aiCopy', 'click', onAiCopy);
  on('aiDownload', 'click', onAiDownload);
  on('f-no-alarm', 'change', ui.onAlarmToggle);

  // Live TST recompute + bedtime/onset day hints.
  const recompute = debounce(ui.updateTstHint, 100);
  ['f-bedtime', 'f-onset', 'f-wake', 'f-alarm', 'f-waso'].forEach((id) => on(id, 'input', recompute));
  ['f-bedtime', 'f-onset'].forEach((id) => on(id, 'input', ui.updateNightTimes));
  on('f-tst-override', 'change', ui.updateTstHint);

  // Alertness check-in modal.
  on('fab-sleepiness', 'click', ui.openSleepModal);
  on('sleep-cancel', 'click', ui.closeSleepModal);
  on('sleep-save', 'click', onSaveSleepiness);
  on('sleepModal', 'click', (e) => { if (e.target.id === 'sleepModal') ui.closeSleepModal(); });

  // Re-render on tab switch (charts need a visible canvas to size correctly).
  window.addEventListener('tabchange', (e) => {
    if (e.detail === 'summary') renderSummaryView();
    if (e.detail === 'log') { renderCalendar(); renderCheckins(); }
  });

  // Reconnect / focus → opportunistic sync.
  window.addEventListener('online', backgroundSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') backgroundSync();
  });
}

function init() {
  store.migrateScalesOnce(); // one-time fix for old (flipped) records
  ui.setDaypartTheme();
  ui.startMottos(settings.mottos);
  wire();
  renderSummaryView();
  loadInitialLog();   // sets the date, then renders the calendar + check-ins
  updateStatusIdle();
  backgroundSync(); // pull + flush if a token exists
  // Keep the theme in step with the clock (e.g. crossing into evening while open).
  setInterval(() => ui.setDaypartTheme(), 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ui.setDaypartTheme();
  });
}

// Network-first service worker keeps the app fresh after deploys + enables offline use.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
