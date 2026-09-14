// sources.js — procedural synth sources + per-source raytraced audio graph.
//
// Every source is a small WebAudio graph:
//   synth → [tap1: gain→filter→delay→panner] → bus (+ reverb send)
//          → [tap2: gain→filter→panner]      → bus (+ cabin reverb send)
// tap1 = the primary path (window / direct / interior), tap2 = the body-leak
// bed. Parameters come from the raytracer at 20 Hz and are smoothed with
// setTargetAtTime so there are no clicks.

import { engineFreqForRpm } from '../drive/driver.js';

// ── noise helpers ──────────────────────────────────────────────────────────
function makeNoiseBuffer(ctx, type) {
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  if (type === 'white') {
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  } else if (type === 'brown') {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5;
    }
  } else { // pink
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99336 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      data[i] = (b0 + b1 + b2 + w * 0.5362) * 0.11;
    }
  }
  return buf;
}

function makeNoiseSource(ctx, type) {
  const src = ctx.createBufferSource();
  src.buffer = makeNoiseBuffer(ctx, type);
  src.loop = true;
  return src;
}

// ── two-tap graph ──────────────────────────────────────────────────────────
function makeTwoTap(eng, mode, busName = 'exterior') {
  const ctx = eng.ctx;
  const input = ctx.createGain();
  input.gain.value = 1;

  // Tap 1 (primary path).
  const g1 = ctx.createGain(); g1.gain.value = 0;
  const f1 = ctx.createBiquadFilter(); f1.type = 'lowpass'; f1.frequency.value = 16000; f1.Q.value = 0.7;
  const d1 = ctx.createDelay(2.0); d1.delayTime.value = 0;
  const p1 = eng.makePanner(mode);
  input.connect(g1); g1.connect(f1); f1.connect(d1); d1.connect(p1.node);
  const send1a = ctx.createGain(); send1a.gain.value = 0; // → outdoor
  const send1b = ctx.createGain(); send1b.gain.value = 0; // → cabin
  p1.node.connect(send1a); send1a.connect(eng.reverbs.outdoor.conv);
  p1.node.connect(send1b); send1b.connect(eng.reverbs.cabin.conv);
  // Dry (direct) path → category bus. Without this the source is only
  // heard through the reverb sends (muffled, ~10% level).
  const dry1 = ctx.createGain(); dry1.gain.value = 1;
  p1.node.connect(dry1); dry1.connect(eng.buses[busName]);

  // Tap 2 (body-leak bed).
  const g2 = ctx.createGain(); g2.gain.value = 0;
  const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 800; f2.Q.value = 0.5;
  const p2 = eng.makePanner(mode);
  input.connect(g2); g2.connect(f2); f2.connect(p2.node);
  const send2 = ctx.createGain(); send2.gain.value = 0; // → cabin
  p2.node.connect(send2); send2.connect(eng.reverbs.cabin.conv);
  const dry2 = ctx.createGain(); dry2.gain.value = 1;
  p2.node.connect(dry2); dry2.connect(eng.buses[busName]);

  return {
    input,
    panner1: p1,
    setPrimary(g, cutoff, pos, delayMs) {
      const now = ctx.currentTime;
      g1.gain.setTargetAtTime(Math.max(0, g), now, 0.06);
      f1.frequency.setTargetAtTime(Math.max(40, cutoff), now, 0.06);
      d1.delayTime.setTargetAtTime(Math.min(1.5, (delayMs || 0) / 1000), now, 0.06);
      p1.setPosition(pos.x, pos.y, pos.z);
    },
    setLeak(g, pos) {
      const now = ctx.currentTime;
      g2.gain.setTargetAtTime(Math.max(0, g), now, 0.06);
      p2.setPosition(pos.x, pos.y, pos.z);
    },
    setReverb(cabin, outdoor) {
      const now = ctx.currentTime;
      send1b.gain.setTargetAtTime(cabin, now, 0.06);
      send1a.gain.setTargetAtTime(outdoor, now, 0.06);
      send2.gain.setTargetAtTime(cabin, now, 0.06);
    },
  };
}

// ── fixed sources ──────────────────────────────────────────────────────────

