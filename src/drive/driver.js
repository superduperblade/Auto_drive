// driver.js — autonomous driving model: spline following, speed/gear/RPM (pure, testable)

import { clamp, kmh, toKmh } from '../lib/math.js';

// 6-speed gearbox. Band edges in km/h.
export const GEAR_BANDS = [
  { gear: 1, min: 0, max: 15 },
  { gear: 2, min: 15, max: 30 },
  { gear: 3, min: 30, max: 50 },
  { gear: 4, min: 50, max: 75 },
  { gear: 5, min: 75, max: 100 },
  { gear: 6, min: 100, max: 160 },
];
export const IDLE_RPM = 800;
export const REDLINE_RPM = 6000;

/** Gear + RPM for a speed in km/h. */
export function gearRpmForSpeed(speedKmh) {
  const v = clamp(speedKmh, 0, 160);
  const band = GEAR_BANDS.find((b) => v < b.max) || GEAR_BANDS[GEAR_BANDS.length - 1];
  const t = band.max === band.min ? 0 : (v - band.min) / (band.max - band.min);
  // idle at the bottom of each band, near redline at the top (rev-drop on shift)
  const rpm = v < 0.5 ? IDLE_RPM : IDLE_RPM + (REDLINE_RPM - IDLE_RPM) * t;
  return { gear: band.gear, rpm: Math.round(rpm) };
}

/** Engine fundamental frequency (Hz) from RPM — 4-stroke: fire every 2 revs. */
export function engineFreqForRpm(rpm) {
  return (rpm / 60) * 2;
}

/**
 * Create the driver.
 * opts: { spline, obeyLimits, style }
 * style: 'relaxed' | 'aggressive' — affects accel/brake and following margin.
 */
export function createDriver(opts) {
  const { spline } = opts;
  let obeyLimits = opts.obeyLimits !== false;
  let style = opts.style === 'aggressive' ? {
    accel: 3.2, brake: 5.5, margin: 8,
  } : {
    accel: 2.2, brake: 3.8, margin: 12,
  };

  const state = {
    d: 0,            // arc length along route (m)
    speed: 0,        // m/s
    gear: 1,
    rpm: IDLE_RPM,
    heading: 0,      // radians, world frame (atan2(z, x))
    pos: { x: 0, z: 0 },
    lateral: 0,      // steering tilt for camera feel (rad, signed)
    stopped: true,
    arrived: false,
  };

  /**
   * Advance the simulation.
   * env: {
   *   zoneLimitKmh: number,          // speed limit at current position
   *   obstacle: { dist, speed } | null,  // nearest stopped/slow thing in our lane
   *   braking: bool,                // external brake request (incidents)
   * }
   */
  function update(dt, env) {
    if (state.arrived) return state;
    const { zoneLimitKmh = 50, obstacle = null, braking = false } = env || {};
    const limit = obeyLimits ? kmh(zoneLimitKmh) : kmh(90);

    // Curvature-based slow-down (comfortable lateral accel ~2.0 m/s² — sleep-driving).
    const k = spline.curvatureAt(state.d);
    const curveLimit = k > 1e-4 ? Math.sqrt(2.0 / k) : Infinity;

    let target = Math.min(limit, curveLimit);

    // Obstacle in our lane.
    if (obstacle && obstacle.dist > 0) {
      const vObs = obstacle.speed || 0;
      const brakeDist = (state.speed * state.speed) / (2 * style.brake);
      if (vObs === 0) {
        // Stationary obstacle: brake to a full stop and hold it.
        if (state.speed < 0.15 && obstacle.dist <= style.margin + 4) {
          target = 0; // hold the stopped position behind it
        } else if (obstacle.dist <= brakeDist + style.margin) {
          target = 0; // brake to a stop with a margin buffer
        }
      } else {
        // Moving obstacle: match its speed with a safe gap.
        const safe = vObs * 0.9;
        if (obstacle.dist <= brakeDist + style.margin) {
          target = Math.min(target, Math.max(0, safe));
        }
      }
    }
    if (braking) target = Math.min(target, 0);

    // Ease toward target with accel/brake limits.
    const dv = target - state.speed;
    if (dv > 0) state.speed = Math.min(target, state.speed + style.accel * dt);
    else state.speed = Math.max(target, state.speed - style.brake * dt);
    state.stopped = state.speed < 0.15;

    // Advance along the spline.
    state.d += state.speed * dt;
    if (state.d >= spline.length) {
      state.d = spline.length;
      state.speed = 0;
      state.arrived = true;
    }

    // Pose.
    const p = spline.posAt(state.d);
    const t = spline.tangentAt(state.d);
    state.pos = { x: p.x, z: p.z };
    state.heading = Math.atan2(t.z, t.x);
    // Steering tilt ∝ curvature * speed (subtle).
    const steerTarget = clamp(-k * state.speed * 0.35, -0.12, 0.12);
    state.lateral = state.lateral + (steerTarget - state.lateral) * Math.min(1, dt * 4);

    // Gear + RPM.
    const { gear, rpm } = gearRpmForSpeed(toKmh(state.speed));
    state.gear = gear;
    // Idle when stopped, otherwise follow the band; ease rpm for audio smoothness.
    const rpmTarget = state.speed < 0.15 ? IDLE_RPM : rpm;
    state.rpm += (rpmTarget - state.rpm) * Math.min(1, dt * 6);

    return state;
  }

  /** Reset to the start of the route (loop-forever). */
  function reset() {
    state.d = 0;
    state.speed = 0;
    state.gear = 1;
    state.rpm = IDLE_RPM;
    state.arrived = false;
    state.stopped = true;
    const p = spline.posAt(0);
    state.pos = { x: p.x, z: p.z };
    const t = spline.tangentAt(0);
    state.heading = Math.atan2(t.z, t.x);
    return state;
  }

  /** Live-apply the obey-speed-limits option. */
  function setObeyLimits(on) {
    obeyLimits = !!on;
  }

  /** Live-apply the driving style (relaxed/aggressive). */
  function setStyle(s) {
    style = s === 'aggressive' ? { accel: 3.2, brake: 5.5, margin: 8 }
      : { accel: 2.2, brake: 3.8, margin: 12 };
  }

  return { state, update, reset, setObeyLimits, setStyle };
}
