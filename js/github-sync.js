// github-sync.js — GitHub Contents API read/write with sha handling, 404 + merge.
// The PAT is read from storage at call time; it is never persisted to any repo file.
import { GH, PATHS } from './config.js';
import * as store from './storage.js';
import { b64EncodeUtf8, b64DecodeUtf8, monthKeyOf } from './util.js';

export class AuthError extends Error {}
export class NoTokenError extends Error {}

function contentsUrl(path) {
  return `${GH.apiBase}/repos/${GH.owner}/${GH.repo}/contents/${path}`;
}

function headers() {
  const token = store.getToken();
  if (!token) throw new NoTokenError('No GitHub token configured');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GH.apiVersion,
  };
}

export function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function hasToken() {
  return !!store.getToken();
}

// GET a file. Returns { json, sha }. 404 -> { json:null, sha:null } (first-use is normal).
export async function getFile(path) {
  const res = await fetch(contentsUrl(path), { headers: headers(), cache: 'no-store' });
  if (res.status === 404) return { json: null, sha: null };
  if (res.status === 401) throw new AuthError('Invalid or expired token');
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  const data = await res.json();
  const json = JSON.parse(b64DecodeUtf8(data.content));
  store.setSha(path, data.sha);
  return { json, sha: data.sha };
}

// PUT a file. Creates when sha is null, updates otherwise. Retries once on sha conflict.
// Note: committer/author are intentionally omitted so commits attribute to the token owner.
export async function putFile(path, jsonObj, sha = null, message = null) {
  const body = {
    message: message || `Update ${path}`,
    content: b64EncodeUtf8(JSON.stringify(jsonObj, null, 2)),
  };
  if (sha) body.sha = sha;

  let res = await fetch(contentsUrl(path), {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  // Sha conflict / stale: re-fetch, merge, retry once.
  if (res.status === 409 || res.status === 422) {
    const remote = await getFile(path);
    const merged = mergeFile(path, remote.json, jsonObj);
    const retryBody = {
      message: body.message,
      content: b64EncodeUtf8(JSON.stringify(merged, null, 2)),
    };
    if (remote.sha) retryBody.sha = remote.sha;
    res = await fetch(contentsUrl(path), {
      method: 'PUT',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(retryBody),
    });
    if (res.ok) {
      const data = await res.json();
      store.setSha(path, data.content.sha);
      return { json: merged, sha: data.content.sha };
    }
  }

  if (res.status === 401) throw new AuthError('Invalid or expired token');
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
  const data = await res.json();
  store.setSha(path, data.content.sha);
  return { json: jsonObj, sha: data.content.sha };
}

// ---- Merge strategies (what makes multiple devices converge) ------------------

// Per-date last-writer-wins for entries; union-by-id (newest wins) for sleepiness.
export function mergeMonth(remote, local) {
  if (!remote) return local;
  if (!local) return remote;
  const entries = { ...remote.entries };
  for (const [date, e] of Object.entries(local.entries || {})) {
    const r = entries[date];
    if (!r || (e.updatedAt || '') >= (r.updatedAt || '')) entries[date] = e;
  }

  const byId = new Map();
  for (const s of remote.sleepiness || []) byId.set(s.id, s);
  for (const s of local.sleepiness || []) {
    const r = byId.get(s.id);
    if (!r || (s.updatedAt || s.datetime || '') >= (r.updatedAt || r.datetime || '')) {
      byId.set(s.id, s);
    }
  }
  const sleepiness = [...byId.values()].sort((a, b) => (a.datetime < b.datetime ? -1 : 1));

  return {
    month: local.month || remote.month,
    schemaVersion: Math.max(local.schemaVersion || 1, remote.schemaVersion || 1),
    entries,
    sleepiness,
  };
}

// Settings merge: take the newer top-level (settings has no per-key timestamps),
// preferring local since it's the device the user just edited on.
export function mergeSettings(remote, local) {
  return local || remote;
}

function mergeFile(path, remote, local) {
  return path === PATHS.settings ? mergeSettings(remote, local) : mergeMonth(remote, local);
}

// ---- High-level sync ---------------------------------------------------------

// Pull remote month, merge with local cache, push if changed, refresh local cache.
export async function syncMonth(monthKey) {
  const path = PATHS.month(monthKey);
  const local = store.getMonth(monthKey) || store.emptyMonth(monthKey);
  const remote = await getFile(path);
  const merged = mergeMonth(remote.json, local);
  store.saveMonthLocal(monthKey, merged);

  const changedRemotely = JSON.stringify(remote.json) !== JSON.stringify(merged);
  if (changedRemotely || !remote.json) {
    await putFile(path, merged, remote.sha, `Update ${monthKey} sleep entries`);
  }
  store.clearDirty(path);
  return merged;
}

export async function syncSettings() {
  const path = PATHS.settings;
  const local = store.getSettings();
  const remote = await getFile(path);
  // Local wins (user just edited here); still push so other devices see it.
  await putFile(path, local, remote.sha, 'Update settings');
  store.clearDirty(path);
  return local;
}

// Flush any queued dirty paths (called on load + on reconnect).
export async function flushDirty() {
  if (!hasToken() || !isOnline()) return;
  for (const path of store.getDirty()) {
    if (path === PATHS.settings) {
      await syncSettings();
    } else {
      const mk = path.replace('entries/', '').replace('.json', '');
      await syncMonth(mk);
    }
  }
}

// Pull a month from remote into the local cache (no push). Used on first load / month switch.
export async function pullMonth(monthKey) {
  const path = PATHS.month(monthKey);
  const remote = await getFile(path);
  if (remote.json) {
    const local = store.getMonth(monthKey);
    const merged = local ? mergeMonth(remote.json, local) : remote.json;
    store.saveMonthLocal(monthKey, merged);
    return merged;
  }
  return store.getMonth(monthKey);
}

export async function pullSettings() {
  const remote = await getFile(PATHS.settings);
  if (remote.json) {
    store.saveSettings(remote.json);
    return remote.json;
  }
  return store.getSettings();
}

// Lightweight connectivity/permission check for the Settings "test connection" button.
export async function testConnection() {
  const res = await fetch(contentsUrl(''), { headers: headers(), cache: 'no-store' });
  if (res.status === 401) throw new AuthError('Invalid or expired token');
  if (res.status === 404) throw new Error('Repo not found or token lacks access');
  if (!res.ok) throw new Error(`Connection failed: ${res.status}`);
  return true;
}

export { monthKeyOf };
