// app.js — controller. Offline-first: render from localStorage, then sync if possible.
import * as store from './storage.js';
import * as sync from './github-sync.js';
import * as ui from './ui.js';
import * as charts from './charts.js';
import { resolveBedroomTemp } from './weather.js';
import { summarize, correlate, comments } from './stats.js';
import { monthKeyOf, todayISO, debounce, addDays } from './util.js';

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
  charts.renderSleepinessByHour(document.getElementById('chartSleepiness'), store.listSleepiness(visibleMonthKeys()));

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

// Render the "Recent entries" list for the month chosen in the Log tab.
function renderRecent() {
  const monthInput = document.getElementById('historyMonth');
  const mk = monthInput.value || monthKeyOf(todayISO());
  monthInput.value = mk;
  const month = store.getMonth(mk);
  const entries = month ? Object.values(month.entries) : [];
  entries.sort((a, b) => (a.date < b.date ? -1 : 1));
  ui.renderEntryList(entries, settings, editEntry);
}

// ---- Date-driven Log editor --------------------------------------------------

// Load a date into the form; Edit mode if it already has a saved entry, else New.
function loadDate(date) {
  const e = store.getEntry(date);
  ui.fillForm(e || { date }, settings);
  ui.setMode(e ? 'edit' : 'new', date);
  return !!e;
}

// Most recent logged date across cached months, or null.
function newestEntryDate() {
  const entries = allEntries();
  return entries.length ? entries[entries.length - 1].date : null;
}

// On open: show the newest entry (or a new entry for today if none yet).
function loadInitialLog() {
  loadDate(newestEntryDate() || todayISO());
}

function onDateChange() {
  const date = document.getElementById('f-date').value;
  if (date) loadDate(date);
}

function shiftDay(delta) {
  const cur = document.getElementById('f-date').value || todayISO();
  document.getElementById('f-date').value = addDays(cur, delta);
  onDateChange();
}

function goToday() {
  document.getElementById('f-date').value = todayISO();
  onDateChange();
}

// "✚ New" — start a fresh entry for today (loads it if today is already logged).
function newEntry() {
  const d = todayISO();
  document.getElementById('f-date').value = d;
  if (store.getEntry(d)) {
    loadDate(d);
    ui.toast('Today already has an entry — opened it for editing');
  } else {
    ui.fillForm({ date: d }, settings);
    ui.setMode('new', d);
  }
}

// Tap a recent entry → load it into the form above.
function editEntry(date) {
  document.getElementById('f-date').value = date;
  loadDate(date);
  goTab('log');
  document.getElementById('panel-log').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

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
    renderRecent();
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
  ui.setMode('edit', entry.date); // it's now a saved entry
  document.getElementById('historyMonth').value = monthKeyOf(entry.date);
  renderSummaryView();
  renderRecent();
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
  renderSummaryView();
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
  ui.toast('Sleepiness logged', 'success');
  renderSummaryView();
  syncAfterWrite(monthKeyOf(log.datetime.slice(0, 10)));
}

// ---- Wiring ------------------------------------------------------------------

async function onMonthChange() {
  renderRecent();
  if (sync.hasToken() && sync.isOnline()) {
    try { await sync.pullMonth(document.getElementById('historyMonth').value); renderRecent(); }
    catch { /* offline / auth handled elsewhere */ }
  }
}

function wire() {
  ui.buildRatings();
  ui.buildSegmented();
  ui.buildExperimentSelects();
  ui.setupTabs();
  ui.fillSettings(settings, sync.hasToken());

  document.getElementById('logForm').addEventListener('submit', onSave);
  // Reset discards unsaved edits: reload the saved entry, or blank if it's a new date.
  document.getElementById('btn-clear').addEventListener('click', () => onDateChange());
  document.getElementById('btn-temp').addEventListener('click', onAutoTemp);
  document.getElementById('btn-save-token').addEventListener('click', onSaveToken);
  document.getElementById('btn-test').addEventListener('click', onTestConnection);
  document.getElementById('btn-save-settings').addEventListener('click', onSaveSettings);

  // Date navigation.
  document.getElementById('btn-prev-day').addEventListener('click', () => shiftDay(-1));
  document.getElementById('btn-next-day').addEventListener('click', () => shiftDay(1));
  document.getElementById('btn-today').addEventListener('click', goToday);
  document.getElementById('btn-new').addEventListener('click', newEntry);
  document.getElementById('f-date').addEventListener('change', onDateChange);

  // Live TST recompute.
  const recompute = debounce(ui.updateTstHint, 100);
  ['f-bedtime', 'f-onset', 'f-wake', 'f-alarm'].forEach((id) =>
    document.getElementById(id).addEventListener('input', recompute));
  document.getElementById('f-tst-override').addEventListener('change', ui.updateTstHint);

  // Sleepiness modal.
  document.getElementById('fab-sleepiness').addEventListener('click', ui.openSleepModal);
  document.getElementById('sleep-cancel').addEventListener('click', ui.closeSleepModal);
  document.getElementById('sleep-save').addEventListener('click', onSaveSleepiness);
  document.getElementById('sleepModal').addEventListener('click', (e) => {
    if (e.target.id === 'sleepModal') ui.closeSleepModal();
  });

  // Recent-entries month switch (Log tab).
  document.getElementById('historyMonth').value = monthKeyOf(todayISO());
  document.getElementById('historyMonth').addEventListener('change', onMonthChange);

  // Re-render on tab switch (charts need a visible canvas to size correctly).
  window.addEventListener('tabchange', (e) => {
    if (e.detail === 'summary') renderSummaryView();
    if (e.detail === 'log') renderRecent();
  });

  // Reconnect / focus → opportunistic sync.
  window.addEventListener('online', backgroundSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') backgroundSync();
  });
}

function init() {
  ui.setDaypartTheme();
  wire();
  renderSummaryView();
  renderRecent();
  loadInitialLog();
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
