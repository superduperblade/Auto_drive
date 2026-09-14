# Auto Drive — Plan

A webapp you can watch and fall asleep to: pick two points on a real map, choose your
seat in the car, and ride along a procedurally-built 3D city while the weather,
traffic, and incidents unfold. The centerpiece is **raytraced audio from inside the
car** — the car body, windows, and nearby geometry determine what you hear.

## 1. Goals / Non-goals

**Goals**
- Pick origin + destination on an interactive map (real OSM streets).
- Drive there automatically; user only chooses seat + settings, then watches.
- 3D city with buildings (boxes + emissive windows), roads, streetlights, props.
- Weather: currently **random per trip** (clear / overcast / rain / snow / fog).
- Traffic: **random** density and behavior; random **incidents** (accidents, honks,
  sirens, stalled cars, near-misses).
- Seat selection: driver, front passenger, rear-left, rear-right → different camera
  **and** different audio.
- **Varied traffic**: cars, vans, and lorries — different sizes, speeds, behavior,
  and sound signatures (a lorry is a big low diesel rumble, not a small car hum).
- **Speed limits by zone**: denser populated areas = lower limits (30–50 km/h),
  arterial roads 50–70, outskirts up to 90. The car obeys them.
- **Pedestrians** in dense areas: zebra crossings with people; option for the car
  to stop and yield (default on).
- Audio is the main event: raytraced through the car interior, engine hum,
  rain on the windshield, traffic with Doppler, all gentle and sleep-safe.

**Non-goals (for now)**
- No real 3D city data (procedural buildings seeded from the route).
- No multiplayer, no accounts, no backend beyond free public APIs.
- No driving controls — the car drives itself (this is a "watch it sleep" app).
- No mobile optimization priority (desktop-first, but should not crash on mobile).

## 2. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Build | Vite + vanilla JS/ESM | No framework churn; fast iteration |
| 3D | Three.js | Standard, instancing, shaders for rain-on-glass |
| Map | MapLibre GL JS + OSM raster/tiles | Free, no API key, real street layout |
| Routing | OSRM demo server (`router.project-osrm.org`) | Free, no key; fallback = grid routing |
| Audio | Web Audio API | Full DSP control; procedural synthesis |
| State | Plain JS modules, one `TripConfig` object | Keep it simple |

No server needed to run: static site. (Optional later: tiny Node proxy for OSRM
rate limits.)

## 3. Flow

1. **Setup screen**: map with two draggable pins (A → B), seat picker (4 seats,
   top-down car diagram), weather picker (default: "random"), traffic density
   slider (default: random), time-of-day (default: dusk/night — best for sleep).
2. **Transition**: short fade from map to 3D scene; the car is already idling.
3. **Drive**: camera inside the chosen seat (or freecam — see 9.1). HUD (speed,
   ETA, next turn) fades out after ~10 s and only reappears on mouse move.
   No alerts, no popups.
4. **Arrival**: car stops, engine idles → cuts out, rain continues. With
   **loop-forever mode** (default on) it then picks a new random destination and
   keeps going indefinitely — the app is an ambient drive you can leave running;
   "idle" is the alternative (scene keeps going, car parked).

## 4. World generation

- **Roads**: from the OSRM geometry (polyline with road names). Build a road mesh
  (lanes, dashed centerline, curbs) around the route; side streets generated on a
  grid for context.
- **Buildings**: along the route, block out city blocks between streets; each block
  gets 1–6 building boxes with:
  - height seeded by distance from "downtown" + random (10–80 m),
  - facade color from a muted palette,
  - window grid texture (emissive at night, random lit/unlit per window),
  - occasional rooftop details (AC units, water tanks) as cheap boxes.
  - Rendered with `InstancedMesh` per material bucket → thousands of buildings,
    few draw calls.
- **Props**: streetlights (point lights are too expensive → fake with emissive
  poles + light pools on the ground via a shader or baked spotlights only near the
  car), trees (billboards), parked cars (low-poly boxes with glowing windows).
