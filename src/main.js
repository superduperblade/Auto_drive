// main.js — boot, scene loop, and state. Wires the pure logic modules
// (driver, traffic, peds, incidents, weather, raytracer) to the Three.js
// scene and the Web Audio engine.

import * as THREE from 'three';
import {
  defaultConfig, sanitizeConfig, configFromUrl, resolveConfig, randomDestination,
} from './config.js';
import { makeGeo } from './lib/geo.js';
import { buildSpline, resamplePolyline } from './lib/spline.js';
import { generateCity } from './world/city.js';
import { createDriver } from './drive/driver.js';
import { createTraffic } from './world/traffic.js';
import { createPedestrians } from './world/pedestrians.js';
import { createIncidents } from './incidents/incidents.js';
import { createWeather, lightingAt, wiperPeriod } from './weather/weather.js';
import { buildGeometry, solveSource, localToWorld } from './audio/raytracer.js';
import { seatInfo, dbToGain } from './audio/seats.js';
import { toKmh, clamp } from './lib/math.js';

import { createAudioEngine } from './audio/engine.js';
import {
  createEngineSource, createRoadSource, createWindSource, createRainSources,
  createWiperSource, createTrafficPool, createSfx, createCabinMicro, createMusic,
} from './audio/sources.js';
import { createSky } from './world/sky.js';
import { createRoad, createSigns } from './world/road.js';
import { createCityMesh, createStreetlights, createCrosswalks } from './world/cityMesh.js';
import { createCar } from './world/car.js';
import { createVehicleRenderer } from './world/vehicles.js';
import { createRain } from './weather/rain.js';
import { createSetup } from './ui/setup.js';
import { createHud } from './ui/hud.js';
import { createOptions } from './ui/options.js';
import { createFreecam } from './ui/freecam.js';
import { fetchRoute } from './map/route.js';

// ── boot ───────────────────────────────────────────────────────────────────
const root = document.getElementById('app');
const fadeEl = document.getElementById('ad-fade');

let config = configFromUrl(window.location.href) || defaultConfig();
config = sanitizeConfig(config);

let pendingRoute = null;

const setup = createSetup(root, config, {
  onRouteReady: (route) => { pendingRoute = route; },
  onStart: (cfg) => startRide(cfg),
});

