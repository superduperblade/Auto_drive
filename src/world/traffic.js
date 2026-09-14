// traffic.js — traffic simulation: spawners, car-following, lane changes (pure, testable)
//
// Lanes on the route road: two per direction. Vehicles are stateless in
// rendering — this module only produces { x, z, heading, speed, type } per tick.

import { makeRng, weightedPick } from '../lib/rng.js';
import { clamp, kmh } from '../lib/math.js';
import { trafficMultiplier } from './city.js';

export const VEHICLE_TYPES = {
  car: { length: 4.5, width: 1.8, height: 1.4, headway: 1.2, accel: 2.2, brake: 4.5, laneChange: 0.05 },
  van: { length: 6.0, width: 2.1, height: 2.4, headway: 1.6, accel: 1.8, brake: 4.0, laneChange: 0.02 },
  lorry: { length: 13.0, width: 2.5, height: 3.8, headway: 2.2, accel: 1.0, brake: 3.0, laneChange: 0 },
};

export const SPAWN_AHEAD = 380; // m ahead of player
export const KILL_BEHIND = 450; // m behind player

/**
 * Create the traffic system.
 * opts: { spline, city, trafficLevel, seed }
 */
export function createTraffic(opts) {
  const { spline, city, seed } = opts;
  let trafficLevel = opts.trafficLevel;
  const rng = makeRng(seed, 'traffic');
  const L = spline.length;

  // Lanes: dir +1 = our direction, -1 = oncoming; idx 0 = inner, 1 = outer.
  const lanes = [
    { id: 'f0', dir: 1, idx: 0, offset: 1.75 },
    { id: 'f1', dir: 1, idx: 1, offset: 3.75 },
    { id: 'b0', dir: -1, idx: 0, offset: 1.75 },
    { id: 'b1', dir: -1, idx: 1, offset: 3.75 },
  ];
  const laneById = Object.fromEntries(lanes.map((l) => [l.id, l]));

  let nextId = 1;
  const vehicles = [];

  function lanePose(lane, s) {
    const arc = clamp(lane.dir > 0 ? s : L - s, 0, L);
    const p = spline.posAt(arc);
    const t = spline.tangentAt(arc);
    // right of the lane's travel direction
    const rx = -t.z * lane.dir, rz = t.x * lane.dir;
    return {
      x: p.x + rx * lane.offset,
      z: p.z + rz * lane.offset,
      heading: Math.atan2(t.z * lane.dir, t.x * lane.dir),
    };
  }

  function typeForZone(zoneName) {
    if (zoneName === 'core') {
      return weightedPick(rng, [
        { key: 'car', w: 75 }, { key: 'van', w: 20 }, { key: 'lorry', w: 5 },
      ]);
    }
    return weightedPick(rng, [
      { key: 'car', w: 70 }, { key: 'van', w: 15 }, { key: 'lorry', w: 15 },
    ]);
  }

  function spawn(lane, s) {
    const arc = clamp(lane.dir > 0 ? s : L - s, 0, L);
    const p = spline.posAt(arc);
    const zone = city.zoneAt(p.x, p.z);
    const type = typeForZone(zone.name);
    const spec = VEHICLE_TYPES[type];
    const limit = kmh(zone.limit);
    const speedFactor = type === 'car' ? 1 : type === 'van' ? 0.9 : 0.8;
    const speed = clamp(limit * speedFactor * (0.9 + rng() * 0.2), 5, 40);
    const pose = lanePose(lane, s);
    return {
      id: nextId++,
      type, lane: lane.id, s, speed,
      length: spec.length, width: spec.width, height: spec.height,
      x: pose.x, z: pose.z, heading: pose.heading,
      changeT: 0, changeFrom: null,
    };
  }

  /** Target vehicle count in the ±400 m window, scaled by zone + level. */
  function targetCount(playerS) {
    const p = spline.posAt(clamp(playerS, 0, L));
    const zone = city.zoneAt(p.x, p.z);
    return Math.round(11 * trafficMultiplier(zone.name, trafficLevel));
  }

  function update(dt, playerS) {
    const perLane = Math.max(2, Math.round(targetCount(playerS) / lanes.length));

    // Spawn to maintain density: always ahead of the player in arc space
    // (oncoming vehicles then drive toward the player).
    for (const lane of lanes) {
      const inLane = vehicles.filter((veh) => veh.lane === lane.id);
      for (let i = inLane.length; i < perLane; i++) {
        const spawnArc = playerS + SPAWN_AHEAD - rng() * 120 + i * 25;
        if (spawnArc < 0 || spawnArc > L) continue;
        const near = inLane.some((veh) => {
          const vehArc = lane.dir > 0 ? veh.s : L - veh.s;
          return Math.abs(vehArc - spawnArc) < 25;
        });
        if (!near) {
          const s = lane.dir > 0 ? spawnArc : L - spawnArc;
          const v = spawn(lane, s);
          vehicles.push(v);
          inLane.push(v);
        }
      }
    }

    // Car-following per lane.
    for (const lane of lanes) {
      const inLane = vehicles.filter((veh) => veh.lane === lane.id);
      inLane.sort((a, b) => (lane.dir > 0 ? a.s - b.s : b.s - a.s));
      for (let i = 0; i < inLane.length; i++) {
        const veh = inLane[i];
        const spec = VEHICLE_TYPES[veh.type];
        const zone = city.zoneAt(veh.x, veh.z);
        const limit = kmh(zone.limit) * (veh.type === 'car' ? 1 : veh.type === 'van' ? 0.9 : 0.8);

        let target = limit;
        // The vehicle ahead in the direction of travel is the next index in the
        // sorted list (ascending s for dir>0, descending s for dir<0 → both put
        // the leader at the highest index).
        const ahead = inLane[i + 1];
        let gap = 0;
        if (ahead) {
          gap = (lane.dir > 0 ? ahead.s - veh.s : veh.s - ahead.s) - ahead.length / 2 - veh.length / 2;
          const desired = 4 + veh.length + ahead.speed * spec.headway;
          if (gap < desired) {
            // kinematically safe: never exceed the speed we could stop from
            // within the remaining gap (keeps gaps positive under braking)
            const stopSpeed = Math.sqrt(2 * spec.brake * Math.max(0, gap - 1));
            target = Math.min(target, Math.max(0, Math.min(ahead.speed * 0.95, stopSpeed)));
            if (gap < 2.5) target = 0;
          }
        }
        if (target > veh.speed) veh.speed = Math.min(target, veh.speed + spec.accel * dt);
        else veh.speed = Math.max(target, veh.speed - spec.brake * dt);

        // Hard safety cap: never exceed the speed we can stop within the gap.
        // Guarantees no collisions even for transient (spawn/lane-change) cases.
        if (ahead && gap < 40) {
          const maxSafe = Math.sqrt(2 * spec.brake * Math.max(0, gap - 0.5));
          if (veh.speed > maxSafe) veh.speed = maxSafe;
        }

        // Lane change: try to move to the other lane of the same direction.
        if (spec.laneChange > 0 && veh.changeT <= 0 && rng() < spec.laneChange * dt) {
          const other = lanes.find((l) => l.dir === lane.dir && l.idx !== lane.idx);
          const otherVehs = vehicles.filter((v) => v.lane === other.id);
          const myArc = lane.dir > 0 ? veh.s : L - veh.s;
          const clearAhead = !otherVehs.some((v) => {
            const a = lane.dir > 0 ? v.s : L - v.s;
            return a > myArc && a - myArc < 25 + v.length;
          });
          const clearBehind = !otherVehs.some((v) => {
            const a = lane.dir > 0 ? v.s : L - v.s;
            return a < myArc && myArc - a < 25 + v.length;
          });
          if (clearAhead && clearBehind) {
            veh.changeT = 2.0;
            veh.changeFrom = lane.id;
            veh.lane = other.id;
          }
        }

        veh.s += lane.dir * veh.speed * dt;
        const curLane = laneById[veh.lane];
        const pose = lanePose(curLane, veh.s);
        veh.x = pose.x;
        veh.z = pose.z;
        veh.heading = pose.heading;
      }
    }

    // Recycle vehicles far from the player.
    for (let i = vehicles.length - 1; i >= 0; i--) {
      const veh = vehicles[i];
      const lane = laneById[veh.lane];
      const arc = lane.dir > 0 ? veh.s : L - veh.s;
      if (Math.abs(arc - playerS) > KILL_BEHIND) vehicles.splice(i, 1);
    }

    return vehicles;
  }

  /**
   * Nearest obstacle in a lane ahead of playerS.
   * Returns { dist, speed } | null.
   */
  function obstacleInLane(playerS, laneId = 'f0') {
    const lane = laneById[laneId];
    let best = null;
    for (const veh of vehicles) {
      if (veh.lane !== laneId) continue;
      const rel = lane.dir > 0 ? veh.s - playerS : playerS - veh.s;
      if (rel < 2) continue;
      if (!best || rel < best.dist) best = { dist: rel - veh.length / 2, speed: veh.speed };
    }
    return best;
  }

  /** Live-apply a new traffic density (light/normal/heavy). Takes effect as
   *  vehicles spawn/recycle. */
  function setLevel(level) {
    trafficLevel = level;
  }

  return { vehicles, lanes, update, obstacleInLane, setLevel, VEHICLE_TYPES };
}
