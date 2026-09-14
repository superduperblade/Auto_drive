// math.js — small pure math helpers

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const SPEED_OF_SOUND = 343; // m/s

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function invLerp(a, b, v) {
  return a === b ? 0 : clamp01((v - a) / (b - a));
}

/** Frame-rate independent exponential damping toward target. */
export function damp(current, target, tau, dt) {
  if (tau <= 0) return target;
  return target + (current - target) * Math.exp(-dt / tau);
}

/** Shortest signed angle difference a→b in radians. */
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** km/h → m/s */
export function kmh(v) {
  return v / 3.6;
}

/** m/s → km/h */
export function toKmh(v) {
  return v * 3.6;
}