/** Own engine: 3 detuned saws + sub + brown noise, low-passed. */
export function createEngineSource(eng, mode) {
  const ctx = eng.ctx;
  const tap = makeTwoTap(eng, mode, 'engine');
  const osc1 = ctx.createOscillator(); osc1.type = 'sawtooth';
  const osc2 = ctx.createOscillator(); osc2.type = 'sawtooth'; osc2.detune.value = 9;
  const osc3 = ctx.createOscillator(); osc3.type = 'sawtooth'; osc3.detune.value = -9;
  const sub = ctx.createOscillator(); sub.type = 'sine';
  const noise = makeNoiseSource(ctx, 'brown');
  const noiseGain = ctx.createGain(); noiseGain.gain.value = 0.12;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 0.8;
  const subBoost = ctx.createBiquadFilter(); subBoost.type = 'lowshelf'; subBoost.frequency.value = 100; subBoost.gain.value = 6;

  for (const o of [osc1, osc2, osc3, sub, noise]) o.start();
  const mix = ctx.createGain(); mix.gain.value = 1;
  osc1.connect(mix); osc2.connect(mix); osc3.connect(mix);
  sub.connect(mix); noise.connect(noiseGain); noiseGain.connect(mix);
  mix.connect(lp); lp.connect(subBoost); subBoost.connect(tap.input);

  function update({ rpm, gain, pos, cutoff, delayMs, leakGain, leakPos, reverb }) {
    const f = engineFreqForRpm(rpm);
    const now = ctx.currentTime;
    osc1.frequency.setTargetAtTime(f, now, 0.05);
    osc2.frequency.setTargetAtTime(f, now, 0.05);
    osc3.frequency.setTargetAtTime(f * 1.005, now, 0.05);
    sub.frequency.setTargetAtTime(f / 2, now, 0.05);
    lp.frequency.setTargetAtTime(180 + rpm * 0.18, now, 0.05);
    tap.setPrimary(gain, cutoff, pos, delayMs);
    tap.setLeak(leakGain, leakPos);
    tap.setReverb(reverb?.cabin ?? 0.3, reverb?.outdoor ?? 0);
  }

  return { update, dispose: () => { for (const o of [osc1, osc2, osc3, sub, noise]) o.stop(); } };
}

/** Road/wheel: filtered brown noise, cutoff ∝ speed. */
export function createRoadSource(eng, mode) {
  const ctx = eng.ctx;
  const tap = makeTwoTap(eng, mode, 'road');
  const noise = makeNoiseSource(ctx, 'brown');
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
  const g = ctx.createGain(); g.gain.value = 0.5;
  noise.start();
  noise.connect(lp); lp.connect(g); g.connect(tap.input);

  function update({ speed, gain, pos, cutoff, delayMs, leakGain, leakPos, reverb }) {
    const now = ctx.currentTime;
    lp.frequency.setTargetAtTime(200 + speed * 60, now, 0.08);
    g.gain.setTargetAtTime(0.3 + (speed / 30) * 0.7, now, 0.08);
    tap.setPrimary(gain, cutoff, pos, delayMs);
    tap.setLeak(leakGain, leakPos);
    tap.setReverb(reverb?.cabin ?? 0.2, reverb?.outdoor ?? 0);
  }
  return { update, dispose: () => noise.stop() };
}

/** Wind: filtered white noise, gain ∝ speed², slow gusts. */
export function createWindSource(eng, mode) {
  const ctx = eng.ctx;
  const tap = makeTwoTap(eng, mode, 'road');
  const noise = makeNoiseSource(ctx, 'white');
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.6;
  const g = ctx.createGain(); g.gain.value = 0;
  // Gusts modulate a *multiplicative* gain so they can't pump the wind
  // audible when the base gain is 0 (e.g. at idle).
  const gust = ctx.createGain(); gust.gain.value = 1;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.15;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.3;
  lfo.connect(lfoGain); lfoGain.connect(gust.gain);
  noise.start(); lfo.start();
  noise.connect(bp); bp.connect(g); g.connect(gust); gust.connect(tap.input);

  function update({ speed, gain, pos, cutoff, delayMs, leakGain, leakPos, reverb }) {
    const now = ctx.currentTime;
    const base = Math.pow(speed / 30, 2) * 0.5;
    g.gain.setTargetAtTime(base, now, 0.15);
    bp.frequency.setTargetAtTime(400 + speed * 30, now, 0.15);
    tap.setPrimary(gain, cutoff, pos, delayMs);
    tap.setLeak(leakGain, leakPos);
    tap.setReverb(reverb?.cabin ?? 0.1, reverb?.outdoor ?? 0.1);
  }
  return { update, dispose: () => { noise.stop(); lfo.stop(); } };
}

