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

// 1–10 rating metadata: label per endpoint so sliders read intuitively.
export const SCALES = {
  quality: { label: 'Sleep quality', low: 'terrible', high: 'excellent' },
  wakeDifficulty: { label: 'Wake difficulty', low: 'effortless', high: 'very hard' },
  grogginess1h: { label: 'Grogginess (~1h after wake)', low: 'fresh', high: 'very groggy' },
  sleepiness: { label: 'Sleepiness', low: 'fully alert', high: 'nodding off' },
};

export const RATING_MIN = 1;
export const RATING_MAX = 10;
export const RATING_DEFAULT = 5; // neutral midpoint for new entries

// Defaults applied to new entries / fresh settings.
export const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  defaults: { alarmTime: '08:00', targetTstMin: 510, targetTstMax: 540 }, // 8.5–9h
  location: { mode: 'geo', lat: null, lon: null, manualTempC: null },
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
  { key: 'grogginess1h', label: 'Morning grogginess' },
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
