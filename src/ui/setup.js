// setup.js — the pre-ride setup screen: map + pins + seat picker + quick
// options + "Start ride" (sleep-first: calm, dim, one big button).

import { SEATS, SEAT_LABELS, WEATHERS, TRAFFIC_LEVELS, TIME_OF_DAY, TIME_RATES } from '../config.js';
import { fetchRoute } from '../map/route.js';
import { makeGeo } from '../lib/geo.js';

const STYLE = `
  .ad-setup { position: fixed; inset: 0; display: flex; background: #10131a; color: #c8d0dc;
    font-family: system-ui, sans-serif; z-index: 10; }
  .ad-setup .map-wrap { flex: 1; position: relative; }
  .ad-setup .map-wrap .maplibregl-map { position: absolute; inset: 0; }
  .ad-setup .panel { width: 340px; padding: 24px; overflow-y: auto; background: #141821;
    border-left: 1px solid #232a38; }
  .ad-setup h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; color: #e8eef8; }
  .ad-setup .sub { font-size: 12px; color: #7a8494; margin-bottom: 20px; }
  .ad-setup label { display: block; font-size: 12px; color: #8a94a4; margin: 14px 0 6px; }
  .ad-setup select, .ad-setup input[type=range] { width: 100%; }
  .ad-setup select { background: #1c2230; color: #c8d0dc; border: 1px solid #2a3244;
    border-radius: 6px; padding: 8px; font-size: 13px; }
  .ad-setup .seats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; }
  .ad-setup .seat { background: #1c2230; border: 1px solid #2a3244; border-radius: 8px;
    padding: 10px; font-size: 12px; cursor: pointer; text-align: center; color: #9aa4b4; }
  .ad-setup .seat.sel { border-color: #5aa9ff; color: #e8eef8; background: #1e2a40; }
  .ad-setup .start { margin-top: 24px; width: 100%; padding: 16px; font-size: 16px;
    background: #2a5a8a; color: #eaf2ff; border: none; border-radius: 10px; cursor: pointer;
    font-weight: 600; }
  .ad-setup .start:hover { background: #33689a; }
  .ad-setup .start:disabled { background: #232a38; color: #5a6474; cursor: default; }
  .ad-setup .status { font-size: 12px; color: #7a8494; margin-top: 12px; min-height: 16px; }
  .ad-setup .route-info { font-size: 12px; color: #8a94a4; margin-top: 8px; }
`;

/**
 * Create the setup screen.
 * container: HTMLElement (will be filled)
 * config: initial TripConfig
 * onPick(origin, destination): called when pins move
 * onRouteReady(route): called when the route is fetched (for the map line)
 * onStart(config): called when "Start ride" is clicked
 * Returns { el, setConfig, destroy }.
 */
