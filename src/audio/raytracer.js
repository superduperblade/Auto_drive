// raytracer.js — per-source acoustic ray solving (pure, testable)
//
// Geometry: own-car shell (body triangles + 6 glass window quads + floor),
// other-vehicle AABBs, building AABBs, ground plane.
//
// Per source per audio tick (20 Hz):
//   1. direct ray source→ear (blocked by car shell / buildings / vehicles)
//   2. six window paths source→windowCenter→ear (glass transmission)
//   3. body-leak path (weak, heavy low-pass — the "everything is outside" bed)
//   4. building occlusion for distant sources
//   5. Doppler from radial velocity
// Result: { g1, c1, pos, delayMs, rate, g2, c2, via, occluded }

import { clamp, SPEED_OF_SOUND } from '../lib/math.js';

// ── vector helpers (plain objects) ─────────────────────────────────────────
export const v = {
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }),
  len: (a) => Math.hypot(a.x, a.y, a.z),
  norm: (a) => {
    const l = Math.hypot(a.x, a.y, a.z) || 1e-9;
    return { x: a.x / l, y: a.y / l, z: a.z / l };
  },
};

// ── primitives ──────────────────────────────────────────────────────────────

/** Ray vs AABB (slab method). Returns t (> eps) or null. */
export function rayBox(o, d, box, eps = 1e-4) {
  let tmin = eps, tmax = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    const inv = 1 / (d[axis] || 1e-12);
    let t1 = (box.min[axis] - o[axis]) * inv;
    let t2 = (box.max[axis] - o[axis]) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

/** Ray vs triangle (Möller–Trumbore, back-face culled). Returns t (> eps) or null. */
export function rayTriangle(o, d, tri, eps = 1e-4) {
  const e1 = v.sub(tri.b, tri.a);
  const e2 = v.sub(tri.c, tri.a);
  const h = v.cross(d, e2);
  const a = v.dot(e1, h);
  if (a > -1e-9 && a < 1e-9) return null; // parallel to the triangle plane
  const f = 1 / a;
  const s = v.sub(o, tri.a);
  const u = f * v.dot(s, h);
  if (u < -1e-6 || u > 1 + 1e-6) return null;
  const q = v.cross(s, e1);
  const w = f * v.dot(d, q);
  if (w < -1e-6 || u + w > 1 + 1e-6) return null;
  const t = f * v.dot(e2, q);
  if (t < eps) return null;
  // Back-face culling: only front-side hits count.
  const n = v.cross(e1, e2);
  if (v.dot(n, d) > 0) return null;
  return t;
}

/** Ray vs ground plane y=0. Returns t or null. */
export function rayGround(o, d, eps = 1e-4) {
  if (Math.abs(d.y) < 1e-9) return null;
  const t = -o.y / d.y;
  return t > eps ? t : null;
}

/** Point inside AABB. */
export function pointInBox(p, box) {
  return p.x >= box.min.x && p.x <= box.max.x &&
    p.y >= box.min.y && p.y <= box.max.y &&
    p.z >= box.min.z && p.z <= box.max.z;
}

// ── own-car shell geometry (car-local: +x forward, +y up, +z left) ─────────

export const CAR_DIMS = { L: 4.2, W: 1.8, sill: 1.0, roofH: 1.5, floorY: 0.3 };

/**
 * Build the car shell in local coordinates.
 * Layout: the body forms the lower band (y < sill) plus floor/roof/hood/trunk;
 * the 6 glass windows form the upper band (sill..roofH) on the car's surface,
 * so a ray from outside reaches the glass before any body panel.
 * Returns { body: [triangles], windows: [quads], floor: quad, cabinBox }.
 * Each quad: { a, b, c, d, center, normal, kind: 'glass' }.
 */
export function buildCarShell() {
  const { L, W, sill, roofH, floorY } = CAR_DIMS;
  const hx = L / 2, hz = W / 2;
  // cabin footprint along x (hood/trunk extend beyond it)
  const cx0 = -0.85, cx1 = 0.85;
  const cz = hz; // windows span the full width (no pillar gaps at the edges)

  const quads = [];
  const quad = (a, b, c, d, kind) => {
    const center = v.scale(v.add(v.add(a, b), v.add(c, d)), 0.25);
    const normal = v.norm(v.cross(v.sub(b, a), v.sub(d, a)));
    quads.push({ a, b, c, d, center, normal, kind });
  };

  // Body panels (lower band + floor + roof + hood + trunk).
  const bodyQuads = [
    // floor
    [{ x: -hx, y: floorY, z: -hz }, { x: hx, y: floorY, z: -hz }, { x: hx, y: floorY, z: hz }, { x: -hx, y: floorY, z: hz }],
    // left side (lower)
    [{ x: -hx, y: 0.25, z: hz }, { x: hx, y: 0.25, z: hz }, { x: hx, y: sill, z: hz }, { x: -hx, y: sill, z: hz }],
    // right side (lower)
    [{ x: -hx, y: 0.25, z: -hz }, { x: hx, y: 0.25, z: -hz }, { x: hx, y: sill, z: -hz }, { x: -hx, y: sill, z: -hz }],
    // front face (lower)
    [{ x: hx, y: 0.25, z: -hz }, { x: hx, y: 0.25, z: hz }, { x: hx, y: sill, z: hz }, { x: hx, y: sill, z: -hz }],
    // rear face (lower)
    [{ x: -hx, y: 0.25, z: -hz }, { x: -hx, y: 0.25, z: hz }, { x: -hx, y: sill, z: hz }, { x: -hx, y: sill, z: -hz }],
    // hood (top of the engine bay)
    [{ x: cx1, y: sill, z: -hz }, { x: hx, y: sill, z: -hz }, { x: hx, y: sill, z: hz }, { x: cx1, y: sill, z: hz }],
    // trunk (top of the boot)
    [{ x: -hx, y: sill, z: -hz }, { x: cx0, y: sill, z: -hz }, { x: cx0, y: sill, z: hz }, { x: -hx, y: sill, z: hz }],
    // cabin roof
    [{ x: cx0, y: roofH, z: -cz }, { x: cx1, y: roofH, z: -cz }, { x: cx1, y: roofH, z: cz }, { x: cx0, y: roofH, z: cz }],
  ];

  // Glass windows (6): windshield, rear window, 4 side windows.
  const glassQuads = [
    // windshield (sloped)
    [{ x: cx1, y: sill, z: -cz }, { x: cx1, y: sill, z: cz }, { x: cx1 + 0.25, y: roofH, z: cz - 0.05 }, { x: cx1 + 0.25, y: roofH, z: -cz + 0.05 }],
    // rear window (sloped)
    [{ x: cx0, y: sill, z: cz }, { x: cx0, y: sill, z: -cz }, { x: cx0 - 0.25, y: roofH, z: -cz + 0.05 }, { x: cx0 - 0.25, y: roofH, z: cz - 0.05 }],
    // left front
    [{ x: 0.05, y: sill, z: hz }, { x: cx1, y: sill, z: hz }, { x: cx1, y: roofH, z: hz }, { x: 0.05, y: roofH, z: hz }],
    // left rear
    [{ x: cx0, y: sill, z: hz }, { x: -0.05, y: sill, z: hz }, { x: -0.05, y: roofH, z: hz }, { x: cx0, y: roofH, z: hz }],
    // right front
    [{ x: 0.05, y: sill, z: -hz }, { x: cx1, y: sill, z: -hz }, { x: cx1, y: roofH, z: -hz }, { x: 0.05, y: roofH, z: -hz }],
    // right rear
    [{ x: cx0, y: sill, z: -hz }, { x: -0.05, y: sill, z: -hz }, { x: -0.05, y: roofH, z: -hz }, { x: cx0, y: roofH, z: -hz }],
  ];

  for (const pts of glassQuads) quad(pts[0], pts[1], pts[2], pts[3], 'glass');

  const body = [];
  for (const q of bodyQuads) {
    const [a, b, c, d] = q;
    // Both windings per triangle so occlusion is robust to face orientation
    // (rayTriangle is back-face culled; exactly one winding of each pair hits).
    body.push({ a, b, c, kind: 'body' });
    body.push({ a, b: c, c: d, kind: 'body' });
    body.push({ a, b: c, c: b, kind: 'body' });
    body.push({ a, b: d, c: c, kind: 'body' });
  }

  const floor = {
    a: { x: -hx, y: floorY, z: -hz }, b: { x: hx, y: floorY, z: -hz },
    c: { x: hx, y: floorY, z: hz }, d: { x: -hx, y: floorY, z: hz },
  };

  const cabinBox = {
    min: { x: cx0 - 0.05, y: floorY, z: -cz },
    max: { x: cx1 + 0.05, y: roofH, z: cz },
  };

  return { body, windows: quads, floor, cabinBox };
}

// ── world-space geometry assembly ──────────────────────────────────────────

/** Transform a car-local point to world given pose {pos, heading}. */
export function localToWorld(p, pose) {
  const c = Math.cos(pose.heading), s = Math.sin(pose.heading);
  // forward = (cos h, 0, sin h); left = (-sin h, 0, cos h)
  return {
    x: pose.pos.x + p.x * c - p.z * s,
    y: pose.pos.y + p.y,
    z: pose.pos.z + p.x * s + p.z * c,
  };
}

/**
 * Build the world-space raytracing geometry.
 * carPose: { pos: {x,y,z}, heading }
 * vehicles: [{ pos: {x,z}, heading, length, width, height }]
 * buildings: [{ x, z, w, d, h }] (already corridor-limited)
 * Returns { carTris, carWindows, carBox, cabinBox, boxes, inside(earPos) }.
 */
export function buildGeometry(carPose, vehicles, buildings) {
  const shell = buildCarShell();
  const carTris = shell.body.map((t) => ({
    a: localToWorld(t.a, carPose),
    b: localToWorld(t.b, carPose),
    c: localToWorld(t.c, carPose),
    kind: 'body',
  }));
  const carWindows = shell.windows.map((q) => {
    const c = Math.cos(carPose.heading), s = Math.sin(carPose.heading);
    const n = q.normal;
    return {
      a: localToWorld(q.a, carPose), b: localToWorld(q.b, carPose),
      c: localToWorld(q.c, carPose), d: localToWorld(q.d, carPose),
      center: localToWorld(q.center, carPose),
      normal: { x: n.x * c - n.z * s, y: n.y, z: n.x * s + n.z * c },
      kind: 'glass',
    };
  });

  const carBox = {
    min: { x: carPose.pos.x - 2.6, y: 0.2, z: carPose.pos.z - 2.6 },
    max: { x: carPose.pos.x + 2.6, y: 1.6, z: carPose.pos.z + 2.6 },
  };
  const cabinBox = {
    min: localToWorld(shell.cabinBox.min, carPose),
    max: localToWorld(shell.cabinBox.max, carPose),
  };

  const boxes = [];
  for (const veh of vehicles) {
    const hl = veh.length / 2 + 0.1, hw = veh.width / 2 + 0.1;
    boxes.push({
      min: { x: veh.pos.x - hl, y: 0.3, z: veh.pos.z - hw },
      max: { x: veh.pos.x + hl, y: veh.height, z: veh.pos.z + hw },
      kind: 'vehicle',
    });
  }
  for (const b of buildings) {
    boxes.push({
      min: { x: b.x - b.w / 2, y: 0, z: b.z - b.d / 2 },
      max: { x: b.x + b.w / 2, y: b.h, z: b.z + b.d / 2 },
      kind: 'building',
    });
  }

  const inside = (p) => pointInBox(p, cabinBox);

  return { carTris, carWindows, carBox, cabinBox, boxes, inside };
}

// ── the solver ──────────────────────────────────────────────────────────────

const GLASS_TRANSMISSION = 0.5;
const GLASS_CUTOFF = 4500; // Hz — glass absorbs highs
const BODY_LEAK_GAIN = 0.08;
const BODY_LEAK_CUTOFF = 800;
const OCCLUDE_GAIN = 0.3;
const OCCLUDE_CUTOFF = 1200;

/** Inverse-distance attenuation with a gentle rolloff (refDistance 1 m). */
export function attenuation(d) {
  return 1 / (1 + 0.15 * d + 0.008 * d * d);
}

/**
 * Solve one source for the listener.
 * src: { pos, vel (world, m/s), interior }
 * ear: { x, y, z }
 * geom: from buildGeometry()
 * opts: { raytrace: 'full'|'windows'|'off', earInside: bool }
 * Returns { g1, c1, pos, delayMs, rate, g2, c2, via, occluded }.
 */
export function solveSource(src, ear, geom, opts = {}) {
  const raytrace = opts.raytrace ?? 'full';
  const earInside = opts.earInside ?? geom.inside(ear);
  const d = v.len(v.sub(ear, src.pos));
  const baseAtten = attenuation(d);
  const baseDelay = (d / SPEED_OF_SOUND) * 1000;

  // Doppler from radial velocity (source approaching → pitch up).
  let rate = 1;
  if (src.vel) {
    const rHat = v.norm(v.sub(ear, src.pos));
    const vRel = v.sub(src.vel, opts.listenerVel || { x: 0, y: 0, z: 0 });
    rate = clamp(1 + v.dot(vRel, rHat) / SPEED_OF_SOUND, 0.8, 1.2);
  }

  // Interior source: full path, no occlusion.
  if (src.interior) {
    return {
      g1: baseAtten, c1: 18000, pos: src.pos, delayMs: 0, rate,
      g2: 0, c2: 800, via: 'interior', occluded: false,
    };
  }

  const hitCar = (o, dir) => {
    let t = Infinity;
    for (const tri of geom.carTris) {
      const hit = rayTriangle(o, dir, tri);
      if (hit && hit < t) t = hit;
    }
    return t;
  };
  const hitBoxes = (o, dir, kinds) => {
    let t = Infinity;
    for (const box of geom.boxes) {
      if (kinds && !kinds.includes(box.kind)) continue;
      const hit = rayBox(o, dir, box);
      if (hit && hit < t) t = hit;
    }
    return t;
  };

  let best = null;
  let foundPrimary = false;
  const consider = (gain, cutoff, pos, delayMs, via, primary) => {
    if (gain > 0 && (!best || gain > best.g1)) {
      best = { g1: gain, c1: cutoff, pos, delayMs, rate, g2: 0, c2: BODY_LEAK_CUTOFF, via, occluded: false };
      if (primary) foundPrimary = true;
    }
  };

  if (earInside) {
    // Ear inside the cabin: sound from outside must enter through a window
    // (glass transmission) or be occluded by the body. There is no "direct"
    // path — a ray from outside always crosses the shell.

    // 1) Window paths.
    if (raytrace !== 'off') {
      for (const win of geom.carWindows) {
        const d1 = v.len(v.sub(win.center, src.pos));
        const d2 = v.len(v.sub(ear, win.center));
        if (d1 < 0.3) continue; // source at the window
        const dir1 = v.norm(v.sub(win.center, src.pos));
        // segment 1: source → window center must be clear of body + boxes
        const tCar1 = hitCar(src.pos, dir1);
        const tBox1 = hitBoxes(src.pos, dir1, ['vehicle', 'building']);
        if (Math.min(tCar1, tBox1) < d1 - 0.15) continue;
        // segment 2: window center → ear must be clear of body
        const dir2 = v.norm(v.sub(ear, win.center));
        const tCar2 = hitCar(win.center, dir2);
        if (tCar2 < d2 - 0.1) continue;
        // angle factor: sound through a window is strongest when the source
        // is roughly in front of that window.
        const n = win.normal;
        const facing = Math.abs(v.dot(dir1, n));
        const angleFactor = 0.35 + 0.65 * facing;
        const gain = attenuation(d1 + d2) * GLASS_TRANSMISSION * angleFactor;
        const cutoff = Math.min(16000, GLASS_CUTOFF);
        consider(gain, cutoff, win.center, ((d1 + d2) / SPEED_OF_SOUND) * 1000, 'window', true);
      }
    }

    // 2) Body-leak bed (fallback when no window path is open).
    const leakPos = (() => {
      // approximate: point on the car body nearest the source direction
      const dir = v.norm(v.sub(src.pos, ear));
      return v.add(ear, v.scale(dir, 1.0));
    })();
    consider(baseAtten * BODY_LEAK_GAIN, BODY_LEAK_CUTOFF, leakPos, baseDelay, 'body-leak', false);
  } else {
    // Ear outside the car (freecam): direct path with building/vehicle occlusion.
    const dir = v.norm(v.sub(ear, src.pos));
    const tBox = hitBoxes(src.pos, dir, ['building', 'vehicle']);
    if (tBox > d - 1e-3) {
      consider(baseAtten, 16000, src.pos, baseDelay, 'direct', true);
    } else {
      // Occluded by a building/vehicle: muffled direct.
      consider(baseAtten * OCCLUDE_GAIN, OCCLUDE_CUTOFF, src.pos, baseDelay + 8, 'direct', false);
    }
  }

  if (!best) {
    // Fully occluded: still a faint muffled bed.
    best = { g1: baseAtten * BODY_LEAK_GAIN * 0.5, c1: BODY_LEAK_CUTOFF, pos: src.pos, delayMs: baseDelay, rate, g2: 0, c2: BODY_LEAK_CUTOFF, via: 'occluded', occluded: true };
  }

  // No primary (window/direct) path found → the sound is occluded.
  if (!foundPrimary) best.occluded = true;

  // 3) Building occlusion for distant sources (sirens/horns around corners).
  if (d > 60) {
    const dir = v.norm(v.sub(ear, src.pos));
    const tB = hitBoxes(src.pos, dir, ['building']);
    if (tB < d - 1e-3) {
      best.g1 *= OCCLUDE_GAIN;
      best.c1 = Math.min(best.c1, OCCLUDE_CUTOFF);
      best.delayMs += 8;
      best.occluded = true;
    }
  }

  // 4) Second tap: body-leak bed for the cabin (exterior sources only),
  //    only when the primary path is not already the body-leak/occluded bed.
  if (earInside && !src.interior && best.via !== 'body-leak' && best.via !== 'occluded') {
    best.g2 = baseAtten * BODY_LEAK_GAIN;
    best.c2 = BODY_LEAK_CUTOFF;
  }

  return best;
}

/**
 * Doppler playback rate from radial velocity (convenience for tests/audio).
 * from/to: source/listener positions; vSource/vListener: world velocities.
 */
export function dopplerRate(from, to, vSource, vListener) {
  const p = (o) => ({ x: o?.x || 0, y: o?.y || 0, z: o?.z || 0 });
  const rHat = v.norm(v.sub(p(to), p(from)));
  const vRel = v.sub(p(vSource), p(vListener));
  return clamp(1 + v.dot(vRel, rHat) / SPEED_OF_SOUND, 0.8, 1.2);
}
