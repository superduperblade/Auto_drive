// pedestrians.js — zebra crossings, walking, yield logic (pure, testable)

import { makeRng, range } from '../lib/rng.js';
import { clamp } from '../lib/math.js';

const WALK_SPEED = [1.2, 1.5]; // m/s
const YIELD_DIST = 10; // m — yield if a pedestrian is within this of our lane

/**
 * Create the pedestrian system.
 * opts: { city, spline, stopForPedestrians, seed }
 */
export function createPedestrians(opts) {
  const { city, spline, seed } = opts;
  let stopForPedestrians = opts.stopForPedestrians;
  const rng = makeRng(seed, 'peds');
  const L = spline.length;

  // Zebra crossings: grid crossings near the route.
  const crossings = [];
  for (const c of city.crossings) {
    const near = spline.nearest(c.x, c.z);
    if (near.dist > 60) continue; // only where a street meets the route
    const zone = city.zoneAt(c.x, c.z);
    if (zone.name === 'outskirts') continue;
    const p = spline.posAt(near.d);
    const t = spline.tangentAt(near.d);
    // crosswalk direction: perpendicular to the route
    const cx = -t.z, cz = t.x;
    crossings.push({
      x: p.x, z: p.z,
      dir: { x: cx, z: cz },
      d: near.d,
      zone: zone.name,
    });
  }

  const people = [];
  let nextId = 1;

  function spawnAtCrossing(cr) {
    // start on one side of the road
    const side = rng() < 0.5 ? 1 : -1;
    const half = 9; // road half-width + sidewalk
    const x = cr.x + cr.dir.x * side * half + range(rng, -3, 3);
    const z = cr.z + cr.dir.z * side * half + range(rng, -3, 3);
    people.push({
      id: nextId++,
      crossing: cr,
      x, z,
      state: 'waiting',
      waitT: range(rng, 2, 12),
      progress: side > 0 ? 0 : 1, // 0..1 across
      side,
      speed: range(rng, WALK_SPEED[0], WALK_SPEED[1]),
      jaywalker: false,
    });
  }

  function update(dt, playerPos) {
    // Spawn: keep a few people near active crossings in dense zones.
    const active = crossings.filter((cr) => {
      const d = Math.hypot(cr.x - playerPos.x, cr.z - playerPos.z);
      return d < 300 && (cr.zone === 'core' || cr.zone === 'urban');
    });
    const targetPeople = active.length * (active[0]?.zone === 'core' ? 3 : 1);
    if (people.length < targetPeople && active.length && rng() < dt * 0.15) {
      spawnAtCrossing(active[Math.floor(rng() * active.length)]);
    }

    for (let i = people.length - 1; i >= 0; i--) {
      const p = people[i];
      if (p.state === 'waiting') {
        p.waitT -= dt;
        if (p.waitT <= 0) p.state = 'crossing';
      } else if (p.state === 'crossing') {
        const from = p.side > 0 ? 9 : -9;
        const to = p.side > 0 ? -9 : 9;
        const total = Math.abs(to - from);
        p.progress = clamp(p.progress + (p.speed * dt) / total, 0, 1);
        const along = from + (to - from) * p.progress;
        p.x = p.crossing.x + p.crossing.dir.x * along;
        p.z = p.crossing.z + p.crossing.dir.z * along;
        if (p.progress >= 1) p.state = 'done';
      }
      // remove when done or far away
      const d = Math.hypot(p.x - playerPos.x, p.z - playerPos.z);
      if (p.state === 'done' || d > 400) people.splice(i, 1);
    }

    return people;
  }

  /**
   * Does the driver need to yield?
   * playerS: arc length; lanePos: {x, z} of our lane center.
   * Returns { yield: bool, person } | { yield: false }.
   */
  function yieldRequest(lanePos) {
    if (!stopForPedestrians) return { yield: false };
    for (const p of people) {
      if (p.state !== 'crossing') continue;
      const d = Math.hypot(p.x - lanePos.x, p.z - lanePos.z);
      if (d < YIELD_DIST) return { yield: true, person: p };
    }
    return { yield: false };
  }

  /** Live-apply the stop-for-pedestrians option. */
  function setYield(on) {
    stopForPedestrians = !!on;
  }

  return { people, crossings, update, yieldRequest, setYield, YIELD_DIST };
}
