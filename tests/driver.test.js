import { describe, it, expect } from 'vitest';
import { buildSpline, resamplePolyline } from '../src/lib/spline.js';
import { createDriver, gearRpmForSpeed, engineFreqForRpm, GEAR_BANDS } from '../src/drive/driver.js';

const spline = buildSpline(resamplePolyline([{ x: 0, z: 0 }, { x: 5000, z: 0 }], 10));

describe('driver', () => {
  it('gear bands cover 0–160 km/h without gaps', () => {
    for (let v = 0; v <= 160; v += 1) {
      const { gear } = gearRpmForSpeed(v);
      expect(gear).toBeGreaterThanOrEqual(1);
      expect(gear).toBeLessThanOrEqual(6);
    }
  });

  it('rpm rises with speed and idles at 800', () => {
    expect(gearRpmForSpeed(0).rpm).toBe(800);
    const a = gearRpmForSpeed(20).rpm;
    const b = gearRpmForSpeed(40).rpm;
    expect(b).toBeGreaterThan(a);
  });

  it('engine freq is 2x revs/sec (4-stroke)', () => {
    expect(engineFreqForRpm(3000)).toBeCloseTo(100);
  });

  it('accelerates toward the zone limit and obeys it', () => {
    const d = createDriver({ spline, obeyLimits: true, style: 'relaxed' });
    for (let i = 0; i < 60 * 60; i++) d.update(1 / 60, { zoneLimitKmh: 50 });
    expect(d.state.speed * 3.6).toBeLessThanOrEqual(50.5);
    expect(d.state.speed * 3.6).toBeGreaterThan(45);
  });

  it('stops for a stationary obstacle ahead', () => {
    const d = createDriver({ spline, obeyLimits: true, style: 'relaxed' });
    // get up to speed
    for (let i = 0; i < 60 * 20; i++) d.update(1 / 60, { zoneLimitKmh: 50 });
    // obstacle 30 m ahead, fixed in the world
    const d0 = d.state.d;
    let stopped = false;
    for (let i = 0; i < 60 * 15; i++) {
      const dist = 30 - (d.state.d - d0);
      d.update(1 / 60, { zoneLimitKmh: 50, obstacle: { dist, speed: 0 } });
      if (d.state.speed < 0.2) { stopped = true; break; }
    }
    expect(stopped).toBe(true);
    // must stop before reaching the obstacle
    expect(d.state.d - d0).toBeLessThan(30);
  });

  it('arrives at the end of the route', () => {
    const d = createDriver({ spline, obeyLimits: true, style: 'aggressive' });
    for (let i = 0; i < 60 * 300 && !d.state.arrived; i++) {
      d.update(1 / 60, { zoneLimitKmh: 90 });
    }
    expect(d.state.arrived).toBe(true);
    expect(d.state.d).toBeCloseTo(spline.length, 0);
  });

  it('reset returns to start', () => {
    const d = createDriver({ spline, obeyLimits: true, style: 'relaxed' });
    for (let i = 0; i < 60 * 10; i++) d.update(1 / 60, { zoneLimitKmh: 50 });
    d.reset();
    expect(d.state.d).toBe(0);
    expect(d.state.arrived).toBe(false);
  });

  it('slows for sharp curvature', () => {
    // tight circle route
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      pts.push({ x: 60 * Math.cos(a), z: 60 * Math.sin(a) });
    }
    const circle = buildSpline(resamplePolyline(pts, 5));
    const d = createDriver({ spline: circle, obeyLimits: false, style: 'relaxed' });
    for (let i = 0; i < 60 * 30; i++) d.update(1 / 60, { zoneLimitKmh: 90 });
    // must be far below 90 km/h on a 60 m radius
    expect(d.state.speed * 3.6).toBeLessThan(40);
  });
});