async function startRide(cfg) {
  // 1. Route.
  const geo = makeGeo(cfg.origin);
  const route = pendingRoute || await fetchRoute(cfg.origin, cfg.destination, geo);
  const routePts = route.points;

  // 2. Resolved config (concrete weather/traffic).
  const resolved = resolveConfig(cfg);

  // Mutable world handles — rebuilt when loop-forever picks a new destination.
  let spline, city, driver, traffic, peds, incidents, crosswalks = null;
  const weather = createWeather(resolved);

  // 4. Scene (WebGL). If WebGL is unavailable, fall back to headless mode
  //    (simulation + audio only, no 3D view).
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 4000);
  let renderer = null;
  let hasWebGL = true;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    document.body.appendChild(renderer.domElement);
  } catch (e) {
    hasWebGL = false;
    console.warn('[auto-drive] WebGL unavailable — running headless (sim + audio only).', e);
  }

  let scene = null, sky = null, road = null, cityMesh = null, lights = null, car = null, vehicles = null, rain = null, signs = null;
  if (hasWebGL) {
    scene = new THREE.Scene();
    sky = createSky(scene);
    car = createCar(cfg.misc.carColor, cfg.misc.carType);
    scene.add(car.group);
    vehicles = createVehicleRenderer(scene);
    rain = createRain(scene, camera);
    rain.setRenderer(renderer);
  }

  // Build (or rebuild) the world for a given route: spline, city, systems,
  // and the route-dependent 3D meshes (road, buildings, lights, crosswalks).
  // Called initially and again when loop-forever picks a new destination.
  function buildWorld(pts, destWorld) {
    spline = buildSpline(resamplePolyline(pts, 10));
    city = generateCity(pts, { seed: cfg.seed, destination: destWorld });
    driver = createDriver({ spline, obeyLimits: cfg.obeyLimits, style: cfg.style });
    traffic = createTraffic({ spline, city, trafficLevel: resolved.traffic, seed: cfg.seed });
    peds = createPedestrians({ city, spline, stopForPedestrians: cfg.stopForPedestrians, seed: cfg.seed });
    incidents = createIncidents({ spline, seed: cfg.seed, style: cfg.style });

    if (hasWebGL) {
      road?.dispose();
      cityMesh?.dispose();
      lights?.dispose();
      crosswalks?.dispose();
      signs?.dispose();
      road = createRoad(scene, spline);
      cityMesh = createCityMesh(scene, city);
      lights = createStreetlights(scene, city);
      crosswalks = createCrosswalks(scene, city.crossings.filter((c) => spline.nearest(c.x, c.z).dist < 60));
      signs = createSigns(scene, spline, city);
      signs.setSigns(cfg.visuals.signs);
    }
  }
  buildWorld(routePts, geo.toWorld(cfg.destination.lat, cfg.destination.lng));

  // 5. Audio.
  const eng = createAudioEngine();
  eng.init();
  eng.resume();
  const mode = cfg.audio.mode;
  const engineSrc = createEngineSource(eng, mode);
  const roadSrc = createRoadSource(eng, mode);
  const windSrc = createWindSource(eng, mode);
  const rainSrc = createRainSources(eng, mode);
  const wiperSrc = createWiperSource(eng, mode);
  const trafficPool = createTrafficPool(eng, mode, 12);
  const sfx = createSfx(eng, mode);
  const cabinMicro = createCabinMicro(eng, mode);
  const music = createMusic(eng, mode);
  music.setLevel(cfg.misc.music);
  cabinMicro.door(); // door-close one-shot on start

  // Debug hook: inspect the audio/sim state from the console.
  window.__ad = { eng, driver, traffic, weather, config: cfg };

  // 6. UI.
  const hud = createHud(cfg);
  const freecam = hasWebGL ? createFreecam(camera, renderer.domElement) : null;
  const options = createOptions(cfg, {
    apply: (key, value) => applyOption(key, value),
  });

  // 7. Tear down the setup screen + fade in.
  setup.destroy();
  if (!hasWebGL) {
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:30;background:#3a2a1a;color:#ffe8c8;padding:8px 16px;font:13px system-ui;text-align:center;';
    banner.textContent = 'WebGL unavailable — running headless (simulation + audio only, no 3D view).';
    document.body.appendChild(banner);
  }
  fadeEl.style.opacity = '1';
  requestAnimationFrame(() => { fadeEl.style.opacity = '0'; });

  // ── ride state ─────────────────────────────────────────────────────────
  const seat = seatInfo(cfg.seat);
  let lastT = performance.now();
  let audioAccum = 0;
  let idleT = 0;
  let arrived = false;

  function applyOption(key, value) {
    switch (key) {
      case 'master': eng.setMaster(value); break;
      case 'sleep': hud.setSleep(value); break;
      case 'camera':
        if (freecam) { if (value === 'freecam') freecam.enable(); else freecam.disable(); }
        break;
      case 'weather': weather.setWeather(value); break;
      case 'traffic': traffic.setLevel?.(value); break;
      case 'peds': peds.setYield?.(value); break;
      case 'timeOfDay': weather.setTimeOfDay(value); break;
      case 'loop': break; // cfg.loop is read live in the loop
      case 'audioMode': break; // applies to newly created panners (next trip) in v1
      case 'raytrace': break; // cfg.audio.raytrace is read live in audioTick
      case 'engineVol': eng.setBus('engine', value); break;
      case 'trafficVol': eng.setBus('traffic', value); break;
      case 'rainVol': eng.setBus('rain', value); break;
      case 'limiter': eng.setLimiter(value); break;
      case 'doppler': break; // cfg.audio.doppler is read live in the traffic pool
      case 'seatbelt': break; // cfg.audio.seatbelt is read live in cabinMicro
      case 'cabin': break; // cfg.audio.cabin is read live in cabinMicro
      case 'music': music?.setLevel(value); break;
      case 'rainDetail': rain?.setDetail(value); break;
      case 'lightGlow': cityMesh?.setGlow(value); break;
      case 'hudGlow': car?.setHudGlow(value); break;
      case 'hudFade': hud.setFade(value); break;
      case 'signs': signs?.setSigns(value); break;
      case 'carColor': car?.setColor(value); break;
      case 'carType': break; // applied on the next trip (mesh is built once)
      case 'obeyLimits': driver?.setObeyLimits(value); break;
      case 'style': driver?.setStyle(value); break
    }
  }

  function carPose() {
    const d = driver.state.d;
    const p = spline.posAt(d);
    const t = spline.tangentAt(d);
    const rx = -t.z, rz = t.x;
    return {
      pos: { x: p.x + rx * 1.75, y: 0, z: p.z + rz * 1.75 },
      heading: Math.atan2(t.z, t.x),
    };
  }

  function carVelocity() {
    const h = driver.state.heading;
    return { x: Math.cos(h) * driver.state.speed, y: 0, z: Math.sin(h) * driver.state.speed };
  }

  // Loop-forever: on arrival, pick a new destination near the origin and
  // rebuild the world (route, city, systems, 3D meshes) for the new trip.
  let restarting = false;
  async function restartWithNewDestination() {
    if (restarting) return;
    restarting = true;
    const newDest = randomDestination(cfg.origin, cfg.seed, Date.now() >>> 0);
    cfg.destination = newDest;
    try {
      const newRoute = await fetchRoute(cfg.origin, newDest, geo);
      buildWorld(newRoute.points, geo.toWorld(newDest.lat, newDest.lng));
      arrived = false;
      idleT = 0;
    } catch (e) {
      console.warn('[auto-drive] loop re-route failed, re-driving same route:', e?.message || e);
      arrived = false;
      driver.reset();
    } finally {
      restarting = false;
    }
  }

  function loop() {
    const now = performance.now();
    let dt = (now - lastT) / 1000;
    lastT = now;
    dt = clamp(dt, 0, 0.1);

    // Weather + clock.
    weather.update(dt);
    const wState = weather.state;
    const lighting = lightingAt(wState.clockHours, wState.weather);

    // Driver env.
    const zone = city.zoneAt(driver.state.pos.x, driver.state.pos.z);
    const trafficObs = traffic.obstacleInLane(driver.state.d, 'f0');
    const inc = incidents.update(dt, driver.state.d);
    const lanePos = (() => {
      const p = spline.posAt(driver.state.d);
      const t = spline.tangentAt(driver.state.d);
      return { x: p.x - t.z * 1.75, z: p.z + t.x * 1.75 };
    })();
    const yieldReq = peds.yieldRequest(lanePos);
    peds.update(dt, driver.state.pos);

    // Combine obstacles (nearest wins).
    let obstacle = null;
    for (const o of [trafficObs, inc.obstacle]) {
      if (o && (!obstacle || o.dist < obstacle.dist)) obstacle = o;
    }
    const braking = inc.braking || yieldReq.yield;

    if (!arrived) {
      driver.update(dt, { zoneLimitKmh: zone.limit, obstacle, braking });
      if (driver.state.arrived) {
        arrived = true;
        idleT = 0;
      }
    } else {
      idleT += dt;
      if (cfg.loop && idleT > 5) {
        restartWithNewDestination();
      }
    }

    traffic.update(dt, driver.state.d);

    // Incidents → SFX.
    for (const ev of inc.events) {
      if (ev.kind === 'honk') sfx.honk({ x: ev.pos.x, y: 1, z: ev.pos.z }, 0.25);
      if (ev.kind === 'impact') sfx.thunder({ x: ev.pos.x, y: 1, z: ev.pos.z }, 0.15);
      if (ev.kind === 'lorry-brake') sfx.airBrake({ x: ev.pos.x, y: 1, z: ev.pos.z }, 0.35);
    }
    if (inc.active?.type === 'siren') {
      const ev = inc.events.find((e) => e.kind === 'siren');
      if (ev) {
        if (!sfx._sirenOn) { sfx.sirenStart({ x: ev.pos.x, y: 1, z: ev.pos.z }); sfx._sirenOn = true; }
        sfx.sirenUpdate({ x: ev.pos.x, y: 1, z: ev.pos.z }, 0.2);
      }
    } else if (sfx._sirenOn) {
      sfx.sirenStop();
      sfx._sirenOn = false;
    }
    // Thunder.
    if (wState.thunder > 0.9) {
      sfx.thunder({ x: driver.state.pos.x + 100, y: 50, z: driver.state.pos.z + 100 }, 0.2 * wState.thunder);
      wState.thunder = 0;
    }

    // ── visuals (only when WebGL is available) ───────────────────────────
    const pose = carPose();
    if (hasWebGL) {
      car.group.position.set(pose.pos.x, 0, pose.pos.z);
      car.group.rotation.y = -pose.heading;
      car.setInteriorVisible(!freecam.active);
      vehicles.update(traffic.vehicles);

      sky.update(lighting, wState.weather);
      const night01 = lighting.night ? 1 : lighting.dusk ? 0.5 : 0;
      cityMesh.setNight(night01);
      lights.setNight(night01);
      road.setWetness(wState.wetness);

      rain.update(dt, {
        intensity: wState.intensity,
        weather: wState.weather,
        wiperPeriod: wiperPeriod(wState.intensity),
      });

      // Camera.
      if (!freecam.active) {
        const camPos = localToWorld({ x: seat.cam.x, y: seat.cam.y, z: seat.cam.z }, pose);
        camera.position.set(camPos.x, camPos.y, camPos.z);
        const fwd = { x: Math.cos(pose.heading), y: 0, z: Math.sin(pose.heading) };
        camera.lookAt(
          camera.position.x + fwd.x,
          camera.position.y + 0.1,
          camera.position.z + fwd.z,
        );
      } else {
        freecam.update(dt);
      }
    }

    // ── audio (20 Hz) ────────────────────────────────────────────────────
    audioAccum += dt;
    if (audioAccum >= 0.05) {
      audioTick(audioAccum);
      audioAccum = 0;
    }

    // HUD.
    const remaining = Math.max(0, spline.length - driver.state.d);
    const etaMin = driver.state.speed > 1 ? (remaining / driver.state.speed) / 60 : null;
    hud.update({
      speedKmh: toKmh(driver.state.speed),
      clockHours: wState.clockHours,
      etaMin,
      nextStreet: '',
      limitKmh: zone.limit,
    });

    if (hasWebGL) {
      renderer.render(scene, camera);
      // Windshield droplet overlay must be drawn after the scene render
      // (the scene render clears the color buffer).
      rain.renderOverlay();
    }
    requestAnimationFrame(loop);
  }

  function audioTick(dt) {
    const pose = carPose();
    const carPos3 = { x: pose.pos.x, y: 0.5, z: pose.pos.z };
    const carVel = carVelocity();
    const raytrace = cfg.audio.raytrace;

    // Cabin micro-sounds (A/C hum, seatbelt creaks).
    cabinMicro.update({
      ac: cfg.audio.cabin, seatbelt: cfg.audio.seatbelt,
      dt, pos: carPos3,
    });

    // Listener: the seat ear (in-car) or the freecam position (exterior).
    // Stepping out of the car with the freecam flips the acoustics: the
    // raytracer then treats the listener as outside and sources are heard
    // through the windows / body-leak / direct paths as appropriate.
    const fcPose = freecam && freecam.active ? freecam.getPose() : null;
    let ear, fwd, up;
    if (fcPose) {
      ear = fcPose.pos;
      fwd = fcPose.forward;
      up = fcPose.up;
    } else {
      ear = localToWorld(seat.ear, pose);
      fwd = { x: Math.cos(pose.heading), y: 0, z: Math.sin(pose.heading) };
      up = { x: 0, y: 1, z: 0 };
    }

    // Nearby geometry for the raytracer.
    const nearVeh = traffic.vehicles
      .filter((v) => Math.hypot(v.x - pose.pos.x, v.z - pose.pos.z) < 150)
      .map((v) => ({ pos: { x: v.x, z: v.z }, heading: v.heading, length: v.length, width: v.width, height: v.height }));
    const nearBld = city.buildings
      .filter((b) => Math.hypot(b.x - pose.pos.x, b.z - pose.pos.z) < 250)
      .map((b) => ({ x: b.x, z: b.z, w: b.w, d: b.d, h: b.h }));
    const geom = buildGeometry({ pos: carPos3, heading: pose.heading }, nearVeh, nearBld);
    const earInside = geom.inside(ear);

    eng.setListener(ear, fwd, up, cfg.audio.mode);

    const seatEng = dbToGain(seat.offsets.engine);
    const seatRoad = dbToGain(seat.offsets.road);

    // Engine (interior).
    const enginePos = localToWorld({ x: 0.5, y: 0.7, z: 0 }, pose);
    const e = solveSource({ pos: enginePos, vel: carVel, interior: true }, ear, geom, { raytrace, earInside: true });
    engineSrc.update({
      rpm: driver.state.rpm,
      gain: e.g1 * cfg.audio.engine * seatEng * (arrived ? 0.4 : 1),
      pos: e.pos, cutoff: e.c1, delayMs: e.delayMs,
      leakGain: e.g2, leakPos: carPos3,
      reverb: { cabin: 0.4 },
    });

    // Road + wind (interior, at the car).
    const r = solveSource({ pos: carPos3, vel: carVel, interior: true }, ear, geom, { raytrace, earInside: true });
    roadSrc.update({
      speed: driver.state.speed,
      gain: r.g1 * seatRoad,
      pos: r.pos, cutoff: r.c1, delayMs: r.delayMs,
      leakGain: r.g2, leakPos: carPos3, reverb: { cabin: 0.3 },
    });
    windSrc.update({
      speed: driver.state.speed,
      gain: r.g1,
      pos: r.pos, cutoff: r.c1, delayMs: r.delayMs,
      leakGain: r.g2, leakPos: carPos3, reverb: { cabin: 0.2, outdoor: 0.1 },
    });

    // Rain (3 layers at car positions).
    const wState = weather.state;
    if (wState.intensity > 0.02) {
      const ws = localToWorld({ x: 1.6, y: 1.3, z: 0 }, pose);
      const rf = localToWorld({ x: 0, y: 1.6, z: 0 }, pose);
      const gr = { x: pose.pos.x, y: 0.3, z: pose.pos.z };
      const sw = solveSource({ pos: ws, vel: carVel, interior: true }, ear, geom, { raytrace, earInside: true });
      const sr = solveSource({ pos: rf, vel: carVel, interior: true }, ear, geom, { raytrace, earInside: true });
      const sg = solveSource({ pos: gr, vel: carVel, interior: false }, ear, geom, { raytrace, earInside });
      rainSrc.update({
        intensity: wState.intensity,
        speed: driver.state.speed,
        dt,
        windshield: { g1: sw.g1, c1: sw.c1, pos: sw.pos, delayMs: sw.delayMs, g2: sw.g2, leakPos: carPos3 },
        roof: { g1: sr.g1, c1: sr.c1, pos: sr.pos, delayMs: sr.delayMs, g2: sr.g2, leakPos: carPos3 },
        ground: { g1: sg.g1, c1: sg.c1, pos: sg.pos, delayMs: sg.delayMs, g2: sg.g2, leakPos: carPos3 },
      });
    }

    // Wipers.
    const wp = wiperPeriod(wState.intensity);
    wiperSrc.update({
      active: wState.intensity > 0.2,
      period: wp,
      pos: localToWorld({ x: 1.6, y: 1.3, z: 0 }, pose),
      reverb: { cabin: 0.3 },
    });

    // Traffic (raytrace each, feed the pool).
    for (const v of traffic.vehicles) {
      const dist = Math.hypot(v.x - pose.pos.x, v.z - pose.pos.z);
      v._dist = dist;
      const lane = traffic.lanes.find((l) => l.id === v.lane);
      const arc = lane ? (lane.dir > 0 ? v.s : spline.length - v.s) : v.s;
      const t = spline.tangentAt(arc);
      const vel = lane ? { x: t.x * lane.dir * v.speed, y: 0, z: t.z * lane.dir * v.speed } : { x: 0, y: 0, z: 0 };
      v._audio = solveSource(
        { pos: { x: v.x, y: 1, z: v.z }, vel, interior: false },
        ear, geom, { raytrace, earInside, listenerVel: carVel },
      );
      v._audio.reverbCabin = v._audio.via === 'window' ? 0.2 : 0;
      v._audio.reverbOutdoor = v._audio.via === 'direct' ? 0.3 : (v._audio.via === 'window' ? 0.15 : 0);
      v._audio.leakPos = carPos3;
    }
    trafficPool.update(traffic.vehicles, dt, cfg.audio.doppler);

    // Siren raytraced gain.
    if (sfx._sirenOn) {
      // (gain handled by sirenUpdate)
    }
  }

  // Resize.
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    if (hasWebGL) renderer.setSize(window.innerWidth, window.innerHeight);
  });

  requestAnimationFrame(loop);
}
