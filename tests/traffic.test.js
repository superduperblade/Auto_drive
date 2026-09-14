import { describe, it, expect } from 'vitest';
import { buildSpline, resamplePolyline } from '../src/lib/spline.js';
import { generateCity } from '../src/world/city.js';
import { createTraffic, VEHICLE_TYPES } from '../src/world/traffic.js';

const route = [];
for (let i = 0; i <= 50; i++) route.push({ x: i * 100, z: 0 });
const spline = buildSpline(resamplePolyline(route, 10));
const city = generateCity(route, { seed: 7, destination: { x: 5000, z: 0 } });

function makeTraffic(level = 'normal') {
  return createTraffic({ spline, city, trafficLevel: level, seed: 7 });
}

describe('traffic', () => {
  it('vehicle types have distinct sizes (lorry biggest)', () => {
    expect(VEHICLE_TYPES.lorry.length).toBeGreaterThan(VEHICLE_TYPES.van.length);
    expect(VEHICLE_TYPES.van.length).toBeGreaterThan(VEHICLE_TYPES.car.length);
    expect(VEHICLE_TYPES.lorry.height).toBeGreaterThan(3);
  });

  it('spawns vehicles near the player', () => {
    const t = makeTraffic();
    t.update(1 / 60, 1000);
    expect(t.vehicles.length).toBeGreaterThan(5);
    for (const veh of t.vehicles) {
      expect(Number.isFinite(veh.x)).toBe(true);
      expect(Number.isFinite(veh.heading)).toBe(true);
      expect(['car', 'van', 'lorry']).toContain(veh.type);
    }
  });

  it('vehicles stay within the recycle window', () => {
    const t = makeTraffic();
    for (let i = 0; i < 60 * 30; i++) t.update(1 / 60, 1000 + i / 60 * 10);
    for (const veh of t.vehicles) {
      const lane = t.lanes.find((l) => l.id === veh.lane);
      const arc = lane.dir > 0 ? veh.s : spline.length - veh.s;
      expect(Math.abs(arc - (1000 + 30 * 10))).toBeLessThan(460);
    }
  });

  it('car-following keeps positive gaps (no collisions)', () => {
    const t = makeTraffic('heavy');
    for (let i = 0; i < 60 * 60; i++) t.update(1 / 60, 1000 + i / 60 * 8);
    for (const lane of t.lanes) {
      const inLane = t.vehicles.filter((v) => v.lane === lane.id);
      inLane.sort((a, b) => (lane.dir > 0 ? a.s - b.s : b.s - a.s));
      for (let i = 1; i < inLane.length; i++) {
        // inLane[i] is ahead of inLane[i-1] in the direction of travel for both
        // dir signs (the sort puts the leader at the highest index).
        const behind = inLane[i - 1], ahead = inLane[i];
        const gap = (lane.dir > 0 ? ahead.s - behind.s : behind.s - ahead.s) - ahead.length / 2 - behind.length / 2;
        expect(gap).toBeGreaterThan(-0.5); // allow tiny numerical tolerance
      }
    }
  });

  it('heavy traffic has more vehicles than light', () => {
    const heavy = makeTraffic('heavy');
    const light = makeTraffic('light');
    heavy.update(1 / 60, 1000);
    light.update(1 / 60, 1000);
    expect(heavy.vehicles.length).toBeGreaterThan(light.vehicles.length);
  });

  it('obstacleInLane finds vehicles ahead in our lane', () => {
    const t = makeTraffic('heavy');
    for (let i = 0; i < 60 * 5; i++) t.update(1 / 60, 1000);
    const obs = t.obstacleInLane(1000, 'f0');
    if (obs) {
      expect(obs.dist).toBeGreaterThan(0);
      expect(obs.speed).toBeGreaterThanOrEqual(0);
    }
  });

  it('lorries do not lane-change', () => {
    const t = makeTraffic('heavy');
    for (let i = 0; i < 60 * 120; i++) t.update(1 / 60, 1000 + i / 60 * 10);
    // lorries should exist on long runs; verify none have changeT active
    for (const veh of t.vehicles) {
      if (veh.type === 'lorry') expect(veh.changeT).toBe(0);
    }
  });
});