- **Own car**: a real low-poly car model (~300–800 tris) with a **separate
  interior shell** (dashboard, seats, A-pillars, windows as thin quads). This mesh
  is what the audio raytracer uses — visuals and acoustics share geometry.
- **Traffic cars**: ~10–20 low-poly cars active at once within ±400 m of the
  player, recycled as they fall behind/ahead.
- **Sky**: gradient skybox + fog; night = dark blue + moon; rain = gray; stars
  optional. Time-of-day drives sun position, streetlights, and window emissives.
- **In-game clock**: the world runs on a clock that either **mirrors the system
  clock** (default — start at 23:00 and you get a night drive) or **advances at a
  fixed rate** (1× / 2× / 5× / 10×, option). At 5–10× a long ride drifts dusk →
  night → early morning on its own, which is ideal for a sleep session. A fixed
  time-of-day (dusk/night/morning from the quick bar) pins the clock instead.

## 5. Driving

- Follow the OSRM polyline with a smoothing spline (Catmull-Rom).
- Speed model: target speed per road class, ease toward it; slow for turns,
  stop at red lights and incidents.
- **Speed-limit zones**: density is derived from the generated city (building
  block size + height + street grid spacing). Zones:
  | Zone | Density signal | Limit |
  |---|---|---|
  | Dense core | small blocks, tall buildings, narrow streets | 30 km/h |
  | Urban | medium blocks | 50 km/h |
  | Arterial | wide streets, fewer blocks | 70 km/h |
  | Outskirts | sparse blocks | 90 km/h |
  - Limit changes are shown as a brief, dim HUD icon (no sound) and the car eases
    into the new limit over ~2–3 s.
  - Dense zones also enable: pedestrians, more traffic, lower incident honk volume.
- Steering/tilt derived from curvature for camera feel (subtle).
- Gear = f(speed); engine RPM = f(gear, speed) → drives audio.

## 6. Traffic, vehicles & pedestrians

### 6.1 Vehicle types

| Type | Share | Size | Speed | Behavior | Sound |
|---|---|---|---|---|---|
| Car (sedan/hatch) | ~70% | 4.5 m | zone limit ±10% | normal lane changes | small engine + tires |
| Van | ~15% | 5.5–6.5 m | zone limit −10% | fewer lane changes, wider gap | mid engine, more body noise, wipers |
| Lorry | ~15% (less in dense core) | 10–16 m | zone limit −20% | stays in outer lane, slow to start/stop, no overtaking | **low diesel rumble** (sub-heavy), air-brake hiss on stop, big Doppler, blocks more sound (large box in raytracer) |

- Each type is a low-poly mesh (car ~200 tris, van ~300, lorry ~500) + a matching
  raytracing box. Lorries are the best test of the audio: passing one should
  rumble through the floor and muffle the world while it's alongside.

### 6.2 Flow

- Per-lane spawners with type-weighted selection, random speeds, lane changes
  (type-dependent), and car-following (simple: keep gap to car ahead, gap scales
  with vehicle length).

### 6.3 Pedestrians (dense zones only)

- Zebra crossings at intersections in dense zones; small capsule people spawn on
  sidewalks and cross on a timer (with occasional jaywalkers).
- **Yield option** (default on): if a pedestrian is within ~10 m of our lane at a
  crossing, the car eases to a stop, waits, then accelerates. In dense zones the
  car also pre-slows when approaching a crossing with visible waiters.
- Audio: soft footsteps (rate ∝ speed, muffled by distance), faint crowd murmur
  as a bed in dense zones, an occasional distant conversation snippet (unintelligible
  babble — never words). A jaywalker triggers a soft honk from us or a nearby car.

### 6.4 Incidents
- Incidents (random, weighted, at most one active nearby at a time):
  - two-car fender-bender ahead → both stop, hazards blink, we slow around;
  - stalled car in lane → we change lanes;
  - honk (short 2-tone) from a car cutting in or being cut off;
  - siren (ambulance/fire) passing with two-tone sweep + Doppler;
  - near-miss (someone cuts close → brief honk + we brake).
  - lorry air-brake: a lorry ahead stops hard → long hiss + rumble + we brake.
