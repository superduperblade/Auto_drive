// spline.js — Catmull-Rom spline with arc-length parameterization (pure, testable)
//
// Given a polyline of 2D points (x, z) in world space, build a smooth curve
// sampled densely enough for constant-speed travel. Provides position,
// tangent, and curvature as functions of arc length.

import { clamp01 } from './math.js';

const SAMPLES_PER_SEG = 24;

/**
 * Build a spline from points [{x, z}, ...] (>= 2 points).
 * Returns { points, cum, length, posAt, tangentAt, curvatureAt, nearest }.
 */
export function buildSpline(pts) {
  if (pts.length < 2) throw new Error('spline needs >= 2 points');
  const n = pts.length;

  // Catmull-Rom control points (clamped at the ends).
  const P = (i) => pts[Math.max(0, Math.min(n - 1, i))];

  const samples = [];
  const cum = [0];
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const segSamples = i === n - 2 ? SAMPLES_PER_SEG + 1 : SAMPLES_PER_SEG;
    for (let s = 0; s < segSamples; s++) {
      const t = s / SAMPLES_PER_SEG;
      const t2 = t * t, t3 = t2 * t;
      // standard Catmull-Rom (uniform)
      const x =
        0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const z =
        0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
      samples.push({ x, z });
    }
  }
  // ensure the final point is included exactly
  const last = pts[n - 1];
  samples.push({ x: last.x, z: last.z });

  for (let i = 1; i < samples.length; i++) {
    const dx = samples[i].x - samples[i - 1].x;
    const dz = samples[i].z - samples[i - 1].z;
    cum.push(cum[i - 1] + Math.hypot(dx, dz));
  }
  const length = cum[cum.length - 1];

  function sampleAt(d) {
    d = Math.max(0, Math.min(length, d));
    // binary search for segment
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const segLen = cum[i] - cum[i - 1] || 1e-9;
    const t = (d - cum[i - 1]) / segLen;
    return {
      x: samples[i - 1].x + (samples[i].x - samples[i - 1].x) * t,
      z: samples[i - 1].z + (samples[i].z - samples[i - 1].z) * t,
      i,
    };
  }

  function posAt(d) {
    const s = sampleAt(d);
    return { x: s.x, z: s.z };
  }

  function tangentAt(d) {
    const e = Math.min(1, 2 / length);
    const a = sampleAt(Math.max(0, d - e));
    const b = sampleAt(Math.min(length, d + e));
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1e-9;
    return { x: dx / len, z: dz / len };
  }

  /** Curvature (1/m) at arc length d — central difference of heading. */
  function curvatureAt(d) {
    const e = Math.min(5, 0.05 * length);
    const t1 = tangentAt(Math.max(0, d - e));
    const t2 = tangentAt(Math.min(length, d + e));
    const a1 = Math.atan2(t1.z, t1.x);
    const a2 = Math.atan2(t2.z, t2.x);
    let da = a2 - a1;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    return Math.abs(da) / (2 * e);
  }

  /** Nearest arc length to a world point (coarse then refine). */
  function nearest(x, z) {
    let best = 0, bestD = Infinity;
    const step = Math.max(2, length / 400);
    for (let d = 0; d <= length; d += step) {
      const p = sampleAt(d);
      const dd = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (dd < bestD) { bestD = dd; best = d; }
    }
    // refine
    const lo = Math.max(0, best - step), hi = Math.min(length, best + step);
    for (let d = lo; d <= hi; d += 0.5) {
      const p = sampleAt(d);
      const dd = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (dd < bestD) { bestD = dd; best = d; }
    }
    return { d: best, dist: Math.sqrt(bestD) };
  }

  return { points: samples, cum, length, posAt, tangentAt, curvatureAt, nearest };
}

/** Resample a polyline to roughly every `step` meters. */
export function resamplePolyline(pts, step = 10) {
  if (pts.length < 2) return pts.slice();
  const out = [{ x: pts[0].x, z: pts[0].z }];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let prev = out[out.length - 1];
    let cur = pts[i];
    let segLen = Math.hypot(cur.x - prev.x, cur.z - prev.z);
    while (carry + segLen >= step) {
      const t = (step - carry) / segLen;
      const nx = prev.x + (cur.x - prev.x) * t;
      const nz = prev.z + (cur.z - prev.z) * t;
      out.push({ x: nx, z: nz });
      prev = { x: nx, z: nz };
      segLen = Math.hypot(cur.x - prev.x, cur.z - prev.z);
      carry = 0;
    }
    carry += segLen;
  }
  const lastPt = pts[pts.length - 1];
  if (Math.hypot(lastPt.x - out[out.length - 1].x, lastPt.z - out[out.length - 1].z) > 1e-6) {
    out.push({ x: lastPt.x, z: lastPt.z });
  }
  return out;
}
