import { describe, it, expect } from 'vitest';
import {
  defaultConfig, resolveConfig, sanitizeConfig,
  encodeConfig, decodeConfig, configFromUrl, randomDestination,
  SEATS, WEATHERS,
} from '../src/config.js';

describe('config', () => {
  it('defaults are sleep-friendly', () => {
    const c = defaultConfig();
    expect(c.seat).toBe('rear-left');
    expect(c.loop).toBe(true);
    expect(c.stopForPedestrians).toBe(true);
    expect(c.obeyLimits).toBe(true);
    expect(c.audio.limiter).toBe(true);
    expect(c.audio.mode).toBe('headphones');
    expect(c.visuals.hudGlow).toBe('dim');
  });

  it('resolveConfig resolves random weather/traffic deterministically', () => {
    const a = resolveConfig({ ...defaultConfig(), seed: 99, weather: 'random', traffic: 'random' });
    const b = resolveConfig({ ...defaultConfig(), seed: 99, weather: 'random', traffic: 'random' });
    expect(a.weather).toBe(b.weather);
    expect(a.traffic).toBe(b.traffic);
    expect(WEATHERS).toContain(a.weather);
  });

  it('sanitizeConfig rejects bad values', () => {
    const c = sanitizeConfig({ seat: 'roof', weather: 'monsoon', seed: 'x' });
    expect(SEATS).toContain(c.seat);
    expect(c.weather).toBe('random');
    expect(Number.isFinite(c.seed)).toBe(true);
  });

  it('URL encode/decode round-trips', () => {
    const c = defaultConfig();
    c.seed = 12345;
    c.seat = 'driver';
    c.weather = 'rain';
    c.traffic = 'heavy';
    c.timeRate = 5;
    const enc = encodeConfig(c);
    const dec = decodeConfig(enc);
    expect(dec.seed).toBe(12345);
    expect(dec.seat).toBe('driver');
    expect(dec.weather).toBe('rain');
    expect(dec.traffic).toBe('heavy');
    expect(dec.timeRate).toBe(5);
    expect(dec.origin).toEqual(c.origin);
    expect(dec.destination).toEqual(c.destination);
  });

  it('configFromUrl parses ?trip= links', () => {
    const c = defaultConfig();
    c.seed = 777;
    const url = `http://example.com/?trip=${encodeConfig(c)}`;
    const parsed = configFromUrl(url);
    expect(parsed.seed).toBe(777);
  });

  it('configFromUrl returns null for bad links', () => {
    expect(configFromUrl('http://example.com/')).toBeNull();
    expect(configFromUrl('http://example.com/?trip=!!!not-base64!!!')).toBeNull();
  });

  it('randomDestination stays near the origin', () => {
    const origin = { lat: 52.52, lng: 13.4 };
    for (let i = 0; i < 50; i++) {
      const d = randomDestination(origin, 42, i);
      const dLat = Math.abs(d.lat - origin.lat) * 110574;
      const dLng = Math.abs(d.lng - origin.lng) * 111320 * Math.cos((origin.lat * Math.PI) / 180);
      expect(Math.hypot(dLat, dLng)).toBeGreaterThan(1400);
      expect(Math.hypot(dLat, dLng)).toBeLessThan(5200);
    }
  });
});
