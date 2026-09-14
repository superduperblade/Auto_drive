// route.js — OSRM routing with a grid fallback (returns a world-space polyline)
//
// Primary: the public OSRM demo server (no key). Fallback: an L/Z-shaped path
// snapped to the city grid so the ride still looks street-like offline.

import { resamplePolyline } from '../lib/spline.js';

const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
const GRID = 150; // matches city.js GRID_SPACING

function gridRoute(a, b) {
  const snap = (v) => Math.round(v / GRID) * GRID;
  const ax = snap(a.x), az = snap(a.z), bx = snap(b.x), bz = snap(b.z);
  const path1 = [{ x: ax, z: az }, { x: bx, z: az }, { x: bx, z: bz }];
  const path2 = [{ x: ax, z: az }, { x: ax, z: bz }, { x: bx, z: bz }];
  const len = (p) =>
    Math.hypot(p[1].x - p[0].x, p[1].z - p[0].z) +
    Math.hypot(p[2].x - p[1].x, p[2].z - p[1].z);
  const pts = len(path1) <= len(path2) ? path1 : path2;
  // Resample to ~10 m for a smooth spline.
  return resamplePolyline(pts, 10);
}

/**
 * Fetch a route between two lat/lng points.
 * Returns { points: [{x,z}], distance, duration, source }.
 * Never throws — falls back to a grid route on any error.
 */
export async function fetchRoute(origin, destination, geo) {
  const a = geo.toWorld(origin.lat, origin.lng);
  const b = geo.toWorld(destination.lat, destination.lng);
  try {
    const url =
      OSRM +
      `${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
      '?overview=full&geometries=geojson';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error('OSRM ' + res.status);
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error(data.code || 'no route');
    const route = data.routes[0];
    const pts = route.geometry.coordinates.map(([lng, lat]) => geo.toWorld(lat, lng));
    if (pts.length < 2) throw new Error('short route');
    return {
      points: resamplePolyline(pts, 10),
      distance: route.distance,
      duration: route.duration,
      source: 'osrm',
    };
  } catch (e) {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    return {
      points: gridRoute(a, b),
      distance: dist,
      duration: dist / 12, // ~43 km/h
      source: 'fallback',
    };
  }
}
