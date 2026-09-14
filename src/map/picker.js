// picker.js — MapLibre map with two draggable pins (origin + destination)
//
// Works offline-ish: if tiles fail to load the map is still interactive and
// the pins still move (the route just uses the grid fallback).

import { Map as MaplibreMap, Marker, LngLatBounds } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Explicit worker URL: Vite serves the default worker with a disallowed
// MIME type, which logs a warning (map still works, but let's be clean).
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/**
 * Create the map picker.
 * container: HTMLElement
 * opts: { origin: {lat,lng}, destination: {lat,lng}, onPick(origin, destination) }
 * Returns { map, setOrigin, setDestination, getOrigin, getDestination, destroy }.
 */
export function createPicker(container, opts) {
  const { origin, destination, onPick } = opts;

  let map = null;
  try {
    map = new MaplibreMap({
      container,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          osm: {
            type: 'raster',
            tiles: [OSM_TILES],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#1a1d24' } },
          { id: 'osm', type: 'raster', source: 'osm' },
        ],
      },
      center: [origin.lng, origin.lat],
      zoom: 13,
      attributionControl: false,
      worker: maplibreWorkerUrl,
    });
  } catch (e) {
    // WebGL2 unavailable (e.g. headless / no-GPU browser). Degrade to a
    // text hint; the pins are still tracked so the ride can start.
    console.warn('[auto-drive] map unavailable, using fallback:', e?.message || e);
    map = null;
    container.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#8a93a5;font:13px system-ui;text-align:center;padding:16px;">' +
      'Map preview unavailable (WebGL2 not supported in this browser).<br>' +
      'Your start &amp; end points are still set — press <b>Start ride</b>.' +
      '</div>';
  }

  // Degraded state when the map could not be created.
  if (!map) {
    return {
      map: null,
      fit: () => {},
      setRoute: () => {},
      getOrigin: () => ({ lat: origin.lat, lng: origin.lng }),
      getDestination: () => ({ lat: destination.lat, lng: destination.lng }),
      setOrigin: (p) => Object.assign(origin, p),
      setDestination: (p) => Object.assign(destination, p),
      destroy: () => {},
    };
  }

  const mkMarker = (color) =>
    new Marker({
      color,
      draggable: true,
      element: undefined,
    });

  const mOrigin = mkMarker('#5aa9ff');
  const mDest = mkMarker('#ff7a5a');
  mOrigin.setLngLat([origin.lng, origin.lat]).addTo(map);
  mDest.setLngLat([destination.lng, destination.lat]).addTo(map);

  function emit() {
    const o = mOrigin.getLngLat();
    const d = mDest.getLngLat();
    onPick?.({ lat: o.lat, lng: o.lng }, { lat: d.lat, lng: d.lng });
  }

  mOrigin.on('dragend', emit);
  mDest.on('dragend', emit);

  /** Fit the map to show both pins + the route. */
  function fit(o, d) {
    const b = new LngLatBounds([o.lng, o.lat], [d.lng, d.lat]);
    map.fitBounds(b, { padding: 60, duration: 600 });
  }

  map.on('load', () => fit(origin, destination));

  function setRoute(coords) {
    // coords: [{lat,lng}, ...]
    if (!coords || coords.length < 2) return;
    if (map.getLayer('route-line')) map.removeLayer('route-line');
    if (map.getSource('route-src')) map.removeSource('route-src');
    map.addSource('route-src', {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords.map((c) => [c.lng, c.lat]) },
        properties: {},
      },
    });
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route-src',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#8fd0ff', 'line-width': 3, 'line-opacity': 0.9 },
    });
  }

  function destroy() {
    map.remove();
  }

  return {
    map,
    fit,
    setRoute,
    getOrigin: () => { const l = mOrigin.getLngLat(); return { lat: l.lat, lng: l.lng }; },
    getDestination: () => { const l = mDest.getLngLat(); return { lat: l.lat, lng: l.lng }; },
    setOrigin: (p) => mOrigin.setLngLat([p.lng, p.lat]),
    setDestination: (p) => mDest.setLngLat([p.lng, p.lat]),
    destroy,
  };
}
