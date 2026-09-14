// engine.js — Web Audio foundation: AudioContext, master bus, soft limiter,
// per-category buses, two reverbs (cabin + outdoor), HRTF panner factory.
//
// Sleep-safe: everything routes through a soft-clip limiter with a low ceiling
// so nothing ever startles. Parameters are set with setTargetAtTime (no clicks).

/**
 * Create the audio engine.
 * Returns an object with buses, helpers, and lifecycle.
 */
export function createAudioEngine() {
  let ctx;
  let master, limiter, shaper, buses = {}, reverbs = {};
  let started = false;
  let softCurve = null, linearCurve = null;

  function makeImpulseResponse(ctx, seconds, decay, lowpass) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const ir = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (ch === 0 ? 1 : 0.9);
      }
    }
    return ir;
  }

  function init() {
    if (started) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    started = true;

    // Master: gain → soft limiter (waveshaper) → destination.
    master = ctx.createGain();
    master.gain.value = 0.7;

    const shaperNode = ctx.createWaveShaper();
    const k = 4; // softness
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 511.5) - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    shaperNode.curve = curve;
    shaperNode.oversample = '4x';
    shaper = shaperNode;
    softCurve = curve;
    // Identity curve = limiter bypassed (linear pass-through).
    linearCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) linearCurve[i] = (i / 511.5) - 1;

    // Safety ceiling.
    const ceiling = ctx.createGain();
    ceiling.gain.value = 0.8;

    master.connect(shaper);
    shaper.connect(ceiling);
    ceiling.connect(ctx.destination);

    // Buses.
    const busDefs = ['engine', 'road', 'rain', 'traffic', 'sfx', 'cabin', 'exterior'];
    for (const name of busDefs) {
      const g = ctx.createGain();
      g.gain.value = 1;
      g.connect(master);
      buses[name] = g;
    }

    // Reverbs: cabin (short, low-passed) + outdoor (long, street-canyon).
    const cabinConv = ctx.createConvolver();
    cabinConv.buffer = makeImpulseResponse(ctx, 0.3, 3.0, 0);
    const cabinLP = ctx.createBiquadFilter();
    cabinLP.type = 'lowpass';
    cabinLP.frequency.value = 2200;
    const cabinGain = ctx.createGain();
    cabinGain.gain.value = 0.25;
    cabinConv.connect(cabinLP);
    cabinLP.connect(cabinGain);
    cabinGain.connect(buses.cabin);
    reverbs.cabin = { conv: cabinConv, gain: cabinGain };

    const outdoorConv = ctx.createConvolver();
    outdoorConv.buffer = makeImpulseResponse(ctx, 1.6, 2.2, 0);
    const outdoorGain = ctx.createGain();
    outdoorGain.gain.value = 0.18;
    outdoorConv.connect(outdoorGain);
    outdoorGain.connect(buses.exterior);
    reverbs.outdoor = { conv: outdoorConv, gain: outdoorGain };
  }

  /** Create an HRTF (or stereo) panner. */
  function makePanner(mode) {
    if (mode === 'speakers') {
      const p = ctx.createStereoPanner();
      p.connect(buses.exterior);
      return {
        node: p,
        setPosition: (x, z) => {
          // crude: pan by x relative to listener (listener at 0)
          p.pan.setTargetAtTime(ctx.currentTime, Math.max(-1, Math.min(1, x / 10)), 0.05);
        },
        setListener: () => {},
      };
    }
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1;
    p.rolloffFactor = 1;
    p.maxDistance = 400;
    p.connect(buses.exterior);
    return {
      node: p,
      setPosition: (x, y, z) => {
        p.positionX.setTargetAtTime(x, ctx.currentTime, 0.05);
        p.positionY.setTargetAtTime(y ?? 1, ctx.currentTime, 0.05);
        p.positionZ.setTargetAtTime(z, ctx.currentTime, 0.05);
      },
      setListener: () => {},
    };
  }

  /** Set the listener pose (ear position + orientation). */
  function setListener(pos, forward, up, mode) {
    if (!ctx) return;
    const l = ctx.listener;
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.05);
      l.positionY.setTargetAtTime(pos.y, t, 0.05);
      l.positionZ.setTargetAtTime(pos.z, t, 0.05);
      l.forwardX.setTargetAtTime(forward.x, t, 0.05);
      l.forwardY.setTargetAtTime(forward.y, t, 0.05);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.05);
      l.upX.setTargetAtTime(up?.x ?? 0, t, 0.05);
      l.upY.setTargetAtTime(up?.y ?? 1, t, 0.05);
      l.upZ.setTargetAtTime(up?.z ?? 0, t, 0.05);
    } else if (l.setPosition) {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, up?.x ?? 0, up?.y ?? 1, up?.z ?? 0);
    }
  }

  function setMaster(v) {
    if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.1);
  }

  function setBus(name, v) {
    if (buses[name]) buses[name].gain.setTargetAtTime(v, ctx.currentTime, 0.1);
  }

  function setReverbSend(which, v) {
    if (reverbs[which]) reverbs[which].gain.gain.setTargetAtTime(v, ctx.currentTime, 0.1);
  }

  /** Live-apply the master limiter on/off (swap soft-clip vs linear curve). */
  function setLimiter(on) {
    if (shaper && (on ? softCurve : linearCurve)) {
      shaper.curve = on ? softCurve : linearCurve;
    }
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function dispose() {
    if (ctx) ctx.close();
    started = false;
  }

  return {
    init,
    get ctx() { return ctx; },
    get started() { return started; },
    buses,
    reverbs,
    makePanner,
    setListener,
    setMaster,
    setBus,
    setReverbSend,
    setLimiter,
    resume,
    dispose,
  };
}
