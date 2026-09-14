// geo.js — lat/lng ↔ local world coordinates (pure, testable)
//
// World frame (meters, right-handed, y-up):
//   +x = east, +y = up, +z = south.
// Local equirectangular projection around an origin (accurate to ~cm over
// the few-kilometer corridors this app uses).

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG_EQUATOR = 111320;

export function makeGeo(origin) {
  const lat0 = origin.lat;
  const lng0 = origin.lng;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);

  return {
    origin: { lat: lat0, lng: lng0 },

    /** lat/lng → world {x, y, z} in meters. */
    toWorld(lat, lng, alt = 0) {
      return {
        x: (lng - lng0) * cosLat * M_PER_DEG_LNG_EQUATOR,
        y: alt,
        z: -(lat - lat0) * M_PER_DEG_LAT,
      };
    },

    /** world {x, z} → {lat, lng}. */
    toLatLon(x, z) {
      return {
        lat: lat0 - z / M_PER_DEG_LAT,
        lng: lng0 + x / (cosLat * M_PER_DEG_LNG_EQUATOR),
      };
    },

    /** Distance in meters between two world points (flat). */
    dist(a, b) {
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      return Math.sqrt(dx * dx + dz * dz);
    },
  };
}
