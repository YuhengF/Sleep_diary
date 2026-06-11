// config.js — app-wide constants. No secrets here.

export const GH = {
  owner: 'YuhengF',
  repo: 'sleep_diary_data_YF',
  apiBase: 'https://api.github.com',
  apiVersion: '2022-11-28',
};

// Path builders inside the data repo.
export const PATHS = {
  settings: 'settings.json',
  month: (monthKey) => `entries/${monthKey}.json`,
};

// Melatonin dose options (mg). 0 = none.
export const MELATONIN_DOSES = [0, 0.2, 0.4, 0.6, 1, 2, 5];

// Meal / snack amount options.
export const MEAL_AMOUNTS = ['small', 'medium', 'big'];
export const SNACK_AMOUNTS = ['none', 'small', 'medium', 'big'];

// All rating scales are unified so HIGHER = BETTER (1 worst … 10 best), letting one
// red→green color ramp and one word ladder apply everywhere. The "negative" metrics
// are reframed into positive ones (wake ease, alertness) to keep the direction common.
export const SCALES = {
  quality:          { label: 'Sleep quality', low: 'terrible', high: 'great' },
  wakeEase:         { label: 'Wake ease', low: 'very hard', high: 'effortless' },
  morningAlertness: { label: 'Morning alertness (~1h after wake)', low: 'groggy', high: 'fresh' },
  alertness:        { label: 'Alertness now', low: 'exhausted', high: 'wide awake' },
};

// Word shown to the left of the selected number (index 1..10).
export const RATING_WORDS = [
  '', 'awful', 'bad', 'poor', 'meh', 'so-so', 'fair', 'good', 'great', 'excellent', 'perfect',
];

export const RATING_MIN = 1;
export const RATING_MAX = 10;
export const RATING_DEFAULT = 5; // neutral midpoint for new entries

// Default persona/goal prompt for the "Ask AI" export (user-editable in Settings).
export const DEFAULT_AI_PROMPT =
  'You are an experienced sleep physician analyzing my personal sleep diary (an N-of-1 ' +
  'experiment). Identify patterns and likely causes affecting my sleep onset, quality, ' +
  'duration, night awakenings, and morning alertness. Point out which factors (melatonin ' +
  'dose/timing, light, exercise, dinner, caffeine, bedtime regularity, bedroom temperature, ' +
  'naps) seem to help or hurt, cite the specific days/metrics that support each point, and ' +
  'suggest concrete one-factor-at-a-time experiments to try next.';

// Defaults applied to new entries / fresh settings.
export const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  defaults: { alarmTime: '08:00', targetTstMin: 510, targetTstMax: 540 }, // 8.5–9h
  location: { mode: 'geo', lat: null, lon: null, manualTempC: null },
  aiPrompt: DEFAULT_AI_PROMPT,
  experiment: {
    active: false,
    factor: 'melatonin.doseMg',
    factorLabel: 'Melatonin dose',
    startDate: null,
    days: 7,
  },
};

// Factors selectable in experiment mode → dotted path into an entry + a human label.
export const EXPERIMENT_FACTORS = [
  { path: 'melatonin.doseMg', label: 'Melatonin dose' },
  { path: 'sunlight.minutes', label: 'Morning sunlight (min)' },
  { path: 'exercise.durationMin', label: 'Exercise duration (min)' },
  { path: 'bedroomTempC', label: 'Bedroom temperature' },
  { path: 'caffeine.time', label: 'Caffeine timing' },
  { path: 'dinner.time', label: 'Dinner timing' },
  { path: 'bedtime', label: 'Bedtime' },
];

// Outcomes the experiment can correlate the factor against.
export const EXPERIMENT_OUTCOMES = [
  { key: 'quality', label: 'Sleep quality' },
  { key: 'tstMin', label: 'Total sleep time' },
  { key: 'efficiencyPct', label: 'Sleep efficiency' },
  { key: 'solMin', label: 'Sleep onset latency' },
  { key: 'morningAlertness', label: 'Morning alertness' },
];

// localStorage keys.
export const LS = {
  token: 'sd.token',
  settings: 'sd.settings',
  month: (monthKey) => `sd.month.${monthKey}`,
  sha: (path) => `sd.sha.${path}`,
  dirty: 'sd.dirty',
};

export const SCHEMA_VERSION = 1;