export function createSetup(container, config, { onPick, onRouteReady, onStart }) {
  let styleEl;
  if (!document.getElementById('ad-setup-style')) {
    styleEl = document.createElement('style');
    styleEl.id = 'ad-setup-style';
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);
  }

  const el = document.createElement('div');
  el.className = 'ad-setup';
  el.innerHTML = `
    <div class="map-wrap"><div id="ad-map"></div></div>
    <div class="panel">
      <h1>Auto Drive</h1>
      <div class="sub">Pick two points, choose a seat, and fall asleep to the drive.</div>

      <label>Seat</label>
      <div class="seats" id="ad-seats"></div>

      <label>Weather</label>
      <select id="ad-weather"></select>

      <label>Traffic</label>
      <select id="ad-traffic"></select>

      <label>Time of day</label>
      <select id="ad-tod"></select>

      <label>Time rate</label>
      <select id="ad-rate"></select>

      <label>Loop forever</label>
      <select id="ad-loop">
        <option value="1">On — new destination on arrival</option>
        <option value="0">Off — park at arrival</option>
      </select>

      <button class="start" id="ad-start">Start ride</button>
      <div class="status" id="ad-status"></div>
      <div class="route-info" id="ad-route"></div>
    </div>
  `;
  container.appendChild(el);

  // Seat picker.
  const seatsEl = el.querySelector('#ad-seats');
  for (const seat of SEATS) {
    const d = document.createElement('div');
    d.className = 'seat' + (seat === config.seat ? ' sel' : '');
    d.textContent = SEAT_LABELS[seat];
    d.onclick = () => {
      config.seat = seat;
      for (const s of seatsEl.children) s.classList.remove('sel');
      d.classList.add('sel');
    };
    seatsEl.appendChild(d);
  }

  // Selects.
  function fillSelect(id, items, current, labelFn) {
    const s = el.querySelector(id);
    for (const it of items) {
      const o = document.createElement('option');
      o.value = it;
      o.textContent = labelFn ? labelFn(it) : it;
      s.appendChild(o);
    }
    s.value = String(current);
  }
  fillSelect('#ad-weather', ['random', ...WEATHERS], config.weather);
  fillSelect('#ad-traffic', ['random', ...TRAFFIC_LEVELS], config.traffic);
  fillSelect('#ad-tod', TIME_OF_DAY, config.timeOfDay);
  fillSelect('#ad-rate', TIME_RATES.map(String), String(config.timeRate));
  el.querySelector('#ad-loop').value = config.loop ? '1' : '0';

  el.querySelector('#ad-weather').onchange = (e) => { config.weather = e.target.value; };
  el.querySelector('#ad-traffic').onchange = (e) => { config.traffic = e.target.value; };
  el.querySelector('#ad-tod').onchange = (e) => { config.timeOfDay = e.target.value; };
  el.querySelector('#ad-rate').onchange = (e) => {
    const v = e.target.value;
    config.timeRate = v === 'system' ? 'system' : Number(v);
  };
  el.querySelector('#ad-loop').onchange = (e) => { config.loop = e.target.value === '1'; };

  const statusEl = el.querySelector('#ad-status');
  const routeEl = el.querySelector('#ad-route');
  const startBtn = el.querySelector('#ad-start');

  let picker = null;
  let routeTimer = null;
  let lastRoute = null; // last fetched route (to draw once the map is ready)

  // Lazy-create the map (needs the DOM to be in the document).
  function initMap() {
    if (picker) return picker;
    // Dynamic import so the map only loads when the setup screen is shown.
    import('../map/picker.js').then(({ createPicker }) => {
      picker = createPicker(el.querySelector('#ad-map'), {
        origin: config.origin,
        destination: config.destination,
        onPick: (o, d) => {
          config.origin = o;
          config.destination = d;
          onPick?.(o, d);
          scheduleRoute();
        },
      });
      // If a route was already fetched before the map finished loading,
      // draw it now (avoids a race where the line never appears).
      if (lastRoute) drawRoute(lastRoute);
      return picker;
    }).catch((e) => {
      console.warn('[auto-drive] map failed to load:', e?.message || e);
    });
    return picker;
  }

  function drawRoute(route) {
    if (!picker) return;
    const geo = makeGeo(config.origin);
    const coords = route.points.map((p) => {
      const ll = geo.toLatLon(p.x, p.z);
      return { lat: ll.lat, lng: ll.lng };
    });
    picker.setRoute(coords);
  }

  function scheduleRoute() {
    if (routeTimer) clearTimeout(routeTimer);
    statusEl.textContent = 'Fetching route…';
    routeTimer = setTimeout(async () => {
      try {
        const geo = makeGeo(config.origin);
        const route = await fetchRoute(config.origin, config.destination, geo);
        lastRoute = route;
        routeEl.textContent = `${(route.distance / 1000).toFixed(1)} km · ${(route.duration / 60).toFixed(0)} min (${route.source})`;
        // Draw the route on the map.
        drawRoute(route);
        onRouteReady?.(route);
        statusEl.textContent = 'Ready.';
      } catch (e) {
        statusEl.textContent = 'Route unavailable — will use a straight drive.';
      }
    }, 400);
  }

  startBtn.onclick = () => {
    startBtn.disabled = true;
    startBtn.textContent = 'Preparing…';
    // startRide is async; surface any failure instead of an unhandled rejection.
    Promise.resolve(onStart(config)).catch((e) => {
      console.error('[auto-drive] failed to start ride:', e);
      startBtn.disabled = false;
      startBtn.textContent = 'Start ride';
      statusEl.textContent = 'Failed to start the ride. Please try again.';
    });
  };

  // Initialize the map + first route.
  initMap();
  scheduleRoute();

  function setConfig(c) {
    Object.assign(config, c);
  }

  function destroy() {
    picker?.destroy();
    el.remove();
    if (routeTimer) clearTimeout(routeTimer);
    if (styleEl) styleEl.remove();
  }

  return { el, setConfig, destroy };
}
