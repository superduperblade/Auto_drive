import { describe, it, expect } from 'vitest';
import { buildSpline, resamplePolyline } from '../src/lib/spline.js';

describe('spline', () => {
  const straight = resamplePolyline([{ x: 0, z: 0 }, { x: 1000, z: 0 }], 10);
  const spline = buildSpline(straight);

  it('length ≈ polyline length', () => {
    expect(spline.length).toBeCloseTo(1000, 0);
  });

  it('posAt(0) and posAt(length) are the endpoints', () => {
    const a = spline.posAt(0);
    const b = spline.posAt(spline.length);
    expect(a.x).toBeCloseTo(0, 1);
    expect(b.x).toBeCloseTo(1000, 1);
  });

  it('tangent is constant along a straight line', () => {
    for (const d of [0, 250, 500, 750, 999]) {
      const t = spline.tangentAt(d);
      expect(t.x).toBeCloseTo(1, 3);
      expect(t.z).toBeCloseTo(0, 3);
    }
  });

  it('curvature is ~0 on a straight line', () => {
    for (const d of [10, 500, 990]) {
      expect(spline.curvatureAt(d)).toBeLessThan(0.01);
    }
  });

  it('handles a curve', () => {
    // quarter circle radius 100
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * (Math.PI / 2);
      pts.push({ x: 100 - 100 * Math.cos(a), z: 100 * Math.sin(a) });
    }
    const s = buildSpline(resamplePolyline(pts, 5));
    expect(s.length).toBeCloseTo(100 * Math.PI / 2, -1);
    const k = s.curvatureAt(s.length / 2);
    expect(k).toBeGreaterThan(0.005);
    expect(k).toBeLessThan(0.02);
  });

  it('nearest finds the closest point', () => {
    const n = spline.nearest(500, 5);
    expect(n.d).toBeCloseTo(500, 0);
    expect(n.dist).toBeCloseTo(5, 0);
  });

  it('resample keeps step spacing', () => {
    const r = resamplePolyline([{ x: 0, z: 0 }, { x: 100, z: 0 }], 10);
    for (let i = 1; i < r.length - 1; i++) {
      const d = Math.hypot(r[i].x - r[i - 1].x, r[i].z - r[i - 1].z);
      expect(d).toBeLessThanOrEqual(10.01);
    }
  });
});
