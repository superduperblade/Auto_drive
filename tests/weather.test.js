import { describe, it, expect } from 'vitest';
import { createWeather, lightingAt, wiperPeriod, dropletRate } from '../src/weather/weather.js';

function cfg(over = {}) {
  return {
    seed: 1, weather: 'rain', timeRate: 'system', timeOfDay: 'auto',
    ...over,
  };
}

describe('weather', () => {
  it('rain intensity ramps from 0 to 1', () => {
    const w = createWeather(cfg());
    expect(w.state.intensity).toBe(0);
    for (let i = 0; i < 60 * 90; i++) w.update(1 / 60);
    expect(w.state.intensity).toBeGreaterThan(0.9);
  });

  it('setWeather switches target live', () => {
    const w = createWeather(cfg());
    for (let i = 0; i < 60 * 60; i++) w.update(1 / 60);
    w.setWeather('clear');
    for (let i = 0; i < 60 * 60; i++) w.update(1 / 60);
    expect(w.state.intensity).toBeLessThan(0.1);
  });

  it('fog eases in and out', () => {
    const w = createWeather(cfg({ weather: 'fog' }));
    expect(w.state.fog).toBe(1);
    w.setWeather('clear');
    for (let i = 0; i < 60 * 60; i++) w.update(1 / 60);
    expect(w.state.fog).toBeLessThan(0.1);
  });

  it('clock advances at the configured rate', () => {
    const w = createWeather(cfg({ timeRate: 10, timeOfDay: 'night' }));
    const start = w.state.clockHours;
    w.update(3600); // 1 h real time at 10x = 10 h game time
    expect(w.state.clockHours).toBeCloseTo((start + 10) % 24, 1);
  });

  it('system clock tracks wall time', () => {
    const w = createWeather(cfg());
    const now = new Date();
    const expected = now.getHours() + now.getMinutes() / 60;
    expect(Math.abs(w.state.clockHours - expected) < 0.1 ||
      Math.abs(w.state.clockHours - expected + 24) < 0.1).toBe(true);
  });

  it('thunder only in heavy rain', () => {
    const w = createWeather(cfg({ weather: 'clear' }));
    for (let i = 0; i < 60 * 300; i++) w.update(1 / 60);
    expect(w.state.thunder).toBe(0);
  });

  it('lighting: night is dark, midday is bright', () => {
    const night = lightingAt(23, 'clear');
    const noon = lightingAt(13, 'clear');
    expect(night.night).toBe(true);
    expect(noon.night).toBe(false);
    expect(noon.sunIntensity).toBeGreaterThan(night.sunIntensity);
    expect(noon.ambient).toBeGreaterThan(night.ambient);
  });

  it('rain darkens the scene', () => {
    const clear = lightingAt(13, 'clear');
    const rain = lightingAt(13, 'rain');
    expect(rain.sunIntensity).toBeLessThan(clear.sunIntensity);
    expect(rain.fogDensity).toBeGreaterThan(clear.fogDensity);
  });

  it('wiper period and droplet rate scale with intensity', () => {
    expect(wiperPeriod(0)).toBeCloseTo(6);
    expect(wiperPeriod(1)).toBeCloseTo(2);
    expect(dropletRate(1)).toBeGreaterThan(dropletRate(0));
  });

  it('setTimeOfDay jumps the clock to the preset (live option)', () => {
    const w = createWeather(cfg({ timeRate: 1, timeOfDay: 'morning' }));
    // Advance a bit so the clock has moved off the morning start.
    for (let i = 0; i < 60 * 60; i++) w.update(1 / 60); // 1 h at 1x
    w.setTimeOfDay('night');
    expect(w.state.clockHours).toBeCloseTo(23, 5);
    w.setTimeOfDay('dusk');
    expect(w.state.clockHours).toBeCloseTo(20, 5);
    // 'auto' is a no-op (keeps the current clock).
    const before = w.state.clockHours;
    w.setTimeOfDay('auto');
    expect(w.state.clockHours).toBeCloseTo(before, 5);
  });

  it('road wetness rises with rain and decays after it stops', () => {
    const w = createWeather(cfg({ weather: 'rain' }));
    // Rain ramps in; wetness follows the intensity.
    for (let i = 0; i < 60 * 120; i++) w.update(1 / 60);
    expect(w.state.intensity).toBeGreaterThan(0.8);
    expect(w.state.wetness).toBeGreaterThan(0.5);
    // Switch to clear: intensity drops, wetness decays more slowly.
    w.setWeather('clear');
    for (let i = 0; i < 60 * 120; i++) w.update(1 / 60);
    expect(w.state.intensity).toBeLessThan(0.1);
    expect(w.state.wetness).toBeLessThan(w.state.wetness > 0 ? 0.9 : 1);
    // Keep drying: wetness approaches 0.
    for (let i = 0; i < 60 * 600; i++) w.update(1 / 60);
    expect(w.state.wetness).toBeLessThan(0.15);
  });
});