/** Rain: three layers (windshield shush + droplets, roof, ground). */
export function createRainSources(eng, mode) {
  const ctx = eng.ctx;

  function layer(type, baseGain) {
    const tap = makeTwoTap(eng, mode, 'rain');
    const noise = makeNoiseSource(ctx, type);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0;
    noise.start();
    noise.connect(bp); bp.connect(g); g.connect(tap.input);
    return { tap, g, bp };
  }

  const windshield = layer('pink', 0.5);
  windshield.bp.frequency.value = 3000;
  const roof = layer('pink', 0.4);
  roof.bp.frequency.value = 1800;
  const ground = layer('brown', 0.3);
  ground.bp.frequency.value = 1200;

  // Droplet transients (windshield): random bandpass blips.
  const dropGain = ctx.createGain(); dropGain.gain.value = 0;
  const dropFilter = ctx.createBiquadFilter(); dropFilter.type = 'bandpass'; dropFilter.frequency.value = 4000; dropFilter.Q.value = 8;
  const dropNoise = makeNoiseSource(ctx, 'white');
  dropNoise.start();
  dropNoise.connect(dropFilter); dropFilter.connect(dropGain); dropGain.connect(windshield.tap.input);

  let dropTimer = 0;

  function update({ intensity, speed, windshield: w, roof: r, ground: gnd, dt }) {
    const now = ctx.currentTime;
    windshield.g.gain.setTargetAtTime(intensity * 0.5, now, 0.1);
    roof.g.gain.setTargetAtTime(intensity * 0.2, now, 0.1);
    ground.g.gain.setTargetAtTime(intensity * 0.3 * Math.min(1, speed / 8), now, 0.1);
    // Droplet blip rate ∝ intensity.
    const rate = 20 + intensity * 60;
    dropTimer -= dt;
    if (dropTimer <= 0 && intensity > 0.05) {
      dropGain.gain.cancelScheduledValues(now);
      dropGain.gain.setTargetAtTime(intensity * 0.15, now, 0.005);
      dropGain.gain.setTargetAtTime(0, now + 0.01, 0.01);
      dropTimer = 1 / rate;
    }
    // Apply raytraced params to each layer (same solve, different gains).
    windshield.tap.setPrimary(w.g1, w.c1, w.pos, w.delayMs);
    windshield.tap.setLeak(w.g2, w.leakPos);
    windshield.tap.setReverb(0.4, 0.1);
    roof.tap.setPrimary(r.g1, r.c1, r.pos, r.delayMs);
    roof.tap.setLeak(r.g2, r.leakPos);
    roof.tap.setReverb(0.4, 0.1);
    ground.tap.setPrimary(gnd.g1, gnd.c1, gnd.pos, gnd.delayMs);
    ground.tap.setLeak(gnd.g2, gnd.leakPos);
    ground.tap.setReverb(0.2, 0.2);
  }

  return { update, dispose: () => { windshield.g.disconnect(); } };
}

/** Wipers: rhythmic filtered-noise whoosh. */
export function createWiperSource(eng, mode) {
  const ctx = eng.ctx;
  const tap = makeTwoTap(eng, mode, 'rain');
  const noise = makeNoiseSource(ctx, 'pink');
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.2;
  const g = ctx.createGain(); g.gain.value = 0;
  noise.start();
  noise.connect(bp); bp.connect(g); g.connect(tap.input);

  function update({ active, period, pos, reverb }) {
    const now = ctx.currentTime;
    if (active && period) {
      // One whoosh per period: ramp up then down.
      const t = now % period;
      const env = Math.sin((t / period) * Math.PI) * 0.25;
      g.gain.setTargetAtTime(env, now, 0.03);
    } else {
      g.gain.setTargetAtTime(0, now, 0.1);
    }
    tap.setPrimary(1, 1600, pos, 0);
    tap.setLeak(0, pos);
    tap.setReverb(reverb?.cabin ?? 0.3, 0);
  }
  return { update, dispose: () => noise.stop() };
}

