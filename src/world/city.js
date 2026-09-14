// city.js — procedural city generation from a route (pure, testable)
//
// Generates an axis-aligned street grid around the route corridor, classifies
// density zones (core/urban/arterial/outskirts), and places instanced building
// boxes with seeded randomness. Everything is deterministic per seed.

import { makeRng, range, intRange, weightedPick } from '../lib/rng.js';
import { clamp } from '../lib/math.js';

export const ZONES = {
  core: { limit: 30, density: 1.0 },
  urban: { limit: 50, density: 0.65 },
  arterial: { limit: 70, density: 0.45 },
  outskirts: { limit: 90, density: 0.25 },
};

export const CORRIDOR_RADIUS = 1500; // m — only generate near the route
const GRID_SPACING = 150; // m between street centerlines
const MAJOR_EVERY = 3; // every 3rd grid line is an arterial
const LOCAL_ROAD_W = 8;
const MAJOR_ROAD_W = 14;

/** Facade palette (muted). Each entry: [r,g,b] 0..1. */
export const FACADE_PALETTE = [
  [0.42, 0.40, 0.38], [0.55, 0.52, 0.48], [0.36, 0.38, 0.42], [0.50, 0.45, 0.40],
  [0.45, 0.47, 0.44], [0.60, 0.55, 0.48], [0.38, 0.42, 0.46], [0.52, 0.48, 0.52],
];

/**
 * Generate a city.
 * routePts: [{x, z}] world-space route polyline.
 * opts: { seed, destination: {x, z} }
 */
