// storage.js — localStorage layer: monthly buckets, settings, sha cache, offline queue, token.
import { LS, DEFAULT_SETTINGS, PATHS, SCHEMA_VERSION } from './config.js';
import { monthKeyOf } from './util.js';

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ---- Settings ----------------------------------------------------------------
export function getSettings() {
  const s = readJSON(LS.settings, null);
  if (!s) return structuredClone(DEFAULT_SETTINGS);
  // Shallow-merge defaults so new fields appear after upgrades.
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...s,
    defaults: { ...DEFAULT_SETTINGS.defaults, ...(s.defaults || {}) },
    location: { ...DEFAULT_SETTINGS.location, ...(s.location || {}) },
    experiment: { ...DEFAULT_SETTINGS.experiment, ...(s.experiment || {}) },
  };
}

export function saveSettings(obj) {
  writeJSON(LS.settings, obj);
}

// ---- Monthly buckets ---------------------------------------------------------
export function emptyMonth(monthKey) {
  return { month: monthKey, schemaVersion: SCHEMA_VERSION, entries: {}, sleepiness: [] };
}

export function getMonth(monthKey) {
  const m = readJSON(LS.month(monthKey), null);
  if (!m) return null;
  // Normalize shape.
  return {
    month: monthKey,
    schemaVersion: m.schemaVersion || SCHEMA_VERSION,
    entries: m.entries || {},
    sleepiness: Array.isArray(m.sleepiness) ? m.sleepiness : [],
  };
}

export function saveMonthLocal(monthKey, monthObj) {
  writeJSON(LS.month(monthKey), monthObj);
}

// Upsert a nightly entry; marks the month file dirty for sync.
export function upsertEntry(entry) {
  const monthKey = monthKeyOf(entry.date);
  const month = getMonth(monthKey) || emptyMonth(monthKey);
  month.entries[entry.date] = entry;
  saveMonthLocal(monthKey, month);
  markDirty(PATHS.month(monthKey));
  return month;
}

export function getEntry(dateStr) {
  const month = getMonth(monthKeyOf(dateStr));
  return month ? month.entries[dateStr] || null : null;
}

// Add a free-form sleepiness log; marks its month dirty.
export function addSleepiness(log) {
  const monthKey = monthKeyOf((log.datetime || '').slice(0, 10));
  const month = getMonth(monthKey) || emptyMonth(monthKey);
  month.sleepiness.push(log);
  month.sleepiness.sort((a, b) => (a.datetime < b.datetime ? -1 : 1));
  saveMonthLocal(monthKey, month);
  markDirty(PATHS.month(monthKey));
  return month;
}

// List entries (sorted by date asc) across the loaded months we have cached.
export function listEntries(monthKeys) {
  const out = [];
  for (const mk of monthKeys) {
    const m = getMonth(mk);
    if (m) out.push(...Object.values(m.entries));
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

export function listSleepiness(monthKeys) {
  const out = [];
  for (const mk of monthKeys) {
    const m = getMonth(mk);
    if (m) out.push(...m.sleepiness);
  }
  out.sort((a, b) => (a.datetime < b.datetime ? -1 : 1));
  return out;
}

// Which month buckets do we have cached locally?
export function cachedMonthKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('sd.month.')) keys.push(k.slice('sd.month.'.length));
  }
  return keys.sort();
}

// ---- Sha cache (for GitHub Contents API updates) -----------------------------
export function getSha(path) {
  return localStorage.getItem(LS.sha(path)) || null;
}
export function setSha(path, sha) {
  if (sha) localStorage.setItem(LS.sha(path), sha);
}

// ---- Offline dirty queue -----------------------------------------------------
export function getDirty() {
  return readJSON(LS.dirty, []);
}
export function markDirty(path) {
  const d = getDirty();
  if (!d.includes(path)) {
    d.push(path);
    writeJSON(LS.dirty, d);
  }
}
export function clearDirty(path) {
  writeJSON(LS.dirty, getDirty().filter((p) => p !== path));
}

// ---- Token (browser-only; never synced) --------------------------------------
export function getToken() {
  return localStorage.getItem(LS.token) || null;
}
export function setToken(t) {
  if (t) localStorage.setItem(LS.token, t);
  else localStorage.removeItem(LS.token);
}
export function clearToken() {
  localStorage.removeItem(LS.token);
}