- Incidents are **audio-first**: each one is defined by its sound signature first,
  then its visual. Sleep-safe: nothing ever exceeds the master limiter.

## 7. Weather

- Random per trip: `clear | overcast | rain | snow | fog` (weighted; rain most
  likely since it's the best audio).
- Effects:
  - **Rain**: windshield droplet shader (screen-space: droplets form, merge, slide
    down with refraction blur), wipers (rhythmic sweep + audio), road wetness
    (darker asphalt, reflections), spray from other cars, visibility drop.
    - **Sound-reactive droplets**: the droplet shader is driven by the same
      intensity signal as the audio rain layer, plus a per-droplet amplitude
      modulated by the rain bus level — visuals and audio can never drift apart
      (a gust = more droplets *and* more shush at the same instant).
  - **Snow**: falling particles, muffled ambience, white fog.
  - **Fog**: distance fog + reduced light pools.
  - **Overcast/clear**: lighting only.
- Rain intensity is a continuous value (drives droplet density, audio gains,
  wiper speed) — not just on/off.

## 8. Audio engine (the core)

### 8.1 Architecture

```
sources (procedural)          per-source WebAudio graph
┌────────────────────┐        ┌──────────────────────────────────────────┐
│ engine (own car)   │───────▶│ synth → gain → biquad(s) → delay → HRTF │
│ road/wind          │        │   (raytraced:  G, cutoff, delay, pos)   │
│ rain (3 layers)    │        └───────────────────────┬──────────────────┘
│ traffic car i      │                                ▼
│ horn / siren       │        cabin reverb (short)  ◀── interior paths only
└────────────────────┘        outdoor reverb (long) ◀── exterior paths only
                                        ▼
                          master bus → soft limiter → out (headphones)
        ▲
        │ per-source parameters @ 20 Hz
   RAYTRACER (geometry: car shell + windows + nearby boxes)
        ▲
   listener pose (seat or freecam) + source positions
```

- All synthesis is procedural (oscillators + filtered noise + one-shot buffers) —
  no audio files, everything stays gentle and controllable.
- Parameters are updated at 20 Hz with `setTargetAtTime` smoothing (τ ≈ 50–100 ms)
  → **no clicks, no jumps** — critical for sleep.
- Master bus: soft-clip limiter + overall ceiling (~ -14 dBFS) so nothing ever
  startles.

### 8.2 The raytracer

True per-frame raytracing, kept cheap:

- **Geometry**:
  - Own car shell: ~60 triangles (roof, hood, trunk, doors, pillars) + 6 window
    quads (windshield, rear, 4 sides) marked as *glass* (transmissive, different
    filter) + the interior floor (for the "inside" test).
  - Other cars: 6-face boxes (within 150 m).
  - Buildings: boxes (within 250 m, only those near the route corridor).
  - Ground plane.
  - Total: a few hundred boxes + ~70 triangles. Naive Möller–Trumbore /
    ray-box tests at 20 Hz are trivially fast — no BVH needed.
- **Per source, per audio tick**:
  1. **Direct ray** source → listener ear (position of the selected seat).
     - If the source is inside the car shell (own engine, own seatbelt creak):
       full interior path, no occlusion.
     - If the ray hits the car shell: exterior sound is **blocked** by the body.
  2. **Window paths**: for each of the 6 window quads, ray source → window center
     → ear. If both segments are clear, the sound arrives *through the glass*:
       gain = distance attenuation × glass transmission (~0.5) × window angle,
       cutoff lowered slightly (glass absorbs highs, ~ -6 dB/oct above 4 kHz),
       delay = (d1 + d2) / 343 m/s.
       The **best** window path wins (max gain) — this makes "sound comes from
       the left window" feel real.
  3. **Body-leak path**: exterior sources also arrive weakly through the body
       (gain × 0.08, heavy low-pass ~800 Hz) — the muffled "everything is
       outside" bed that makes the cabin feel enclosed.
  4. **Building occlusion**: for distant sources (sirens, horns), a second
       source → listener ray against nearby building boxes; if blocked, the
       source is heard at × 0.3 with a low-pass — a siren around a corner is
       muffled and delayed.
  5. **Doppler**: playbackRate modulated by radial velocity (±20% max), plus a
       subtle pitch drift as cars pass.
  6. **Spatialization**: each path's endpoint (window quad center, body-leak
       point, or source position for interior sounds) is fed to an HRTF panner
       (see 8.5) — the *geometry* decides where each path arrives from.