export function generateCity(routePts, opts) {
  const { seed, destination } = opts;
  const rng = makeRng(seed, 'city');
  const downtown = destination || routePts[routePts.length - 1];

  // Corridor bounds: expand route bbox by CORRIDOR_RADIUS.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of routePts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  minX -= CORRIDOR_RADIUS; maxX += CORRIDOR_RADIUS;
  minZ -= CORRIDOR_RADIUS; maxZ += CORRIDOR_RADIUS;

  // Snap to grid.
  const gx0 = Math.floor(minX / GRID_SPACING);
  const gx1 = Math.ceil(maxX / GRID_SPACING);
  const gz0 = Math.floor(minZ / GRID_SPACING);
  const gz1 = Math.ceil(maxZ / GRID_SPACING);

  const lines = [];
  for (let i = gx0; i <= gx1; i++) {
    lines.push({ axis: 'x', at: i * GRID_SPACING, major: i % MAJOR_EVERY === 0 });
  }
  for (let j = gz0; j <= gz1; j++) {
    lines.push({ axis: 'z', at: j * GRID_SPACING, major: j % MAJOR_EVERY === 0 });
  }

  const inCorridor = (x, z) => {
    // coarse: distance to route polyline < CORRIDOR_RADIUS
    let best = Infinity;
    for (let i = 0; i < routePts.length - 1; i++) {
      const a = routePts[i], b = routePts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1e-9;
      let t = ((x - a.x) * dx + (z - a.z) * dz) / len2;
      t = clamp(t, 0, 1);
      const px = a.x + dx * t, pz = a.z + dz * t;
      const d = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d < best) best = d;
    }
    return best < CORRIDOR_RADIUS * CORRIDOR_RADIUS;
  };

  // Zone classification.
  function zoneAt(x, z) {
    const d = Math.hypot(x - downtown.x, z - downtown.z);
    let name;
    if (d < 600) name = 'core';
    else if (d < 1400) name = 'urban';
    else name = 'outskirts';
    // Arterial override: near a major grid line within 2 km of downtown.
    if (d < 2000) {
      const nearMajor =
        (Math.abs(((x % GRID_SPACING) + GRID_SPACING) % GRID_SPACING - 0) < MAJOR_ROAD_W / 2 &&
          Math.floor(x / GRID_SPACING) % MAJOR_EVERY === 0) ||
        (Math.abs(((z % GRID_SPACING) + GRID_SPACING) % GRID_SPACING - 0) < MAJOR_ROAD_W / 2 &&
          Math.floor(z / GRID_SPACING) % MAJOR_EVERY === 0);
      if (nearMajor && name !== 'core') name = 'arterial';
    }
    return { name, ...ZONES[name] };
  }

  // Buildings: fill blocks between grid lines.
  const buildings = [];
  const blockW = GRID_SPACING;
  for (let i = gx0; i < gx1; i++) {
    for (let j = gz0; j < gz1; j++) {
      const cx = (i + 0.5) * blockW;
      const cz = (j + 0.5) * blockW;
      if (!inCorridor(cx, cz)) continue;
      const zone = zoneAt(cx, cz);
      // Sparse outskirts: skip some blocks entirely.
      if (zone.name === 'outskirts' && rng() < 0.55) continue;
      if (zone.name === 'arterial' && rng() < 0.3) continue;

      const margin = 10; // sidewalk
      const innerW = blockW - 2 * (zone.name === 'core' ? 7 : 10);
      const innerD = innerW;
      const n = zone.name === 'core' ? intRange(rng, 3, 6)
        : zone.name === 'urban' ? intRange(rng, 2, 4)
          : zone.name === 'arterial' ? intRange(rng, 1, 3)
            : intRange(rng, 1, 2);

      const maxH = zone.name === 'core' ? 80 : zone.name === 'urban' ? 45 : zone.name === 'arterial' ? 30 : 18;
      const minH = zone.name === 'core' ? 25 : zone.name === 'urban' ? 12 : zone.name === 'arterial' ? 8 : 5;

      for (let b = 0; b < n; b++) {
        const w = range(rng, 12, Math.min(30, innerW / 2));
        const d = range(rng, 12, Math.min(30, innerD / 2));
        const bx = cx + range(rng, -innerW / 2 + w / 2 + margin, innerW / 2 - w / 2 - margin);
        const bz = cz + range(rng, -innerD / 2 + d / 2 + margin, innerD / 2 - d / 2 - margin);
        // Height: taller near downtown with falloff + noise.
        const dd = Math.hypot(bx - downtown.x, bz - downtown.z);
        const falloff = clamp(1 - dd / 2200, 0.15, 1);
        const h = clamp(range(rng, minH, maxH) * (0.5 + 0.5 * falloff) + falloff * 15, 4, 80);
        buildings.push({
          x: bx, z: bz, w, d, h,
          bucket: intRange(rng, 0, FACADE_PALETTE.length - 1),
          winVariant: intRange(rng, 0, 7),
          roof: rng() < 0.3 ? { w: range(rng, 1.5, 3), d: range(rng, 1.5, 3), h: range(rng, 0.8, 2) } : null,
        });
      }
    }
  }

  // Crossings: grid intersections inside the corridor (for zebra crossings).
  const crossings = [];
  for (const lx of lines.filter((l) => l.axis === 'x')) {
    for (const lz of lines.filter((l) => l.axis === 'z')) {
      if (!inCorridor(lx.at, lz.at)) continue;
      const zone = zoneAt(lx.at, lz.at);
      if (zone.name === 'outskirts' && rng() < 0.7) continue;
      // Crosswalk direction: pedestrians cross the major road if there is one,
      // otherwise a random axis. dir is the walking direction (perpendicular
      // to the road being crossed).
      let dir;
      if (lx.major && !lz.major) dir = { x: 0, z: 1 };
      else if (lz.major && !lx.major) dir = { x: 1, z: 0 };
      else dir = rng() < 0.5 ? { x: 0, z: 1 } : { x: 1, z: 0 };
      crossings.push({ x: lx.at, z: lz.at, major: lx.major || lz.major, dir });
    }
  }

  // Streetlights: along the route every ~40 m, alternating sides.
  const streetlights = [];
  let segStart = 0; // distance along route where the current segment begins
  let nextLight = 40; // next light position (route distance)
  let side = 1;
  for (let i = 0; i < routePts.length - 1; i++) {
    const a = routePts[i], b = routePts[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (segLen < 1e-9) continue;
    const px = -(b.z - a.z) / segLen, pz = (b.x - a.x) / segLen; // perpendicular
    while (nextLight < segStart + segLen) {
      const t = (nextLight - segStart) / segLen;
      const x = a.x + (b.x - a.x) * t + px * 6 * side;
      const z = a.z + (b.z - a.z) * t + pz * 6 * side;
      streetlights.push({ x, z, side });
      side = -side;
      nextLight += 40;
    }
    segStart += segLen;
  }

  return {
    downtown,
    grid: {
      spacing: GRID_SPACING,
      lines,
      bounds: { minX, maxX, minZ, maxZ },
      localRoadW: LOCAL_ROAD_W,
      majorRoadW: MAJOR_ROAD_W,
    },
    buildings,
    zoneAt,
    crossings,
    streetlights,
  };
}

/** Traffic spawn rate multiplier by zone + density setting. */
export function trafficMultiplier(zoneName, trafficLevel) {
  const zone = { core: 1.4, urban: 1.0, arterial: 0.8, outskirts: 0.5 }[zoneName] ?? 1;
  const level = { light: 0.5, normal: 1.0, heavy: 1.8 }[trafficLevel] ?? 1;
  return zone * level;
}
