import { describe, it, expect } from 'vitest';
import { SEAT_DEFS, seatInfo, dbToGain } from '../src/audio/seats.js';
import { SEATS } from '../src/config.js';
import { buildCarShell, pointInBox } from '../src/audio/raytracer.js';

describe('seats (4-seat camera + ear positions)', () => {
  it('defines exactly the 4 planned seats', () => {
    expect(SEATS).toEqual(['driver', 'front-passenger', 'rear-left', 'rear-right']);
    expect(Object.keys(SEAT_DEFS).sort()).toEqual(SEATS.slice().sort());
  });

  it('every seat ear is inside the cabin box', () => {
    const shell = buildCarShell();
    for (const seat of SEATS) {
      const info = seatInfo(seat);
      expect(pointInBox(info.ear, shell.cabinBox)).toBe(true);
    }
  });

  it('every seat has a finite camera + ear position and a primary window', () => {
    const windows = new Set(['left', 'right', 'front', 'rear-left', 'rear-right', 'rear']);
    for (const seat of SEATS) {
      const { ear, cam, primaryWindow } = seatInfo(seat);
      for (const p of [ear, cam]) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
        expect(Number.isFinite(p.z)).toBe(true);
      }
      // camera is roughly at ear height, slightly forward/above
      expect(cam.y).toBeGreaterThan(1);
      expect(windows.has(primaryWindow)).toBe(true);
    }
  });

  it('front seats are ahead of rear seats (x ordering)', () => {
    const front = seatInfo('driver').ear.x;
    const rear = seatInfo('rear-left').ear.x;
    expect(front).toBeGreaterThan(rear);
  });

  it('driver sits on the left, front-passenger on the right (z ordering)', () => {
    expect(seatInfo('driver').ear.z).toBeGreaterThan(seatInfo('front-passenger').ear.z);
  });

  it('rear seats are quieter for the engine (negative dB offset)', () => {
    expect(seatInfo('driver').offsets.engine).toBeGreaterThan(0);
    expect(seatInfo('rear-left').offsets.engine).toBeLessThan(0);
    expect(seatInfo('rear-right').offsets.engine).toBeLessThan(0);
  });

  it('dbToGain converts dB to linear correctly', () => {
    expect(dbToGain(0)).toBeCloseTo(1);
    expect(dbToGain(-6)).toBeCloseTo(0.5, 2);
    expect(dbToGain(6)).toBeCloseTo(2, 2);
  });
});
