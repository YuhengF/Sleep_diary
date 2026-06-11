// weather.js — Open-Meteo (no API key) + browser geolocation. Never blocks saving.
// Outdoor temperature is used as a proxy for bedroom temperature, with manual override.

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

// Promisified geolocation with a timeout. Resolves { lat, lon } or throws.
export function getCoords(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { timeout: timeoutMs, maximumAge: 10 * 60 * 1000, enableHighAccuracy: false }
    );
  });
}

// Current outdoor temperature (°C) at coordinates.
export async function fetchCurrentTemp(lat, lon) {
  const url = `${FORECAST_URL}?latitude=${lat}&longitude=${lon}&current=temperature_2m`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather fetch failed: ${res.status}`);
  const data = await res.json();
  return data?.current?.temperature_2m ?? null;
}

// Average overnight (~23:00–07:00) temperature for a past date — used to back-fill nights.
export async function fetchTempForDate(lat, lon, isoDate) {
  const url =
    `${ARCHIVE_URL}?latitude=${lat}&longitude=${lon}` +
    `&start_date=${isoDate}&end_date=${isoDate}&hourly=temperature_2m&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Archive fetch failed: ${res.status}`);
  const data = await res.json();
  const times = data?.hourly?.time || [];
  const temps = data?.hourly?.temperature_2m || [];
  const overnight = [];
  for (let i = 0; i < times.length; i++) {
    const hour = +times[i].slice(11, 13);
    if (hour >= 23 || hour <= 7) overnight.push(temps[i]);
  }
  const sample = overnight.filter((t) => t != null);
  if (!sample.length) return null;
  return Math.round((sample.reduce((a, b) => a + b, 0) / sample.length) * 10) / 10;
}

// Resolve a bedroom temp for an entry, honoring settings.location.
// Returns { bedroomTempC, tempSource } or null on failure (caller leaves field empty).
export async function resolveBedroomTemp(entry, settings) {
  const loc = settings.location || {};
  if (loc.mode === 'manual') {
    return loc.manualTempC != null
      ? { bedroomTempC: loc.manualTempC, tempSource: 'manual' }
      : null;
  }
  // geo mode: use saved coords, else ask the browser.
  let lat = loc.lat, lon = loc.lon;
  if (lat == null || lon == null) {
    const c = await getCoords();
    lat = c.lat; lon = c.lon;
  }
  // Today's date -> current temp; past dates -> archive average.
  const today = new Date().toISOString().slice(0, 10);
  const temp =
    entry.date >= today
      ? await fetchCurrentTemp(lat, lon)
      : await fetchTempForDate(lat, lon, entry.date);
  if (temp == null) return null;
  return { bedroomTempC: temp, tempSource: 'open-meteo', lat, lon };
}
