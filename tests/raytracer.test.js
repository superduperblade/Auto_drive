import { describe, it, expect } from 'vitest';
import {
  rayBox, rayTriangle, rayGround, pointInBox,
  buildCarShell, buildGeometry, solveSource, attenuation, dopplerRate, v,
} from '../src/audio/raytracer.js';

const carPose = { pos: { x: 0, y: 0, z: 0 }, heading: 0 };

describe('ray primitives', () => {
  const box = { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } };

  it('rayBox hits a box in front', () => {
    const t = rayBox({ x: -5, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, box);
    expect(t).toBeCloseTo(4, 3);
  });

  it('rayBox misses to the side', () => {
    expect(rayBox({ x: -5, y: 5, z: 0 }, { x: 1, y: 0, z: 0 }, box)).toBeNull();
  });

  it('rayBox misses when behind', () => {
    // starts behind the box and travels away from it
    expect(rayBox({ x: -5, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }, box)).toBeNull();
  });

  it('rayTriangle hits a front-facing triangle', () => {
    const tri = { a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 }, c: { x: 0, y: 1, z: 0 } };
    const t = rayTriangle({ x: 0.25, y: 0.25, z: 5 }, { x: 0, y: 0, z: -1 }, tri);
    expect(t).toBeCloseTo(5, 3);
  });

  it('rayTriangle misses a back-facing triangle', () => {
    const tri = { a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 }, c: { x: 0, y: 1, z: 0 } };
    expect(rayTriangle({ x: 0.25, y: 0.25, z: -5 }, { x: 0, y: 0, z: 1 }, tri)).toBeNull();
  });

  it('rayGround returns distance to y=0', () => {
    expect(rayGround({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 })).toBeCloseTo(10);
  });

  it('pointInBox works', () => {
    expect(pointInBox({ x: 0, y: 1, z: 0 }, box)).toBe(true);
    expect(pointInBox({ x: 2, y: 1, z: 0 }, box)).toBe(false);
  });
});

describe('car shell', () => {
  const shell = buildCarShell();

  it('has 6 glass windows', () => {
    expect(shell.windows.length).toBe(6);
    for (const w of shell.windows) expect(w.kind).toBe('glass');
  });

  it('has body triangles and a floor', () => {
    expect(shell.body.length).toBeGreaterThanOrEqual(12);
    expect(shell.floor.a.y).toBeGreaterThan(0.2);
  });

  it('cabin box contains the driver ear position', () => {
    const ear = { x: 0.85, y: 1.12, z: 0.35 };
    expect(pointInBox(ear, shell.cabinBox)).toBe(true);
  });
});

