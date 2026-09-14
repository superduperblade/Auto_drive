// seats.js — seat → ear position + camera + baseline acoustic offsets (pure, testable)
//
// Car-local frame: +x forward, +y up, +z left (left-hand-drive car).

export const SEAT_DEFS = {
  driver: {
    ear: { x: 0.85, y: 1.12, z: 0.35 },
    cam: { x: 0.75, y: 1.18, z: 0.35 },
    offsets: { engine: 3, road: 1 },
    primaryWindow: 'left',
  },
  'front-passenger': {
    ear: { x: 0.85, y: 1.12, z: -0.35 },
    cam: { x: 0.75, y: 1.18, z: -0.35 },
    offsets: { engine: 0, road: 0 },
    primaryWindow: 'right',
  },
  'rear-left': {
    ear: { x: -0.85, y: 1.08, z: 0.35 },
    cam: { x: -0.95, y: 1.14, z: 0.35 },
    offsets: { engine: -4, road: 2 },
    primaryWindow: 'rear-left',
  },
  'rear-right': {
    ear: { x: -0.85, y: 1.08, z: -0.35 },
    cam: { x: -0.95, y: 1.14, z: -0.35 },
    offsets: { engine: -4, road: 2 },
    primaryWindow: 'rear-right',
  },
};

/**
 * Seat info in car-local coordinates.
 * Returns { ear, cam, offsets, primaryWindow }.
 */
export function seatInfo(seat) {
  const def = SEAT_DEFS[seat] || SEAT_DEFS['rear-left'];
  return {
    ear: { ...def.ear },
    cam: { ...def.cam },
    offsets: { ...def.offsets },
    primaryWindow: def.primaryWindow,
  };
}

/** dB → linear gain. */
export function dbToGain(db) {
  return Math.pow(10, db / 20);
}