// ── traffic pool ───────────────────────────────────────────────────────────
const TRAFFIC_SYNTH = {
  car: { osc: 0.5, noise: 0.3, freq: 90, lp: 900 },
  van: { osc: 0.4, noise: 0.4, freq: 70, lp: 700 },
  lorry: { osc: 0.6, noise: 0.5, freq: 45, lp: 400 },
};

/**
 * A pool of N traffic-vehicle sources. Each tick, the nearest vehicles are
 * assigned to pool slots; the rest are muted.
 */
export function createTrafficPool(eng, mode, size = 12) {
  const ctx = eng.ctx;
  const pool = [];
  for (let i = 0; i < size; i++) {
    const tap = makeTwoTap(eng, mode, 'traffic');
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 80;
    const osc2 = ctx.createOscillator(); osc2.type = 'sawtooth'; osc2.frequency.value = 40; osc2.detune.value = 6;
    const noise = makeNoiseSource(ctx, 'brown');
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800;
    const mix = ctx.createGain(); mix.gain.value = 1;
    const og = ctx.createGain(); og.gain.value = 0.5;
    const ng = ctx.createGain(); ng.gain.value = 0.3;
    osc.connect(og); og.connect(mix);
    osc2.connect(og);
    noise.connect(ng); ng.connect(mix);
    mix.connect(lp); lp.connect(tap.input);
    osc.start(); osc2.start(); noise.start();
    pool.push({ tap, osc, osc2, noise, lp, og, ng, active: false, type: 'car' });
  }

  function update(vehicles, dt, doppler = true) {
    // Sort by distance (nearest first) and assign to the pool.
    const sorted = vehicles.slice().sort((a, b) => a._dist - b._dist);
    for (let i = 0; i < pool.length; i++) {
      const slot = pool[i];
      const veh = sorted[i];
      if (!veh || veh._dist > 150) {
        slot.tap.setPrimary(0, 800, { x: 0, y: 0, z: 0 }, 0);
        slot.active = false;
        continue;
      }
      slot.active = true;
      const spec = TRAFFIC_SYNTH[veh.type] || TRAFFIC_SYNTH.car;
      // Engine pitch: lorries low, cars higher; scales with speed. Doppler
      // (radial-velocity pitch shift from the raytracer) is optional.
      const a = veh._audio;
      const rate = doppler ? (a.rate || 1) : 1;
      const f = spec.freq * (0.7 + (veh.speed / 30) * 0.6) * rate;
      const now = ctx.currentTime;
      slot.osc.frequency.setTargetAtTime(f, now, 0.08);
      slot.osc2.frequency.setTargetAtTime(f / 2, now, 0.08);
      slot.lp.frequency.setTargetAtTime(spec.lp + veh.speed * 20, now, 0.08);
      slot.og.gain.setTargetAtTime(spec.osc, now, 0.08);
      slot.ng.gain.setTargetAtTime(spec.noise * (0.5 + veh.speed / 30), now, 0.08);
      // Raytraced params (precomputed on veh._audio).
      slot.tap.setPrimary(a.g1, a.c1, a.pos, a.delayMs);
      slot.tap.setLeak(a.g2, a.leakPos);
      slot.tap.setReverb(a.reverbCabin, a.reverbOutdoor);
    }
  }

  function dispose() {
    for (const s of pool) { s.osc.stop(); s.osc2.stop(); s.noise.stop(); }
  }

  return { update, dispose };
}

// ── one-shots + special sources ────────────────────────────────────────────

function makeHornBuffer(ctx) {
  const len = Math.floor(ctx.sampleRate * 0.6);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    const f = t < 0.3 ? 400 : 320;
    const env = Math.min(1, t * 20) * Math.min(1, (0.6 - t) * 10);
    data[i] = (Math.sign(Math.sin(2 * Math.PI * f * t))) * env * 0.3;
  }
  return buf;
}

function makeSirenBuffer(ctx) {
  const len = Math.floor(ctx.sampleRate * 1.6);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    const f = 700 + 300 * Math.sin(2 * Math.PI * 0.6 * t);
    data[i] = Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.25;
  }
  return buf;
}

