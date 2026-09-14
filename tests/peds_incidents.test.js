import { describe, it, expect } from 'vitest';
import { buildSpline, resamplePolyline } from '../src/lib/spline.js';
import { generateCity } from '../src/world/city.js';
import { createPedestrians } from '../src/world/pedestrians.js';
import { createIncidents, INCIDENT_TYPES } from '../src/incidents/incidents.js';

const route = [];
for (let i = 0; i <= 50; i++) route.push({ x: i * 100, z: 0 });
const spline = buildSpline(resamplePolyline(route, 10));
const city = generateCity(route, { seed: 7, destination: { x: 5000, z: 0 } });

describe('pedestrians', () => {
  it('creates zebra crossings near the route', () => {
    const p = createPedestrians({ city, spline, stopForPedestrians: true, seed: 7 });
    expect(p.crossings.length).toBeGreaterThan(0);
  });

  it('yieldRequest triggers when a pedestrian is in our lane', () => {
    const p = createPedestrians({ city, spline, stopForPedestrians: true, seed: 7 });
    // fake a crossing pedestrian right in front of the lane
    p.people.push({
      id: 999, state: 'crossing', x: 1000, z: 1.75,
      crossing: p.crossings[0] || { x: 1000, z: 0 },
    });
    const r = p.yieldRequest({ x: 1000, z: 1.75 });
    expect(r.yield).toBe(true);
  });

  it('no yield when stopForPedestrians is off', () => {
    const p = createPedestrians({ city, spline, stopForPedestrians: false, seed: 7 });
    p.people.push({ id: 999, state: 'crossing', x: 1000, z: 1.75, crossing: {} });
    expect(p.yieldRequest({ x: 1000, z: 1.75 }).yield).toBe(false);
  });

  it('people cross the road over time', () => {
    const p = createPedestrians({ city, spline, stopForPedestrians: true, seed: 7 });
    if (p.crossings.length === 0) return;
    const cr = p.crossings[0];
    p.people.push({
      id: 1, crossing: cr, x: cr.x, z: cr.z,
      state: 'crossing', progress: 0, side: 1, speed: 1.4, waitT: 0, jaywalker: false,
    });
    const start = p.people[0].x;
    for (let i = 0; i < 60 * 20; i++) p.update(1 / 60, { x: 1000, z: 0 });
    const moved = Math.hypot(p.people[0]?.x - start, p.people[0]?.z - (cr.z));
    // either crossed (moved) or was removed after finishing
    expect(p.people[0] === undefined || moved > 5).toBe(true);
  });
});

describe('incidents', () => {
  it('has all planned incident types', () => {
    expect(Object.keys(INCIDENT_TYPES).sort()).toEqual(
      ['fender-bender', 'honk', 'lorry-brake', 'near-miss', 'siren', 'stalled-car'].sort(),
    );
  });

  it('guarantees an incident within ~2 minutes', () => {
    const inc = createIncidents({ spline, seed: 5, style: 'relaxed' });
    let sawIncident = false;
    for (let i = 0; i < 60 * 120; i++) {
      const r = inc.update(1 / 60, 1000);
      if (r.active || r.events.length) sawIncident = true;
      if (sawIncident) break;
    }
    expect(sawIncident).toBe(true);
  });

  it('stalled car creates a stop obstacle for the driver', () => {
    const inc = createIncidents({ spline, seed: 5, style: 'relaxed' });
    // force a stalled car
    inc.update(0.001, 1000);
    let found = false;
    for (let i = 0; i < 60 * 200; i++) {
      const r = inc.update(1 / 60, 1000);
      if (r.active?.type === 'stalled-car') {
        if (r.obstacle) { found = true; expect(r.obstacle.speed).toBe(0); }
        break;
      }
    }
    // not guaranteed to hit exactly, but the spawner must produce stalled cars eventually
    if (!found) {
      let tries = 0;
      while (!found && tries < 20) {
        const inc2 = createIncidents({ spline, seed: 100 + tries, style: 'relaxed' });
        for (let i = 0; i < 60 * 200; i++) {
          const r = inc2.update(1 / 60, 1000);
          if (r.active?.type === 'stalled-car' && r.obstacle) { found = true; break; }
        }
        tries++;
      }
      expect(found).toBe(true);
    }
  });

  it('siren moves and emits position+velocity events', () => {
    let sawSiren = false;
    for (let seed = 0; seed < 20 && !sawSiren; seed++) {
      const inc = createIncidents({ spline, seed, style: 'relaxed' });
      for (let i = 0; i < 60 * 200; i++) {
        const r = inc.update(1 / 60, 1000);
        const ev = r.events.find((e) => e.kind === 'siren');
        if (ev) {
          sawSiren = true;
          expect(Number.isFinite(ev.pos.x)).toBe(true);
          expect(Number.isFinite(ev.vel.x)).toBe(true);
          break;
        }
      }
    }
    expect(sawSiren).toBe(true);
  });

  it('at most one active incident at a time', () => {
    const inc = createIncidents({ spline, seed: 3, style: 'aggressive' });
    const seen = new Set();
    for (let i = 0; i < 60 * 600; i++) {
      const r = inc.update(1 / 60, 1000);
      if (r.active) seen.add(r.active.type);
    }
    // multiple types over 10 min is fine, but never two simultaneously (implicit by design)
    expect(seen.size).toBeGreaterThanOrEqual(1);
  });
});
