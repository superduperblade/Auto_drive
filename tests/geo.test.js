import { describe, it, expect } from 'vitest';
import { makeGeo } from '../src/lib/geo.js';

describe('geo', () => {
  const origin = { lat: 52.52, lng: 13.4 };
  const geo = makeGeo(origin);

  it('origin maps to (0,0,0)', () => {
    const p = geo.toWorld(origin.lat, origin.lng);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(0, 6);
  });

  it('round-trips lat/lng within 1 m over 5 km', () => {
    for (const [dLat, dLng] of [[0.02, 0.01], [-0.03, 0.02], [0.01, -0.03], [0.04, 0.04], [-0.04, -0.02]]) {
      const p = geo.toWorld(origin.lat + dLat, origin.lng + dLng);
      const ll = geo.toLatLon(p.x, p.z);
      expect(Math.abs(ll.lat - (origin.lat + dLat)) * 110574).toBeLessThan(1);
      expect(Math.abs(ll.lng - (origin.lng + dLng)) * 111320 * Math.cos((origin.lat * Math.PI) / 180)).toBeLessThan(1);
    }
  });

  it('north is -z, east is +x', () => {
    const north = geo.toWorld(origin.lat + 0.001, origin.lng);
    expect(north.z).toBeLessThan(0);
    expect(north.x).toBeCloseTo(0, 3);
    const east = geo.toWorld(origin.lat, origin.lng + 0.001);
    expect(east.x).toBeGreaterThan(0);
    expect(east.z).toBeCloseTo(0, 3);
  });

  it('1 degree lat ≈ 110.57 km', () => {
    const p = geo.toWorld(origin.lat + 1, origin.lng);
    expect(Math.abs(p.z)).toBeCloseTo(110574, -1);
  });

  it('dist works', () => {
    expect(geo.dist({ x: 0, z: 0 }, { x: 3, z: 4 })).toBeCloseTo(5);
  });
});
