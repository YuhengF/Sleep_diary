// ai-export.js — build a privacy-preserving, paste-ready prompt (and JSON) from the
// diary so the user can ask any AI about their sleep. Dates are shifted to a neutral
// year (intervals + weekdays preserved); token and location are never included.
import * as store from './storage.js';
import { DEFAULT_AI_PROMPT } from './config.js';
import { addDays, zonedDateStr, zonedTimeStr } from './util.js';

// Concise field legend so the AI understands the data without guessing.
const LEGEND = {
  _about: 'Personal sleep diary. One entry per night, keyed by the WAKE-UP morning date. ' +
    'Evening factors (dinner, snack, caffeine, exercise, melatonin, bedtime) belong to the ' +
    'night before; morning factors (wake, sunlight, alertness, quality) are that morning. ' +
    'A bedtime after midnight (e.g. 02:00) is that same wake-up day.',
  _scales: 'All 1–10 ratings are HIGHER = BETTER: quality, wakeEase, morningAlertness, ' +
    'and check-in level (alertness).',
  _efficiency: 'Sleep ends = outOfBedTime (when sleep finally ended, e.g. after falling ' +
    'back asleep following a first wake); if empty it falls back to wakeTime. wakeTime is ' +
    'only the FIRST wake — total sleep is measured to "sleep ends" so sleeping in is counted. ' +
    'TIB = bedtime→sleep ends. TST = (sleepOnset→sleep ends) − WASO. ' +
    'Sleep efficiency = TST / TIB. Naps are daytime sleep, excluded from efficiency.',
  _privacy: 'Dates are pseudonymized: shifted by a constant offset so real calendar dates ' +
    'are hidden while gaps between days and weekdays are preserved. Times of day are real.',
  _timezone: 'All clock times and check-in times are in the patient\'s local timezone ' +
    '(see settings.timezone). Stored timestamps are UTC; here they are already converted.',
  fields: {
    date: 'wake-up morning (pseudo)', alarmTime: 'HH:MM or null (no alarm)',
    wakeTime: 'HH:MM — FIRST wake time only',
    outOfBedTime: 'HH:MM — sleep ends (final wake, incl. falling back asleep); end of sleep for TST/efficiency (empty ⇒ use wakeTime)',
    bedtime: 'HH:MM (prev evening or post-midnight)',
    sleepOnset: 'HH:MM last attempt to sleep', waso: 'min awake during the night',
    awakenings: 'number of times woken during the night',
    napMinutes: 'daytime nap minutes', tstMinutes: 'manual total-sleep min, else null=computed',
    quality: '1–10', wakeEase: '1–10', morningAlertness: '1–10 (~1h after waking)',
    coldFaceWash: 'true/false — washed face with cold water on waking',
    'melatonin.doseMg': 'mg (0=none)', 'melatonin.time': 'HH:MM',
    'sunlight.minutes': 'morning light min (to wake)', 'sunlight.totalMinutes': 'total daily sunlight min', 'exercise.durationMin': 'min',
    'dinner.amount': 'small|medium|big', 'bedSnack.amount': 'none|small|medium|big',
    'caffeine.time': 'HH:MM', bedroomTempC: '°C', notes: 'free text',
    checkins: '{ time, level } daytime alertness check-ins (level 1–10, higher=more alert)',
  },
};

// Pick a pseudo start date in 2001 that shares the earliest real date's weekday.
function offsetDaysFor(earliestISO) {
  const real = new Date(earliestISO + 'T00:00:00');
  const ps = new Date('2001-01-01T00:00:00');
  while (ps.getDay() !== real.getDay()) ps.setDate(ps.getDate() + 1);
  return Math.round((ps - real) / 86400000);
}

function cleanEntry(e, shift, includeNotes) {
  const out = {
    date: shift(e.date),
    alarmTime: e.alarmTime ?? null, wakeTime: e.wakeTime ?? null, outOfBedTime: e.outOfBedTime ?? null,
    bedtime: e.bedtime ?? null, sleepOnset: e.sleepOnset ?? null,
    waso: e.waso ?? null, awakenings: e.awakenings ?? null, napMinutes: e.napMinutes ?? null,
    tstMinutes: e.tstMinutes ?? null,
    quality: e.quality ?? null, wakeEase: e.wakeEase ?? null, morningAlertness: e.morningAlertness ?? null,
    coldFaceWash: e.coldFaceWash ?? null,
    melatonin: e.melatonin || null, sunlight: e.sunlight || null, exercise: e.exercise || null,
    dinner: e.dinner || null, bedSnack: e.bedSnack || null, caffeine: e.caffeine || null,
    bedroomTempC: e.bedroomTempC ?? null,
  };
  if (includeNotes) out.notes = e.notes || '';
  return out;
}

// Build the pseudonymized payload object.
export function buildPayload(question, settings) {
  const months = store.cachedMonthKeys();
  const entries = store.listEntries(months);
  // Only the built-in Alertness check-ins go to the AI; custom trackers are private.
  const checkins = store.listSleepiness(months).filter((c) => (c.type || 'alertness') === 'alertness');
  const tz = settings.timezone || 'America/Los_Angeles';

  const allDates = [
    ...entries.map((e) => e.date),
    ...checkins.map((c) => zonedDateStr(c.datetime, tz)),
  ].filter(Boolean).sort();
  const offset = allDates.length ? offsetDaysFor(allDates[0]) : 0;
  const shift = (iso) => addDays(iso, offset);
  const includeNotes = settings.includeNotes !== false;

  return {
    legend: LEGEND,
    question: question || '(Please give a general analysis and concrete suggestions.)',
    settings: { timezone: tz, targetSleepMin: settings.defaults.targetTstMin, targetSleepMax: settings.defaults.targetTstMax, experiment: settings.experiment },
    entries: entries.map((e) => cleanEntry(e, shift, includeNotes)),
    // Check-ins as zoned date+time (pseudonymized date), so the AI reads real local times.
    checkins: checkins.map((c) => ({
      date: shift(zonedDateStr(c.datetime, tz)),
      time: zonedTimeStr(c.datetime, tz),
      level: c.level,
      note: includeNotes ? (c.note || null) : null,
    })),
  };
}

// Build the ready-to-paste text (persona + legend + question + JSON).
export function buildPrompt(question, settings) {
  const persona = (settings.aiPrompt || DEFAULT_AI_PROMPT).trim();
  const payload = buildPayload(question, settings);
  const n = payload.entries.length;
  return (
    `${persona}\n\n` +
    `I'm sharing my sleep diary as JSON (${n} night${n === 1 ? '' : 's'}). ` +
    `Read the "legend" first — it explains the fields, the 1–10 scales (higher = better), ` +
    `how sleep efficiency is computed, and that dates are pseudonymized.\n\n` +
    `My question: ${payload.question}\n\n` +
    '```json\n' + JSON.stringify(payload, null, 2) + '\n```'
  );
}

// Copy text to clipboard with a legacy fallback.
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// Trigger a JSON file download.
export function downloadJSON(question, settings) {
  const payload = buildPayload(question, settings);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sleep-diary-for-ai.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
