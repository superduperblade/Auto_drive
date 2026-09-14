// incidents.js — random incidents, sound-first (pure, testable)
//
// At most one active nearby at a time; guaranteed at least one within ~2 min.
// Each incident emits audio events and may affect the driver (brake/obstacle).

import { makeRng, weightedPick, range } from '../lib/rng.js';
import { clamp } from '../lib/math.js';

export const INCIDENT_TYPES = {
  honk: { w: 30, duration: 2 },
  siren: { w: 18, duration: 20 },
  'near-miss': { w: 15, duration: 4 },
  'stalled-car': { w: 15, duration: 14 },
  'fender-bender': { w: 12, duration: 25 },
  'lorry-brake': { w: 10, duration: 12 },
};

/**
 * Create the incident spawner.
 * opts: { spline, seed, style }
 */
export function createIncidents(opts) {
  const { spline, seed } = opts;
  // Driving style affects how often honks/incidents happen (aggressive = more).
  let style = opts.style === 'aggressive' ? { force: 60, prob: 1 / 50 } : { force: 110, prob: 1 / 80 };
  const rng = makeRng(seed, 'incidents');
  const L = spline.length;

  let active = null; // { type, t, data }
  let sinceLast = 0;
  const events = []; // audio events emitted this tick: { kind, pos, ... }

  function pickType() {
    const items = Object.entries(INCIDENT_TYPES).map(([key, def]) => ({ key, w: def.w }));
    return weightedPick(rng, items);
  }

  function start(type, playerS) {
    const data = {};
    switch (type) {
      case 'honk':
      case 'near-miss': {
        const side = rng() < 0.5 ? 1 : -1;
        const p = spline.posAt(clamp(playerS + range(rng, 5, 40), 0, L));
        const t = spline.tangentAt(clamp(playerS + 20, 0, L));
        data.pos = { x: p.x - t.z * side * 6, z: p.z + t.x * side * 6 };
        data.honkTone = rng() < 0.5 ? 'short' : 'double';
        break;
      }
      case 'siren': {
        // passes the player over its duration
        const dir = rng() < 0.5 ? 1 : -1;
        data.s = playerS - dir * 120;
        data.dir = dir;
        data.speed = 22; // ~80 km/h
        data.side = rng() < 0.5 ? 1 : -1;
        break;
      }
      case 'stalled-car': {
        data.s = playerS + range(rng, 80, 150);
        data.type = rng() < 0.7 ? 'car' : 'van';
        data.resolved = false;
        break;
      }
      case 'fender-bender': {
        data.s = playerS + range(rng, 100, 200);
        data.hazards = true;
        break;
      }
      case 'lorry-brake': {
        data.s = playerS + range(rng, 60, 120);
        data.braking = true;
        data.done = false;
        break;
      }
    }
    active = { type, t: 0, data };
    sinceLast = 0;
    return active;
  }

  function update(dt, playerS) {
    const out = [];
    sinceLast += dt;

    if (!active && (sinceLast > style.force || rng() < dt * style.prob)) {
      const type = pickType();
      start(type, playerS);
      if (type === 'honk' || type === 'near-miss') {
        out.push({ kind: 'honk', pos: active.data.pos, tone: active.data.honkTone, nearMiss: type === 'near-miss' });
      }
    }

    if (active) {
      active.t += dt;
      const def = INCIDENT_TYPES[active.type];

      switch (active.type) {
        case 'siren': {
          active.data.s += active.data.dir * active.data.speed * dt;
          const arc = clamp(active.data.s, 0, L);
          const p = spline.posAt(arc);
          const t = spline.tangentAt(arc);
          const side = active.data.side;
          out.push({
            kind: 'siren',
            pos: { x: p.x - t.z * side * 3.5, z: p.z + t.x * side * 3.5 },
            vel: { x: t.x * active.data.dir * active.data.speed, z: t.z * active.data.dir * active.data.speed },
          });
          break;
        }
        case 'stalled-car': {
          if (!active.data.resolved && active.t > 8) {
            active.data.resolved = true;
            out.push({ kind: 'stalled-resolved', pos: spline.posAt(clamp(active.data.s, 0, L)) });
          }
          break;
        }
        case 'lorry-brake': {
          if (active.data.braking && active.t > 2.5) {
            active.data.braking = false;
            active.data.done = true;
            out.push({ kind: 'lorry-brake', pos: spline.posAt(clamp(active.data.s, 0, L)) });
          }
          break;
        }
        case 'fender-bender': {
          if (active.t === dt) out.push({ kind: 'impact', pos: spline.posAt(clamp(active.data.s, 0, L)) });
          break;
        }
      }

      if (active.t >= def.duration) active = null;
    }

    // Driver effects.
    let braking = false;
    let obstacle = null;
    if (active) {
      switch (active.type) {
        case 'stalled-car': {
          if (!active.data.resolved) {
            const dist = active.data.s - playerS;
            if (dist > 0) obstacle = { dist, speed: 0 };
          }
          break;
        }
        case 'lorry-brake': {
          if (active.data.braking) {
            const dist = active.data.s - playerS;
            if (dist > 0 && dist < 80) {
              braking = true;
              obstacle = { dist, speed: 0 };
            }
          }
          break;
        }
        case 'fender-bender': {
          const dist = active.data.s - playerS;
          if (dist > 0 && dist < 60) obstacle = { dist, speed: 5 }; // slow around
          break;
        }
        case 'near-miss': {
          if (active.t < 1.5) braking = true;
          break;
        }
      }
    }

    return { events: out, braking, obstacle, active };
  }

  return {
    update,
    get active() { return active; },
    /** Live-apply the driving style (affects honk/incident frequency). */
    setStyle(s) {
      style = s === 'aggressive' ? { force: 60, prob: 1 / 50 } : { force: 110, prob: 1 / 80 };
    },
  };
}