- **Result per source**: `{ gain, cutoffHz, delayMs, pos, playbackRate }` →
  applied to that source's graph with smoothing.

### 8.3 Source list

| Source | Synthesis | Notes |
|---|---|---|
| Own engine | 3 detuned saws (fundamental + harmonics) + brown noise, low-passed; RPM from gear/speed | Inside cabin = felt more than heard: boost sub-100 Hz, keep highs quiet |
| Road/wheel | Filtered brown noise, cutoff ∝ speed | Slight texture variation per "road surface" |
| Wind | Filtered white noise, gain ∝ speed², gusts (slow LFO) | Louder at higher seats? No — same, but wind through cracked window option later |
| Rain on windshield | Layer A: steady "shush" (bandpass noise, 1–6 kHz) ∝ intensity; Layer B: 20–80 short droplet transients/s (random bandpass blips) spatially panned to match droplet density (front-center) | The signature sound; droplet rate follows rain intensity |
| Rain on roof | Same droplet layer, × 0.4 gain, low-passed, panned wide/above | Sells "we're inside a car" |
| Rain on ground | Soft continuous hiss, ∝ intensity × speed | Fades when stopped |
| Traffic car i | Small engine loop (saw + noise) + tire noise, Doppler + pan | Only ~10 nearest matter |
| Van i | Mid engine (saw + noise) + body/wind noise, slower Doppler | Slightly boxier sound |
| Lorry i | **Low diesel**: sub-bass saws (60–120 Hz) + exhaust chuff (LFO-gated noise) + tire rumble; air-brake = long white-noise hiss with low-pass sweep | The sub-bass is felt through the cabin floor (body-leak path); alongside = world gets muffled (big occluder) |
| Footsteps | Bandpass noise taps, rate ∝ walking speed, panned by position | Muffled past ~20 m |
| Crowd murmur | Very quiet babble (filtered noise with slow formant wobble) | Bed only, dense zones |
| Horn | 2-tone square burst, 0.3–0.8 s | Capped loud |
| Siren | Two-tone sweep (700↔1000 Hz), classic wail | Capped loud, Doppler |
| Wipers | Rhythmic filtered-noise whoosh + soft "swish" per sweep | Period 2–6 s by rain intensity |
| Thunder (storm) | Low rumble (filtered noise burst + slow decay), delay ∝ distance | Rare, gentle |
| Cabin micro | Seatbelt creak (rare, very quiet), door close on start, occasional A/C hum | Tiny details that make it feel alive |

### 8.4 Seats

Seat changes both camera and acoustics:

| Seat | Camera | Engine | Road | Windows |
|---|---|---|---|---|
| Driver | behind wheel, wheel visible | +3 dB, more low-mid | +1 dB | left window primary |
| Front passenger | right of wheel | 0 dB | 0 dB | right window primary |
| Rear left | behind left seat | -4 dB, more muffled | +2 dB | rear-left window primary |
| Rear right | behind right seat | -4 dB, more muffled | +2 dB | rear-right window primary |

(The raytracer already handles most of this automatically from ear position —
the table is just the baseline offset on top.)

### 8.5 Headphone-first rendering

The typical user wears headphones, so the audio is designed for binaural
listening first (speakers are a fallback, not the target):