function makeThunderBuffer(ctx) {
  const len = Math.floor(ctx.sampleRate * 3);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    const w = Math.random() * 2 - 1;
    last = (last + 0.05 * w) / 1.05;
    const env = Math.pow(1 - t / 3, 2) * (t < 0.3 ? t / 0.3 : 1);
    data[i] = last * 4 * env;
  }
  return buf;
}

// Lorry air-brake: a high-frequency hiss with a fast attack and ~1 s decay.
function makeAirBrakeBuffer(ctx) {
  const len = Math.floor(ctx.sampleRate * 1.2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    const w = Math.random() * 2 - 1; // white noise (hiss)
    // Fast attack (5 ms), long exponential decay.
    const env = Math.min(1, t / 0.005) * Math.exp(-t * 4);
    data[i] = w * env * 0.5;
  }
  return buf;
}

/**
 * SFX manager: horns, sirens, thunder, wiper one-shots.
 */
export function createSfx(eng, mode) {
  const ctx = eng.ctx;
  const hornBuf = makeHornBuffer(ctx);
  const sirenBuf = makeSirenBuffer(ctx);
  const thunderBuf = makeThunderBuffer(ctx);
  const airBrakeBuf = makeAirBrakeBuffer(ctx);

  let sirenSrc = null, sirenGain = null, sirenPanner = null;

  function playBuffer(buf, pos, gain, panPos) {
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = gain;
    const p = eng.makePanner(mode);
    src.connect(g); g.connect(p.node);
    p.setPosition(panPos.x, panPos.y, panPos.z);
    src.start();
    src.onended = () => { src.disconnect(); g.disconnect(); p.node.disconnect(); };
  }

  function honk(pos, gain = 0.3) {
    playBuffer(hornBuf, pos, gain, pos);
  }

  function thunder(pos, gain = 0.25) {
    playBuffer(thunderBuf, pos, gain, pos);
  }

  function airBrake(pos, gain = 0.35) {
    playBuffer(airBrakeBuf, pos, gain, pos);
  }

  function sirenStart(pos) {
    sirenStop();
    sirenSrc = ctx.createBufferSource(); sirenSrc.buffer = sirenBuf; sirenSrc.loop = true;
    sirenGain = ctx.createGain(); sirenGain.gain.value = 0.2;
    sirenPanner = eng.makePanner(mode);
    sirenSrc.connect(sirenGain); sirenGain.connect(sirenPanner.node);
    sirenPanner.setPosition(pos.x, pos.y, pos.z);
    sirenSrc.start();
  }

  function sirenUpdate(pos, gain) {
    if (sirenSrc && sirenPanner) {
      sirenPanner.setPosition(pos.x, pos.y, pos.z);
      sirenGain.gain.setTargetAtTime(gain, ctx.currentTime, 0.1);
    }
  }

  function sirenStop() {
    if (sirenSrc) {
      try { sirenSrc.stop(); } catch { /* already stopped */ }
      sirenSrc.disconnect(); sirenGain?.disconnect(); sirenPanner?.node.disconnect();
      sirenSrc = null;
    }
  }

  return { honk, thunder, airBrake, sirenStart, sirenUpdate, sirenStop, dispose: sirenStop };
}

// ── cabin micro-sounds (A/C hum, seatbelt creaks, door close) ─────────────
function makeCreakBuffer(ctx) {
  const len = Math.floor(ctx.sampleRate * 0.25);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    // A short, high, gritty creak: filtered noise with a fast wobble.
    const w = Math.random() * 2 - 1;
    const env = Math.min(1, t * 40) * Math.exp(-t * 12);
    data[i] = w * Math.sin(2 * Math.PI * (1800 + 400 * Math.sin(t * 60)) * t) * env * 0.15;
  }
  return buf;
}

function makeDoorBuffer(ctx) {
  const len = Math.floor(ctx.sampleRate * 0.4);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / ctx.sampleRate;
    const thump = Math.exp(-t * 20) * Math.sin(2 * Math.PI * 90 * t);
    const whoosh = (Math.random() * 2 - 1) * Math.exp(-t * 8) * 0.3;
    data[i] = (thump * 0.4 + whoosh) * 0.5;
  }
  return buf;
}

