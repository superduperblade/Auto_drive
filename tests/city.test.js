import { describe, it, expect } from 'vitest';
import { generateCity, ZONES, trafficMultiplier } from '../src/world/city.js';

function makeRoute(len = 3000) {
  const pts = [];
  for (let i = 0; i <= 30; i++) pts.push({ x: (i / 30) * len, z: 0 });
  return pts;
}

describe('city', () => {
  const route = makeRoute();
  const city = generateCity(route, { seed: 42, destination: { x: 3000, z: 0 } });

  it('zone limits match the plan (30/50/70/90)', () => {
    expect(ZONES.core.limit).toBe(30);
    expect(ZONES.urban.limit).toBe(50);
    expect(ZONES.arterial.limit).toBe(70);
    expect(ZONES.outskirts.limit).toBe(90);
  });

  it('zoneAt is deterministic', () => {
    const city2 = generateCity(route, { seed: 42, destination: { x: 3000, z: 0 } });
    for (const [x, z] of [[0, 0], [1500, 100], [3000, 0], [500, -300]]) {
      expect(city.zoneAt(x, z).name).toBe(city2.zoneAt(x, z).name);
    }
  });

  it('downtown area is core (30 km/h)', () => {
    const z = city.zoneAt(3000, 0);
    expect(z.name).toBe('core');
    expect(z.limit).toBe(30);
  });

  it('far from downtown is outskirts (90 km/h)', () => {
    const z = city.zoneAt(0, 2500);
    expect(z.name).toBe('outskirts');
    expect(z.limit).toBe(90);
  });

  it('generates buildings within height bounds', () => {
    expect(city.buildings.length).toBeGreaterThan(50);
    for (const b of city.buildings) {
      expect(b.h).toBeGreaterThanOrEqual(4);
      expect(b.h).toBeLessThanOrEqual(80);
      expect(b.w).toBeGreaterThan(0);
      expect(b.d).toBeGreaterThan(0);
      expect(b.bucket).toBeGreaterThanOrEqual(0);
      expect(b.bucket).toBeLessThanOrEqual(7);
    }
  });

  it('buildings are deterministic per seed', () => {
    const c2 = generateCity(route, { seed: 42, destination: { x: 3000, z: 0 } });
    expect(c2.buildings.length).toBe(city.buildings.length);
    expect(c2.buildings[0]).toEqual(city.buildings[0]);
  });

  it('different seeds give different cities', () => {
    const c3 = generateCity(route, { seed: 43, destination: { x: 3000, z: 0 } });
    expect(c3.buildings.length).not.toBe(city.buildings.length);
  });

  it('has crossings and streetlights near the route', () => {
    expect(city.crossings.length).toBeGreaterThan(5);
    expect(city.streetlights.length).toBeGreaterThan(20);
  });

  it('taller buildings near downtown on average', () => {
    const near = city.buildings.filter((b) => Math.hypot(b.x - 3000, b.z) < 600);
    const far = city.buildings.filter((b) => Math.hypot(b.x - 3000, b.z) > 1500);
    if (near.length && far.length) {
      const avgNear = near.reduce((s, b) => s + b.h, 0) / near.length;
      const avgFar = far.reduce((s, b) => s + b.h, 0) / far.length;
      expect(avgNear).toBeGreaterThan(avgFar);
    }
  });

  it('trafficMultiplier scales by zone and level', () => {
    expect(trafficMultiplier('core', 'heavy')).toBeGreaterThan(trafficMultiplier('outskirts', 'light'));
    expect(trafficMultiplier('urban', 'normal')).toBe(1.0);
  });
});
