# Auto Drive — Code Review (v1)

Scope: full review of the v1 codebase (`src/`, `tests/`). Findings are grouped by
severity, each with the resolution applied (or a note if deferred). The codebase is
clean: `npm run build` succeeds with no warnings, and all 100 headless tests pass.

## Architecture summary

- **Pure logic core** (`src/lib`, `src/drive`, `src/world`, `src/incidents`,
  `src/weather`, `src/audio/raytracer.js`, `src/audio/seats.js`, `src/config.js`):
  no DOM/WebGL/WebAudio, fully unit-testable. This is the bulk of the 91 tests.
- **App shell** (`src/main.js`, `src/ui/*`, `src/map/*`, `src/world/*Mesh`,
  `src/audio/engine.js`, `src/audio/sources.js`): wires the core to Three.js,
  MapLibre, and Web Audio.
- **Headless fallback**: if `THREE.WebGLRenderer` cannot be created (no WebGL),
  the app runs simulation + audio only and shows a banner instead of crashing.
  This makes the app verifiable in headless/CI browsers.

## Findings and resolutions

### High severity (correctness / robustness)

1. **MapLibre threw an unhandled `GPUInitializationError` when WebGL2 was
   unavailable** (headless / no-GPU browsers). The setup screen still rendered,
   but the rejection polluted the console and could mask real errors.
   - **Resolution**: `src/map/picker.js` now wraps `new MaplibreMap(...)` in a
     try/catch and returns a degraded picker (text hint + still-tracked pins) so
     the ride can start. Verified: no more unhandled rejection in the dev log.

2. **`startRide` is async and was called without handling rejection**, so any
   failure (route fetch, world build) became an unhandled promise rejection and
   left the "Preparing…" button stuck.
   - **Resolution**: `src/ui/setup.js` now wraps the `onStart(config)` call in
     `Promise.resolve(...).catch(...)`, logging the error and re-enabling the
     button with a "try again" status.

3. **Setup-screen map/route race**: the map is created via a dynamic import, so
   the initial route (fetched before the map finished loading) was never drawn as
   a line.
   - **Resolution**: `src/ui/setup.js` now stores the last fetched route and
     draws it once the picker is ready (`drawRoute`), and the import failure is
     caught and logged.

### Medium severity

4. **M8 options were not all live**: `timeOfDay` and `audioMode` were no-ops in
   `applyOption`.
   - **Resolution**: `timeOfDay` now calls `weather.setTimeOfDay(preset)` (added
     to `src/weather/weather.js`) and jumps the in-game clock live. `audioMode`
     is stored in `cfg.audio.mode` and applies to newly created panners; true
     live HRTF↔stereo switching (recreating panner nodes) is a documented v1.1
     item (see Limitations).

5. **M7 loop-forever re-drove the same route** instead of picking a new
   destination on arrival.
   - **Resolution**: `src/main.js` now has `restartWithNewDestination()`, which
     picks a new destination (`randomDestination`), re-fetches the route, and
     rebuilds the world (spline, city, driver, traffic, peds, incidents, and the
     route-dependent 3D meshes) via a new `buildWorld()` function. On re-route
     failure it falls back to re-driving the same route.

6. **M8 freecam did not move the raytracer listener**: the listener was always
   the in-car seat ear, so stepping outside the car with the freecam did not
   change the acoustics.
   - **Resolution**: `src/main.js` `audioTick` now uses the freecam pose
     (position + forward + up) as the listener when the freecam is active. The
     raytracer then treats the listener as exterior and sources are heard through
     direct / window / body-leak paths as appropriate. Covered by the existing
     "freecam outside the car hears direct sound" raytracer test.

7. **M4 lorry air-brake one-shot was missing**: the `lorry-brake` incident
   emitted an event but no sound was played (the SFX had no air-brake).
   - **Resolution**: `src/audio/sources.js` now has a `makeAirBrakeBuffer`
     (high-frequency hiss, fast attack, ~1 s decay) and an `airBrake(pos, gain)`
     SFX method; `src/main.js` plays it on `lorry-brake` events. The lorry's
     low diesel rumble comes from its `TRAFFIC_SYNTH.lorry` params (freq 45,
     lowpass 400).

