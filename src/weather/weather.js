// weather.js — weather state machine + in-game clock (pure, testable)

import { makeRng } from '../lib/rng.js';
import { clamp, clamp01, lerp } from '../lib/math.js';

export const TIME_OF_DAY_HOURS = { auto: null, dusk: 20, night: 23, morning: 6.5 };

/**
 * Create the weather + clock system.
 * config: resolved TripConfig (weather concrete, timeRate, timeOfDay, seed).
 */
export function createWeather(config) {
  const rng = makeRng(config.seed, 'weather');
  const isPrecip = (w) => w === 'rain' || w === 'snow';

  // Clock: system time, or fixed start advancing at timeRate.
  let clockHours;
  if (config.timeRate === 'system') {
    const now = new Date();
    clockHours = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  } else {
    const start = config.timeOfDay !== 'auto' ? TIME_OF_DAY_HOURS[config.timeOfDay] : 23;
    clockHours = start;
  }
  const rate0 = config.timeRate === 'system' ? 1 : Number(config.timeRate);
  let rate = rate0; // mutable: live-apply via setTimeRate

  const state = {
    weather: config.weather,
    target: config.weather,
    intensity: 0,          // precipitation intensity 0..1 (rain/snow)
    fog: config.weather === 'fog' ? 1 : 0,
    cloudCover: { clear: 0, overcast: 0.85, rain: 1, snow: 0.9, fog: 0.6 }[config.weather] ?? 0,
    clockHours,
    thunder: 0,            // thunder flash/decay envelope
    nextThunder: 0,
    wetness: 0,            // road wetness 0..1 (ramps in with rain, decays after)
  };
  if (isPrecip(state.weather)) state.intensity = 0; // ramps in

  function update(dt) {
    // Clock advance.
    clockHours = (clockHours + (dt / 3600) * rate) % 24;
    state.clockHours = clockHours;

    // Ease intensity toward target.
    const targetIntensity = isPrecip(state.target) ? 1 : 0;
    state.intensity = lerp(state.intensity, targetIntensity, 1 - Math.exp(-dt / 20));
    state.fog = lerp(state.fog, state.target === 'fog' ? 1 : 0, 1 - Math.exp(-dt / 20));
    const targetCloud = { clear: 0, overcast: 0.85, rain: 1, snow: 0.9, fog: 0.6 }[state.target] ?? 0;
    state.cloudCover = lerp(state.cloudCover, targetCloud, 1 - Math.exp(-dt / 25));

    // Thunder: rare, gentle, only in heavier rain.
    if (state.weather === 'rain' && state.intensity > 0.4) {
      state.nextThunder -= dt;
      if (state.nextThunder <= 0) {
        state.thunder = 1;
        state.nextThunder = 60 + rng() * 180; // 1–4 min
      }
    }
    state.thunder = Math.max(0, state.thunder - dt / 12); // ~12 s decay

    // Road wetness: rises while it's raining/snowing, decays slowly after.
    const wetTarget = state.intensity; // driven by precipitation intensity
    const wetRate = wetTarget > state.wetness ? 0.05 : 0.004; // slow to dry
    state.wetness = lerp(state.wetness, wetTarget, 1 - Math.exp(-dt * wetRate));

    return state;
  }

  /** Switch weather live (options menu). */
  function setWeather(w) {
    state.target = w;
    if (w === 'rain' || w === 'snow' || w === 'clear' || w === 'overcast' || w === 'fog') {
      state.weather = w;
    }
  }

  /** Set the in-game clock to a time-of-day preset (options menu, live). */
  function setTimeOfDay(preset) {
    if (preset && preset !== 'auto' && TIME_OF_DAY_HOURS[preset] != null) {
      clockHours = TIME_OF_DAY_HOURS[preset];
      state.clockHours = clockHours;
    }
  }

  /** Live-apply the clock rate: 'system' (1×) or a number (1/2/5/10). */
  function setTimeRate(v) {
    rate = v === 'system' ? 1 : Number(v);
    if (!Number.isFinite(rate) || rate <= 0) rate = rate0;
  }

  return { state, update, setWeather, setTimeOfDay, setTimeRate };
}

/**
 * Lighting parameters for a clock hour + weather (pure).
 * Returns { sunDir {x,y,z}, sunIntensity, ambient, night, dusk, fogDensity }.
 */
export function lightingAt(hour, weather) {
  // Sun: rises 6, sets 21 (roughly, for a northern-summer feel).
  const t = (hour - 6) / 15; // 0 at 6:00, 1 at 21:00
  const sunUp = t > 0 && t < 1;
  const elev = sunUp ? Math.sin(t * Math.PI) : 0;
  const azim = lerp(0, Math.PI, t);
  const sunDir = {
    x: Math.cos(azim) * Math.cos(elev * 1.2),
    y: Math.max(0.02, Math.sin(elev * 1.2)),
    z: -Math.sin(azim) * Math.cos(elev * 1.2),
  };

  const night = hour < 5.5 || hour > 21.5;
  const dusk = (hour >= 19 && hour < 21.5) || (hour >= 5 && hour < 7);

  let sunIntensity = sunUp ? 0.9 * elev : 0;
  let ambient = night ? 0.16 : 0.45 + 0.3 * (sunUp ? elev : 0.3);
  if (weather === 'overcast') { sunIntensity *= 0.35; ambient *= 0.8; }
  if (weather === 'rain') { sunIntensity *= 0.2; ambient *= 0.6; }
  if (weather === 'snow') { sunIntensity *= 0.45; ambient *= 0.85; }
  if (weather === 'fog') { sunIntensity *= 0.3; ambient *= 0.7; }

  const fogDensity =
    weather === 'fog' ? 0.0035 :
    weather === 'rain' ? 0.0012 :
    weather === 'snow' ? 0.0018 :
    weather === 'overcast' ? 0.0004 : 0.00015;

  return { sunDir, sunIntensity, ambient, night, dusk, fogDensity };
}

/** Wiper period (seconds) from rain intensity: 6 s (light) → 2 s (heavy). */
export function wiperPeriod(intensity) {
  return lerp(6, 2, clamp01(intensity));
}

/** Droplet transient rate (per second) from rain intensity: 20 → 80. */
export function dropletRate(intensity) {
  return lerp(20, 80, clamp01(intensity));
}