- **HRTF panning**: every path endpoint goes through a `PannerNode` with
  `panningModel: 'HRTF'`, `distanceModel: 'inverse'` (refDistance 1 m,
  rolloff 1). Real left/right *and* elevation cues: a horn through the left
  window is physically left-and-slightly-outside; rain on the windshield is
  front-and-above; the engine is low, front, and slightly toward the driver's
  left. StereoPannerNode is only used in speaker mode.
- **Two reverbs, split by path** (the trick that sells "inside a car"):
  - *Cabin reverb*: very short (RT60 ≈ 0.25–0.35 s), low-passed — applied only
    to interior paths (own engine, body-leak, seatbelt creaks). The cabin feels
    small, hard, and enclosed.
  - *Outdoor reverb*: longer (RT60 ≈ 1–2 s, street-canyon character), applied
    only to exterior paths that reach the listener *outside* the shell
    (freecam outside the car, or the window-path component). The world feels
    open and wet.
  - A source heard through a window gets a blend of both (mostly cabin), which
    is exactly how a real car sounds.
- **Head tracking** (optional toggle, off by default): on devices with
  orientation sensors, the listener rotates with the head — turn your head and
  the siren moves. Off = listener locked to the seat (simpler, sleep-friendly).
- **Speaker mode** (toggle): HRTF replaced by stereo panning + a mild crossfeed,
  outdoor reverb reduced, since mono-summing on speakers kills the effect.
  Headphone mode is the default.
- **Sub-bass placement**: the lorry rumble and engine low-end are kept below
  ~120 Hz and panned narrowly so they don't smear the stereo image — small
  headphones shouldn't have to fake a subwoofer.
- **Level strategy**: headphones reveal detail, so the ceiling is lower than it
  would be for speakers (~ -16 dBFS) and the rain/traffic beds are mixed 2–3 dB
  quieter than a "fun" mix. Goal: you forget it's playing.

## 9. UI / UX (sleep-first)

- Setup: map + pins + seat diagram + quick options + "Start ride" (big, calm button).
- In-ride HUD: speed, time, ETA, next street name, current speed-limit icon —
  small, dim, top-left; **fades to 0 after 10 s idle**, reappears on mouse move.
- Sleep mode (toggle, default on): disables all UI, ignores input, keeps audio
  and scene running indefinitely.