8. **M6 road wetness after rain was missing**: rain affected lighting and the
   droplet shader but not the road surface.
   - **Resolution**: `src/weather/weather.js` now tracks a `wetness` value (rises
     with precipitation intensity, decays slowly after); `src/world/road.js` has
     a `setWetness(v)` that darkens the asphalt and lowers roughness (wet sheen);
     `src/main.js` drives it each frame. Covered by a weather test.

### Low severity / cleanup

9. **Debug/trace scaffolding removed**: temporary `console.log` trace markers and
   `globalThis.__ad*` probes added while diagnosing the headless browser were
   removed. A single `window.__ad` debug hook (audio/sim handles) is kept for
   console inspection.

10. **`setup.js` style element leaked**: `destroy()` did not remove the injected
    `<style>`.
    - **Resolution**: `destroy()` now removes the style element.

11. **`decodeConfig` type check** for `timeRate` now accepts both string
    (`'system'`) and number, matching the `TIME_RATES` union. (Previously a
    numeric `timeRate` from a shared URL could be rejected.)

## Known limitations (v1)

- **`audioMode` live switching**: switching between HRTF and stereo panners
  recreates panner nodes; v1 applies the mode to newly created panners (next
  trip). A live crossfade is a v1.1 item.
- **Loop-forever reuses the same city seed**: the new route is generated along a
  new corridor but reuses the trip seed, so building placement is deterministic
  per seed (intended for reproducibility / shareable URLs).
- **Freecam in headless mode**: with no WebGL there is no freecam (no camera to
  orbit); the audio listener stays at the seat. This is expected in headless mode.
- **OSRM demo server**: routing uses the public `router.project-osrm.org` demo
  (no key, rate-limited). The grid fallback keeps the app working offline.

## Test coverage (100 tests, all passing)

- `rng`, `geo`, `spline`, `math`: deterministic RNG, lat/lng↔world round-trip,
  spline resampling/arc-length, math helpers.
- `driver`: speed→gear→RPM→engine-frequency mapping, idle at 800 rpm, curvature
  comfort limit, obstacle stopping (stationary-obstacle rule), arrival.
- `city`: building generation, density zones, streetlight placement (regression
  for the old infinite-loop bug), crossings.
- `traffic`: per-lane spawners, car-following keeps gaps positive, vehicle
  variety, speed-limit zones.
- `peds_incidents`: pedestrian crossings + yield, incident spawner.
- `weather`: state machine transitions + intensity, clock advance rates (system
  and fixed), night/dusk lighting, thunder, wiper/droplet scaling,
  `setTimeOfDay` (live option).
- `raytracer`: ray-box/ray-triangle hits & misses, car shell (6 windows, body,
  floor), interior/exterior detection, window path selection, body-leak bed,
  building/vehicle occlusion, freecam exterior direct sound, horn-left-is-left /
  horn-right-is-right spatialization, Doppler, `raytrace=off`, and a
  30-sources@20 Hz performance budget.
- `seats`: the 4 planned seats, every ear inside the cabin box, finite camera +
  ear positions, front-behind / left-right ordering, per-seat engine offsets,
  dB→linear conversion.
- `config`: defaults, `resolveConfig` determinism, `sanitizeConfig`, URL
  encode/decode round-trip, `configFromUrl`, `randomDestination`.

## Verification

- `npm run build`: clean (no warnings), 4 output assets.
- `npx vitest run`: 11 files, 100 tests, all passing.
- Headless (Node) end-to-end: car drives a straight road (≈497 m in 30 s at
  70 km/h), engine pitch tracks speed (26.7 Hz idle → 165 Hz cruise), raytracer
  produces correct window/occlusion/body-leak paths.
- Browser (Camoufox, no WebGL): setup screen renders, OSRM route fetched
  (4.0 km), map fallback engages cleanly (no unhandled rejection), ride boots
  and the car drives (HUD live), headless banner shown, no console errors.
