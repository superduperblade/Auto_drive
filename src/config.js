// config.js — TripConfig: single source of truth for a trip (pure, testable)

import { hashString, makeRng, weightedPick } from './lib/rng.js';
import { clamp } from './lib/math.js';

export const SEATS = ['driver', 'front-passenger', 'rear-left', 'rear-right'];
export const SEAT_LABELS = {
  driver: 'Driver',
  'front-passenger': 'Front passenger',
  'rear-left': 'Rear left',
  'rear-right': 'Rear right',
};
export const WEATHERS = ['clear', 'overcast', 'rain', 'snow', 'fog'];
export const WEATHER_WEIGHTS = [
  { key: 'clear', w: 20 },
  { key: 'overcast', w: 25 },
  { key: 'rain', w: 35 },
  { key: 'snow', w: 10 },
  { key: 'fog', w: 10 },
];
export const TRAFFIC_LEVELS = ['light', 'normal', 'heavy'];
export const TIME_OF_DAY = ['auto', 'dusk', 'night', 'morning'];
export const TIME_RATES = ['system', 1, 2, 5, 10];
export const CAR_TYPES = ['car', 'van'];

export function defaultConfig() {
  return {
    seed: 1,
    origin: { lat: 52.5219, lng: 13.4132 }, // Berlin Alexanderplatz
    destination: { lat: 52.5203, lng: 13.3777 }, // near Hauptbahnhof
    seat: 'rear-left',
    weather: 'random',
    traffic: 'random',
    timeOfDay: 'auto',
    timeRate: 'system',
    loop: true,
    // driving
    obeyLimits: true,
    stopForPedestrians: true,
    style: 'relaxed', // 'relaxed' | 'aggressive'
    // audio
    audio: {
      master: 0.7,
      rain: 1,
      traffic: 1,
      engine: 1,
      limiter: true,
      doppler: true,
      raytrace: 'full', // 'full' | 'windows' | 'off'
      seatbelt: true,
      cabin: true,
      mode: 'headphones', // 'headphones' | 'speakers'
    },
    // visuals
    visuals: {
      rainDetail: 'high', // 'high' | 'medium' | 'low'
      shadows: false,
      lightGlow: true,
      hudGlow: 'dim', // 'off' | 'dim' | 'neon'
      hudFade: 10, // seconds
      signs: true,
    },
    // misc
    misc: {
      carColor: '#7a4a3a',
      carType: 'car', // 'car' | 'van'
      music: 'off', // 'off' | 'very-quiet'
      language: 'en',
    },
  };
}

/** Resolve 'random' choices against the seed → concrete values. */
export function resolveConfig(cfg) {
  const rng = makeRng(cfg.seed, 'trip');
  return {
    ...cfg,
    weather: cfg.weather === 'random' ? weightedPick(rng, WEATHER_WEIGHTS) : cfg.weather,
    traffic: cfg.traffic === 'random' ? weightedPick(rng, [
      { key: 'light', w: 30 },
      { key: 'normal', w: 45 },
      { key: 'heavy', w: 25 },
    ]) : cfg.traffic,
    seed: cfg.seed >>> 0,
  };
}

/** Pick a random destination near the origin (for loop-forever mode). */
export function randomDestination(origin, seed, salt) {
  const rng = makeRng(seed, 'dest:' + salt);
  const dist = 1500 + rng() * 3500; // 1.5–5 km
  const ang = rng() * Math.PI * 2;
  const dLat = (Math.sin(ang) * dist) / 110574;
  const dLng = (Math.cos(ang) * dist) / (111320 * Math.cos((origin.lat * Math.PI) / 180));
  return { lat: origin.lat + dLat, lng: origin.lng + dLng };
}

// ── shareable URL encoding ────────────────────────────────────────────────
// Compact JSON → base64url. Only the fields that matter for reproducibility.

const URL_FIELDS = [
  'seed', 'origin', 'destination', 'seat', 'weather', 'traffic', 'timeOfDay',
  'timeRate', 'loop', 'obeyLimits', 'stopForPedestrians', 'style',
];

export function encodeConfig(cfg) {
  const obj = {};
  for (const f of URL_FIELDS) obj[f] = cfg[f];
  const json = JSON.stringify(obj);
  const b64 = btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64;
}

export function decodeConfig(b64) {
  const json = decodeURIComponent(escape(atob(b64.replace(/-/g, '+').replace(/_/g, '/'))));
  const obj = JSON.parse(json);
  const cfg = defaultConfig();
  for (const f of URL_FIELDS) {
    if (obj[f] !== undefined) {
      if (f === 'origin' || f === 'destination') {
        if (typeof obj[f]?.lat === 'number' && typeof obj[f]?.lng === 'number') cfg[f] = obj[f];
      } else if (f === 'timeRate') {
        if (typeof obj[f] === 'string' || typeof obj[f] === 'number') cfg[f] = obj[f];
      } else if (typeof obj[f] === typeof cfg[f]) {
        cfg[f] = obj[f];
      }
    }
  }
  cfg.seed = (cfg.seed >>> 0) || 1;
  return cfg;
}

/** Parse ?trip=... from a URL string; returns config or null. */
export function configFromUrl(url) {
  try {
    const u = new URL(url, 'http://localhost');
    const t = u.searchParams.get('trip');
    if (!t) return null;
    return decodeConfig(t);
  } catch {
    return null;
  }
}

/** Validate/sanitize a config object (from URL or defaults). */
export function sanitizeConfig(cfg) {
  const d = defaultConfig();
  const c = { ...d, ...cfg };
  c.audio = { ...d.audio, ...(cfg.audio || {}) };
  c.visuals = { ...d.visuals, ...(cfg.visuals || {}) };
  c.misc = { ...d.misc, ...(cfg.misc || {}) };
  c.seed = (Number.isFinite(c.seed) ? c.seed : 1) >>> 0;
  if (!SEATS.includes(c.seat)) c.seat = d.seat;
  if (c.weather !== 'random' && !WEATHERS.includes(c.weather)) c.weather = d.weather;
  if (c.traffic !== 'random' && !TRAFFIC_LEVELS.includes(c.traffic)) c.traffic = d.traffic;
  if (!TIME_OF_DAY.includes(c.timeOfDay)) c.timeOfDay = d.timeOfDay;
  if (!TIME_RATES.includes(c.timeRate)) c.timeRate = d.timeRate;
  if (!CAR_TYPES.includes(c.misc.carType)) c.misc.carType = d.misc.carType;
  c.audio.master = clamp(Number(c.audio.master) || 0, 0, 1);
  return c;
}

/** Stable hash of a config (for cache keys / dedupe). */
export function configHash(cfg) {
  return hashString(JSON.stringify({
    seed: cfg.seed, o: cfg.origin, d: cfg.destination, s: cfg.seat,
    w: cfg.weather, t: cfg.traffic, tod: cfg.timeOfDay, tr: cfg.timeRate,
  }));
}
