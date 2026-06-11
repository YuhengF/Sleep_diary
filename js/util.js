// util.js — pure helpers, no DOM, no side effects. Safe to run under Node for tests.

// "HH:MM" -> minutes since midnight, or null.
export function toMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// minutes since midnight -> "HH:MM" (wraps within a day).
export function toHHMM(min) {
  if (min == null || isNaN(min)) return '';
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// Duration in minutes between two wall-clock times, crossing midnight if end < start.
export function durationMinutes(startHHMM, endHHMM) {
  const s = toMinutes(startHHMM), e = toMinutes(endHHMM);
  if (s == null || e == null) return null;
  let d = e - s;
  if (d < 0) d += 1440;
  return d;
}

// Sleep onset latency: onset - bedtime (same evening; may cross midnight).
export function solMinutes(bedtime, sleepOnset) {
  return durationMinutes(bedtime, sleepOnset);
}

// Format minutes as "8h 25m".
export function fmtDuration(min) {
  if (min == null || isNaN(min)) return '—';
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// UTF-8 safe base64 (handles non-ASCII in notes). Works in browser; falls back under Node.
export function b64EncodeUtf8(str) {
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(str)));
  }
  return Buffer.from(str, 'utf-8').toString('base64');
}

export function b64DecodeUtf8(b64) {
  const clean = (b64 || '').replace(/\n/g, '');
  if (typeof atob === 'function') {
    return decodeURIComponent(escape(atob(clean)));
  }
  return Buffer.from(clean, 'base64').toString('utf-8');
}

// "YYYY-MM-DD" -> "YYYY-MM".
export function monthKeyOf(dateStr) {
  return (dateStr || '').slice(0, 7);
}

// Today's local date as "YYYY-MM-DD".
export function todayISO() {
  return isoOf(new Date());
}

function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Shift an ISO date by n days (local, DST-safe).
export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

// "2026-06-12" -> "Fri Jun 12" (locale-aware).
export function formatNice(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---- Timezone helpers --------------------------------------------------------
// Records store UTC ISO timestamps; these convert to/from a configured IANA zone
// (e.g. "America/Los_Angeles") so display is consistent across devices.

const DEFAULT_TZ = 'America/Los_Angeles';

// Break a UTC instant into wall-clock parts in `tz`.
export function zonedParts(iso, tz = DEFAULT_TZ) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, hour: +p.hour, minute: +p.minute };
}

export function zonedDateStr(iso, tz) { return zonedParts(iso, tz).date; }
export function zonedTimeStr(iso, tz) { return zonedParts(iso, tz).time; }
export function zonedHourFloat(iso, tz) { const p = zonedParts(iso, tz); return p.hour + p.minute / 60; }

// Offset (ms) of `tz` from UTC at the given instant.
function tzOffsetMs(date, tz) {
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const loc = new Date(date.toLocaleString('en-US', { timeZone: tz }));
  return loc.getTime() - utc.getTime();
}

// Wall-clock date+time in `tz` -> UTC ISO instant.
export function wallToUTC(dateStr, timeStr, tz = DEFAULT_TZ) {
  const naive = new Date(`${dateStr}T${timeStr || '00:00'}:00Z`);
  const off = tzOffsetMs(naive, tz);
  return new Date(naive.getTime() - off).toISOString();
}

export function mean(nums) {
  const xs = nums.filter((n) => n != null && !isNaN(n));
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function std(nums) {
  const xs = nums.filter((n) => n != null && !isNaN(n));
  if (xs.length < 2) return null;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
  return Math.sqrt(v);
}

// Pearson correlation over paired arrays; returns null if < 3 valid pairs or zero variance.
export function pearson(xs, ys) {
  const pairs = [];
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] != null && ys[i] != null && !isNaN(xs[i]) && !isNaN(ys[i])) {
      pairs.push([xs[i], ys[i]]);
    }
  }
  if (pairs.length < 3) return null;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let num = 0, dx = 0, dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

// Simple least-squares slope of y over index 0..n-1 (trend per day).
export function trendSlope(ys) {
  const xs = ys.map((_, i) => i);
  const valid = [];
  for (let i = 0; i < ys.length; i++) {
    if (ys[i] != null && !isNaN(ys[i])) valid.push([xs[i], ys[i]]);
  }
  if (valid.length < 2) return null;
  const mx = mean(valid.map((p) => p[0]));
  const my = mean(valid.map((p) => p[1]));
  let num = 0, den = 0;
  for (const [x, y] of valid) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

// Read a dotted path ("melatonin.doseMg") out of an object; returns undefined if missing.
export function getByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// RFC4122-ish uuid; uses crypto when available.
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Round to n decimals, returning a Number.
export function round(n, decimals = 0) {
  if (n == null || isNaN(n)) return null;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
