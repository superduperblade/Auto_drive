// rng.js — deterministic seeded random utilities (pure, testable)

/** xmur3 string hash → 32-bit seed. */
export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32 PRNG. Returns a function producing floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Create a named RNG from a seed + salt (for independent streams). */
export function makeRng(seed, salt = '') {
  return mulberry32(hashString(String(seed) + ':' + salt));
}

/** Uniform float in [min, max). */
export function range(rng, min, max) {
  return min + rng() * (max - min);
}

/** Uniform int in [min, max] inclusive. */
export function intRange(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Pick an element from an array. */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/** Weighted pick: items = [{key, w}] → key. Weights need not normalize. */
export function weightedPick(rng, items) {
  let total = 0;
  for (const it of items) total += it.w;
  let r = rng() * total;
  for (const it of items) {
    r -= it.w;
    if (r <= 0) return it.key;
  }
  return items[items.length - 1].key;
}

/** Gaussian-ish float in ~[-1, 1] (sum of 3 uniforms, centered). */
export function gauss(rng) {
  return (rng() + rng() + rng()) / 1.5 - 1;
}