describe('geometry + solver', () => {
  function geomWith(buildings = []) {
    return buildGeometry(carPose, [], buildings);
  }

  it('ear inside the car is detected', () => {
    const geom = geomWith();
    expect(geom.inside({ x: 0.85, y: 1.12, z: 0.35 })).toBe(true);
    expect(geom.inside({ x: 5, y: 1.12, z: 0 })).toBe(false);
  });

  it('interior source (engine) is unoccluded', () => {
    const geom = geomWith();
    const r = solveSource(
      { pos: { x: 0.5, y: 0.7, z: 0 }, vel: null, interior: true },
      { x: 0.85, y: 1.12, z: 0.35 },
      geom,
    );
    expect(r.via).toBe('interior');
    expect(r.g1).toBeGreaterThan(0.9);
    expect(r.occluded).toBe(false);
  });

  it('exterior source next to the left window is heard through that window', () => {
    const geom = geomWith();
    // car faces +x; left is +z. Source 3 m to the left.
    const r = solveSource(
      { pos: { x: 0.5, y: 1.2, z: 4 }, vel: null, interior: false },
      { x: 0.85, y: 1.12, z: 0.35 },
      geom,
    );
    expect(r.via).toBe('window');
    // window center is the spatialization point
    expect(Math.abs(r.pos.z - 0.9)).toBeLessThan(0.2);
  });

  it('source behind the car uses the rear window', () => {
    const geom = geomWith();
    const r = solveSource(
      { pos: { x: -5, y: 1.2, z: 0 }, vel: null, interior: false },
      { x: 0.85, y: 1.12, z: 0.35 },
      geom,
    );
    expect(r.via).toBe('window');
    expect(r.pos.x).toBeLessThan(0);
  });

  it('body-leak bed is present and low-passed for exterior sources', () => {
    const geom = geomWith();
    const r = solveSource(
      { pos: { x: 0.5, y: 1.2, z: 10 }, vel: null, interior: false },
      { x: 0.85, y: 1.12, z: 0.35 },
      geom,
    );
    expect(r.g2).toBeGreaterThan(0);
    expect(r.c2).toBe(800);
  });

  it('building between source and listener muffles the sound', () => {
    const building = { x: 0, z: 20, w: 30, d: 10, h: 20 };
    const geom = geomWith([building]);
    const clear = solveSource(
      { pos: { x: 0, y: 2, z: 40 }, vel: null, interior: false },
      { x: 0.85, y: 1.12, z: 0.35 },
      buildGeometry(carPose, [], []),
    );
    const blocked = solveSource(
      { pos: { x: 0, y: 2, z: 40 }, vel: null, interior: false },
      { x: 0.85, y: 1.12, z: 0.35 },
      geom,
    );
    expect(blocked.occluded).toBe(true);
    expect(blocked.g1).toBeLessThan(clear.g1 * 0.6);
    expect(blocked.c1).toBeLessThanOrEqual(1200);
  });

  it('vehicle box occludes nearby sources', () => {
    const geom = buildGeometry(carPose, [
      { pos: { x: 0, z: 8 }, heading: 0, length: 13, width: 2.5, height: 3.8 },
    ], []);
    const r = solveSource(
      { pos: { x: 0, y: 2, z: 20 }, vel: null, interior: false },
      { x: 0.85, y: 1.12, z: 0.35 },
      geom,
    );
    // lorry between us and the source: window path blocked → body-leak dominates
    expect(r.via).toBe('body-leak');
  });

  it('freecam outside the car hears direct sound', () => {
    const geom = geomWith();
    const r = solveSource(
      { pos: { x: 10, y: 2, z: 0 }, vel: null, interior: false },
      { x: 15, y: 2, z: 0 },
      geom,
    );
    expect(r.via).toBe('direct');
    expect(r.g2).toBe(0);
  });

  it('horn-left-is-left / horn-right-is-right (spatialization)', () => {
    const geom = geomWith();
    const ear = { x: 0.85, y: 1.12, z: 0.35 };
    // A horn 4 m to the left (+z) spatializes to the left side (z > 0).
    const left = solveSource(
      { pos: { x: 0.5, y: 1.2, z: 4 }, vel: null, interior: false },
      ear, geom,
    );
    // A horn 4 m to the right (-z) spatializes to the right side (z < 0).
    const right = solveSource(
      { pos: { x: 0.5, y: 1.2, z: -4 }, vel: null, interior: false },
      ear, geom,
    );
    expect(left.pos.z).toBeGreaterThan(0);
    expect(right.pos.z).toBeLessThan(0);
    // Both are heard through a window (not occluded).
    expect(left.via).toBe('window');
    expect(right.via).toBe('window');
  });

  it('attenuation decreases with distance', () => {
    expect(attenuation(1)).toBeGreaterThan(attenuation(10));
    expect(attenuation(10)).toBeGreaterThan(attenuation(100));
  });

  it('doppler: approaching source → rate > 1, receding → < 1', () => {
    const approaching = dopplerRate({ x: 0, y: 0, z: -30 }, { x: 0, y: 0, z: 0 }, { x: 0, z: 10 }, { x: 0, z: 0 });
    const receding = dopplerRate({ x: 0, y: 0, z: 30 }, { x: 0, y: 0, z: 0 }, { x: 0, z: 10 }, { x: 0, z: 0 });
    expect(approaching).toBeGreaterThan(1);
    expect(receding).toBeLessThan(1);
  });

  it('raytrace=off skips window paths', () => {
    const geom = geomWith();
    const r = solveSource(
      { pos: { x: 0.5, y: 1.2, z: 4 }, vel: null, interior: false },
      { x: 0.85, y: 1.12, z: 0.35 },
      geom,
      { raytrace: 'off' },
    );
    expect(r.via).not.toBe('window');
  });

  it('solving is fast enough for 30 sources @ 20 Hz', () => {
    const geom = geomWith(
      Array.from({ length: 300 }, (_, i) => ({
        x: (i % 10) * 100 - 500, z: Math.floor(i / 10) * 100 - 1500,
        w: 20, d: 20, h: 30,
      })),
    );
    const ear = { x: 0.85, y: 1.12, z: 0.35 };
    const t0 = performance.now();
    for (let i = 0; i < 30; i++) {
      solveSource(
        { pos: { x: Math.cos(i) * 50, y: 1.5, z: Math.sin(i) * 50 }, vel: { x: 1, y: 0, z: 0 }, interior: false },
        ear, geom,
      );
    }
    const ms = performance.now() - t0;
    // 30 sources must solve in well under 50 ms (20 Hz tick = 50 ms budget)
    expect(ms).toBeLessThan(50);
  });
});
