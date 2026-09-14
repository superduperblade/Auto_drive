import { describe, it, expect } from 'vitest';
import { mulberry32, makeRng, range, weightedPick, hashString } from '../src/lib/rng.js';

describe('rng', () => {
  it('mulberry32 is deterministic', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('produces values in [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('makeRng gives independent streams per salt', () => {
    const a = makeRng(1, 'x');
    const b = makeRng(1, 'y');
    expect(a()).not.toBe(b());
  });

  it('range stays in bounds', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 500; i++) {
      const v = range(rng, 2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThan(5);
    }
  });

  it('weightedPick respects weights roughly', () => {
    const rng = mulberry32(11);
    const items = [{ key: 'a', w: 90 }, { key: 'b', w: 10 }];
    let aCount = 0;
    for (let i = 0; i < 1000; i++) if (weightedPick(rng, items) === 'a') aCount++;
    expect(aCount).toBeGreaterThan(800);
    expect(aCount).toBeLessThan(980);
  });

  it('hashString is stable and distinct', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});
