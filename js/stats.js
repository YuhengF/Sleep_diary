// stats.js — pure sleep analytics. No DOM. Safe under Node for tests.
import {
  toMinutes, durationMinutes, solMinutes, mean, std, pearson, trendSlope,
  getByPath, round,
} from './util.js';

// Per-night derived metrics.
export function computeNight(entry, settings) {
  const wake = entry.wakeTime || entry.alarmTime;
  const outOfBed = entry.outOfBedTime || wake;
  const timeInBedMin = durationMinutes(entry.bedtime, outOfBed);
  const solMin = solMinutes(entry.bedtime, entry.sleepOnset);

  // TST: entered value wins; else asleep window (onset->wake), else bed->wake.
  let tstMin = entry.tstMinutes;
  if (tstMin == null) {
    tstMin = durationMinutes(entry.sleepOnset || entry.bedtime, wake);
  }

  const efficiencyPct =
    timeInBedMin && tstMin != null ? round((tstMin / timeInBedMin) * 100, 1) : null;

  const tMin = settings?.defaults?.targetTstMin ?? 510;
  const tMax = settings?.defaults?.targetTstMax ?? 540;
  let tstVsBand = null;
  if (tstMin != null) tstVsBand = tstMin < tMin ? 'below' : tstMin > tMax ? 'above' : 'in';

  return { timeInBedMin, tstMin, solMin, efficiencyPct, tstVsBand };
}

// Aggregate summary over a list of entries.
export function summarize(entries, settings) {
  const nights = entries.map((e) => ({ entry: e, m: computeNight(e, settings) }));
  const pick = (sel) => nights.map(({ entry, m }) => sel(entry, m));

  const targetMin = settings?.defaults?.targetTstMin ?? 510;
  const targetMax = settings?.defaults?.targetTstMax ?? 540;
  const inBand = nights.filter(({ m }) => m.tstVsBand === 'in').length;

  return {
    n: entries.length,
    avgEfficiency: round(mean(pick((e, m) => m.efficiencyPct)), 1),
    avgTst: round(mean(pick((e, m) => m.tstMin)), 0),
    avgSol: round(mean(pick((e, m) => m.solMin)), 0),
    avgQuality: round(mean(pick((e) => e.quality)), 1),
    avgWakeDifficulty: round(mean(pick((e) => e.wakeDifficulty)), 1),
    avgGrogginess: round(mean(pick((e) => e.grogginess1h)), 1),
    // Regularity = std-dev (minutes) of the respective clock times.
    bedtimeRegularity: round(std(pick((e) => toMinutes(e.bedtime))), 0),
    wakeRegularity: round(std(pick((e) => toMinutes(e.wakeTime || e.alarmTime))), 0),
    riseRegularity: round(std(pick((e) => toMinutes(e.outOfBedTime || e.wakeTime || e.alarmTime))), 0),
    pctInBand: entries.length ? round((inBand / entries.length) * 100, 0) : null,
    targetMin, targetMax,
    // Trends (per day) over the window.
    tstTrend: round(trendSlope(pick((e, m) => m.tstMin)), 1),
    qualityTrend: round(trendSlope(pick((e) => e.quality)), 2),
  };
}

// Correlate an experiment factor against an outcome. n>=3 required (pearson guards).
export function correlate(entries, factorPath, outcomeKey, settings) {
  const points = [];
  for (const e of entries) {
    const night = computeNight(e, settings);
    let factor = getByPath(e, factorPath);
    // Time-valued factors -> minutes for correlation.
    if (typeof factor === 'string' && /^\d{1,2}:\d{2}$/.test(factor)) factor = toMinutes(factor);
    const outcome = outcomeKey in night ? night[outcomeKey] : e[outcomeKey];
    if (factor != null && outcome != null && !isNaN(factor) && !isNaN(outcome)) {
      points.push({ x: factor, y: outcome, date: e.date });
    }
  }
  const r = pearson(points.map((p) => p.x), points.map((p) => p.y));
  return { r: round(r, 2), n: points.length, points };
}

// Plain-language, generic comments (threshold-driven; no health-condition wording).
export function comments(summary, experiment, corr) {
  const out = [];
  if (!summary || !summary.n) {
    out.push('No entries yet — log a few nights to see your patterns.');
    return out;
  }

  if (summary.avgEfficiency != null) {
    if (summary.avgEfficiency >= 85) {
      out.push(`Average sleep efficiency ${summary.avgEfficiency}% — in the healthy range (>85%).`);
    } else if (summary.avgEfficiency >= 75) {
      out.push(`Average sleep efficiency ${summary.avgEfficiency}% — slightly low; time in bed may exceed time asleep.`);
    } else {
      out.push(`Average sleep efficiency ${summary.avgEfficiency}% — low; consider matching time in bed to actual sleep need.`);
    }
  }

  if (summary.avgTst != null) {
    const h = (summary.avgTst / 60).toFixed(1);
    if (summary.pctInBand != null) {
      out.push(`Average total sleep ${h}h; ${summary.pctInBand}% of nights fell in your target band.`);
    } else {
      out.push(`Average total sleep ${h}h.`);
    }
  }

  if (summary.avgSol != null && summary.avgSol > 30) {
    out.push(`Average time to fall asleep ${summary.avgSol} min — over ~30 min suggests checking wind-down routine and screen/caffeine timing.`);
  }

  if (summary.wakeRegularity != null && summary.wakeRegularity > 60) {
    out.push(`Wake time varied by ±${summary.wakeRegularity} min — a steadier rise time often stabilizes sleep.`);
  }
  if (summary.bedtimeRegularity != null && summary.bedtimeRegularity > 60) {
    out.push(`Bedtime varied by ±${summary.bedtimeRegularity} min — more consistent timing may help.`);
  }

  if (summary.tstTrend != null && Math.abs(summary.tstTrend) >= 2) {
    out.push(`Total sleep is trending ${summary.tstTrend > 0 ? 'up' : 'down'} by ~${Math.abs(summary.tstTrend)} min/day over this window.`);
  }

  if (experiment?.active && corr && corr.r != null) {
    const strength = Math.abs(corr.r) >= 0.5 ? 'a moderate-to-strong' : Math.abs(corr.r) >= 0.3 ? 'a weak' : 'little';
    const dir = corr.r > 0 ? 'positive' : 'negative';
    if (Math.abs(corr.r) >= 0.3) {
      out.push(`Experiment: ${strength} ${dir} relationship between ${experiment.factorLabel} and your outcome (r=${corr.r}, n=${corr.n}).`);
    } else {
      out.push(`Experiment: ${strength} relationship so far between ${experiment.factorLabel} and your outcome (r=${corr.r}, n=${corr.n}). Keep tracking.`);
    }
  } else if (experiment?.active && corr) {
    out.push(`Experiment running on ${experiment.factorLabel}; need at least 3 comparable nights to estimate a relationship.`);
  }

  return out;
}