- No red alerts, no flashing, no sudden volume. Incidents are announced by sound
  only (the point: you hear them, you don't read them).

### 9.1 Options: two tiers

**Quick bar** (always one click away — `O` key or a dim icon; never modal, never
full-screen; closes on click-away or `Esc`): the things you actually change
mid-ride:

- Volume (master)
- Sleep mode on/off
- Camera: seat / freecam
- Weather: random / clear / overcast / rain / snow / fog
- Traffic density: light / normal / heavy (or random)
- Stop for pedestrians: on / off (dense zones)
- Time of day: auto / dusk / night / morning
- Loop forever: on / off (new random destination on arrival)

**Full options menu** (from the quick bar, "More…"; grouped, collapsible):

- *Driving*: obey speed limits (on/off), stop for pedestrians (on/off),
  aggressive/relaxed driving style (affects honks and gaps)
- *Audio*: rain volume, traffic volume, engine volume, master limiter on/off,
  Doppler on/off, raytrace quality (full / window-paths only / off = direct only),
  seatbelt creaks, cabin micro-sounds
- *Visuals*: rain-on-glass detail, shadows, streetlight glow, **in-car HUD glow**
  (off / dim / neon — the 3D instrument cluster's backlight), HUD fade time,
  show speed-limit signs in 3D
- *Miscellaneous*: car color, car type (car / van — you can ride in a van too),
  **time rate** (system clock / 1× / 2× / 5× / 10× — default: system clock;
  applies when time of day is "auto"), ambient music layer (off/very quiet),
  **copy shareable link** (encodes seed +
  route A/B + all settings in the URL — opening it reproduces the same city,
  weather, traffic, and trip), seed (reproducible trips), language (HUD text)

All options take effect live without restarting the trip. Defaults are tuned for
sleep: everything gentle, limiter on, pedestrians on, limits obeyed, loop on,
headphone mode on.

### 9.2 Freecam

- Toggle from the quick bar (or `F` key): drag to orbit, wheel to zoom,
  right-drag to pan. Unconstrained — fly over the city, through the streets,
  back into the car. Seat view stays the default; freecam is a watching tool,
  not a sleep mode.
- **Audio follows the camera**: the raytracer's listener moves to the freecam
  position. Step outside the car and the world flips — engine heard from
  outside, rain on the roof louder than on the windshield, cabin reverb gone,
  outdoor reverb in. Walk back inside and it's the cabin again. This is also
  the best built-in test that the raytracer is genuinely working.

## 10. Performance budget

- 60 fps target at 1080p on a mid-range GPU:
  - Buildings: instanced, frustum-culled, only ±1.5 km corridor.
  - Traffic: ≤ 20 cars, recycled.
  - Rain particles: single Points cloud, ≤ 3000 points.
  - Audio raytracer: ≤ 30 sources × ~8 rays × ~300 boxes @ 20 Hz → negligible.
  - Shadows: one directional light, low-res map, or none at night (use light pools).
- Frame budget: < 8 ms GPU, < 4 ms JS.

## 11. Milestones — fundamentals first, then outward

Build-order principle: get a **minimal but complete** sleep experience working
end-to-end first (real route, seat view, basic headphone audio, rain), then
dig deeper into the audio (the core of the project), then build outward to a
living world, then polish. Every phase ends with something you can actually
watch and fall asleep to — no phase is "just plumbing".

### Phase 1 — Fundamentals (the core loop)

| # | Deliverable | Acceptance |
|---|---|---|
| M0 | Vite scaffold, Three.js scene, car on a straight road, engine hum audible | Drive forward; engine pitch follows speed |
| M1 | Map pick (MapLibre) + OSRM route + 3D road + procedural buildings + 4-seat camera views | Pick two real places; car follows the real route through a city, seen from the chosen seat |
| M2 | Audio foundation (headphone-first): HRTF panner, master limiter, engine/road/wind, rain (3 layers) + wipers, rain visuals (droplet shader) | A rainy A→B ride with real left/right and rain-on-glass — already a usable sleep experience (v0) |

### Phase 2 — Audio depth (the core)

| # | Deliverable | Acceptance |
|---|---|---|
| M3 | **Raytraced audio**: car-shell geometry, window paths, body-leak, cabin/outdoor reverb split, per-seat acoustics | A horn from the left is clearly left; a siren behind a building is muffled; rear seat sounds different from driver; engine is "inside" |
| M4 | Traffic audio: varied vehicles (car/van/lorry) with Doppler, horns/sirens, building occlusion | A lorry passes and you feel it through the floor; a siren around a corner is muffled and delayed |

### Phase 3 — Living world (build outward)

| # | Deliverable | Acceptance |
|---|---|---|
| M5 | Traffic sim: varied vehicles, flow, speed-limit zones, pedestrians + yield, incidents | A lorry passes with a distinct rumble; the car obeys 30 km/h in the dense core and stops for a crossing; an incident happens within ~2 min |
| M6 | Weather variety: snow/fog/overcast, thunder, night mode, in-game clock (system / 1× / 2× / 5× / 10×) | Rain wets the road; a long ride at 5× drifts dusk → night on its own |

### Phase 4 — Sleep polish + outward features

| # | Deliverable | Acceptance |
|---|---|---|
| M7 | Sleep polish: HUD fade, sleep mode, limiter tuning, loop-forever, shareable seed URLs | You can start it and fall asleep without touching anything; the ride never ends |
| M8 | Freecam (audio-following), in-car HUD glow, full options menu | Freecam proves the raytracer (world flips when you step outside the car); every option applies live |

Phase 2 (M3–M4) is the heart of the project; do the raytraced-audio pass (M3)
as its own focused milestone before adding traffic sounds.

## 12. File layout

```
agents/auto_drive/
├── PLAN.md
├── index.html
├── package.json            # vite, three, maplibre-gl
└── src/
    ├── main.js             # boot, scene loop, state
    ├── config.js           # TripConfig, defaults, randomization
    ├── map/
    │   ├── picker.js       # MapLibre map, two pins
    │   └── route.js        # OSRM fetch + fallback grid routing
    ├── world/
    │   ├── city.js         # block/building generation, density zones, instancing
    │   ├── road.js         # road mesh from route polyline, crossings, signs
    │   ├── car.js          # own car (exterior + interior shells)
    │   ├── vehicles.js     # car/van/lorry meshes + raytracing boxes + sounds
    │   ├── traffic.js      # spawners, car-following, recycling
    │   ├── pedestrians.js  # crossings, walking, yield logic
    │   └── sky.js          # skybox, fog, time-of-day
    ├── drive/
    │   └── driver.js       # spline following, speed/gear model
    ├── weather/
    │   ├── weather.js      # state machine, intensity
    │   └── rain.js         # droplet shader, wipers, particles
    ├── audio/
    │   ├── engine.js       # AudioContext, master bus, limiter, buses
    │   ├── sources.js      # synth definitions for every source (8.3)
    │   ├── raytracer.js    # geometry, ray-box/triangle, per-source solve
    │   └── seats.js        # seat → ear position + baseline offsets
    ├── incidents/
    │   └── incidents.js    # spawner + definitions (sound-first)
    └── ui/
        ├── setup.js        # map + seat + sliders screen
        ├── hud.js          # fading in-ride HUD, sleep mode
        ├── options.js      # quick bar + full options menu, live-apply
        └── freecam.js      # freecam controls + audio-following listener

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| OSRM demo server rate limits / down | Cache routes; fallback = simple grid routing along OSM way; or pre-baked demo routes |
| Audio clicks on parameter changes | All params via `setTargetAtTime`; never disconnect/reconnect mid-trip; one-shot sounds are pre-rendered buffers with envelopes |
| Rain droplet shader too heavy | Screen-space, single quad, capped droplet count; degrades to static droplets |
| Raytracer cost if geometry grows | Cap boxes to corridor; 20 Hz tick; trivial math — but keep it behind one function for easy profiling |
| "Raytraced" feels fake if only direct+window paths | The body-leak + building-occlusion + per-window path selection is what sells it; test by closing eyes and moving the seat |
| HRTF support varies by browser (Safari partial) | Speaker mode (stereo panning + crossfeed) is a first-class fallback; target Chrome/Firefox for the HRTF experience |
| Too loud / startle (kills the sleep goal) | Master limiter + per-source caps + 20 Hz smoothing; test at 3 a.m. |

## 14. Definition of done (v1)

Open the page (headphones on) → pick "home" and "downtown" on the map → choose
rear-left seat → Start. Rain is falling. You hear the engine inside the car,
rain on the windshield and roof, a siren muffled by a building two blocks away,
a car pass with Doppler from left to right — left and right are *real*.
The HUD fades. The ride loops forever. You can fall asleep.

## 15. Suggestions (beyond v1, in rough priority order)

1. **Seasons**: snow (have), autumn (falling leaves + dry-leaf rustle), spring
   (birds in clear weather), summer (crickets at night, heat shimmer).
2. **Ambient wildlife**: birds at dawn, crickets at night in low-density zones —
   quiet, panned, raytraced like everything else.
3. **Radio**: an optional very-quiet synthesized "radio" station (soft pads +
   faint station ID chime) you can tune between 3 presets; muting is one click.
4. **Arrival ambience**: engine cut-out, door open (whoosh + street sound
   rushes in un-muffled — the raytracer suddenly has no car shell), door close.
   A satisfying end-of-trip moment before loop-forever picks the next ride.
5. **Phone-call option**: a muffled, slightly delayed voice (babble, no words)
   from the driver seat — sells the interior acoustics hard.
```