/**
 * Cabin micro-sounds: a very quiet A/C hum (continuous) + rare seatbelt creaks
 * + a door-close one-shot on start. Toggled live (seatbelt / cabin options).
 * Returns { update({ ac, seatbelt }), creak(), door(), dispose }.
 */
export function createCabinMicro(eng, mode) {
  const ctx = eng.ctx;
  const creakBuf = makeCreakBuffer(ctx);
  const doorBuf = makeDoorBuffer(ctx);

  // A/C hum: two very quiet detuned sines + a slow LFO.
  const ac1 = ctx.createOscillator(); ac1.type = 'sine'; ac1.frequency.value = 120;
  const ac2 = ctx.createOscillator(); ac2.type = 'sine'; ac2.frequency.value = 121.5;
  const acGain = ctx.createGain(); acGain.gain.value = 0;
  const acLfo = ctx.createOscillator(); acLfo.frequency.value = 0.3;
  const acLfoGain = ctx.createGain(); acLfoGain.gain.value = 0.002;
  acLfo.connect(acLfoGain); acLfoGain.connect(acGain.gain);
  ac1.connect(acGain); ac2.connect(acGain);
  const acPanner = eng.makePanner(mode);
  acGain.connect(acPanner.node);
  ac1.start(); ac2.start(); acLfo.start();

  let seatbeltOn = true;
  let nextCreak = 20 + Math.random() * 40; // 20–60 s
  let creakT = 0;

  function creak() {
    const src = ctx.createBufferSource(); src.buffer = creakBuf;
    const g = ctx.createGain(); g.gain.value = 0.05;
    const p = eng.makePanner(mode);
    src.connect(g); g.connect(p.node);
    p.setPosition(0.6, 1.0, 0.3);
    src.start();
    src.onended = () => { src.disconnect(); g.disconnect(); p.node.disconnect(); };
  }

  function door() {
    const src = ctx.createBufferSource(); src.buffer = doorBuf;
    const g = ctx.createGain(); g.gain.value = 0.2;
    const p = eng.makePanner(mode);
    src.connect(g); g.connect(p.node);
    p.setPosition(0.5, 0.8, 0.4);
    src.start();
    src.onended = () => { src.disconnect(); g.disconnect(); p.node.disconnect(); };
  }

  function update({ ac = true, seatbelt = true, dt = 0.05, pos = { x: 0, y: 1, z: 0 } } = {}) {
    seatbeltOn = seatbelt;
    acGain.gain.setTargetAtTime(ac ? 0.006 : 0, ctx.currentTime, 0.3);
    acPanner.setPosition(pos.x, pos.y, pos.z);
    // Rare seatbelt creaks.
    if (seatbeltOn) {
      creakT += dt;
      if (creakT > nextCreak) {
        creakT = 0;
        nextCreak = 25 + Math.random() * 45;
        creak();
      }
    }
  }

  function dispose() {
    try { ac1.stop(); ac2.stop(); acLfo.stop(); } catch { /* already stopped */ }
  }

  return { update, creak, door, dispose };
}

// ── ambient music layer (very quiet pads) ─────────────────────────────────
/**
 * A very-quiet ambient music bed (soft detuned pads). Off by default;
 * 'very-quiet' enables it at a low level. Toggled live.
 * Returns { setLevel(v), dispose }.
 */
export function createMusic(eng, mode) {
  const ctx = eng.ctx;
  const master = ctx.createGain(); master.gain.value = 0;
  master.connect(eng.buses.sfx);
  // A few detuned sines forming a soft pad (Am: A2, C3, E3, A3).
  const freqs = [110, 130.8, 164.8, 220];
  const oscs = freqs.map((f, i) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    o.detune.value = (i - 1.5) * 4;
    const g = ctx.createGain(); g.gain.value = 0.25;
    o.connect(g); g.connect(master);
    o.start();
    return o;
  });
  // Slow LFO for gentle movement.
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.1;
  lfo.connect(lfoGain); lfoGain.connect(master.gain);
  lfo.start();

  function setLevel(v) {
    master.gain.setTargetAtTime(v === 'very-quiet' ? 0.03 : 0, ctx.currentTime, 1.0);
  }

  function dispose() {
    for (const o of oscs) { try { o.stop(); } catch { /* already stopped */ } }
    try { lfo.stop(); } catch { /* already stopped */ }
  }

  return { setLevel, dispose };
}
