// rain.js — rain/snow visuals: falling particle cloud + windshield droplet
// overlay (screen-space) + wiper sweep (Three.js + shader).
//
// The droplet overlay is a full-screen quad with a fragment shader that draws
// sliding droplets. Its intensity is driven by the same signal as the audio
// rain layer so visuals and sound never drift apart.

import * as THREE from 'three';

const DROPLET_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;   // 0..1
  uniform float uWiper;       // 0..1 wiper sweep position
  uniform vec2 uRes;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 uv = vUv;
    vec2 cell = vec2(48.0, 32.0);
    vec2 id = floor(uv * cell);
    float h = hash(id);
    // Only some cells have a droplet, scaled by intensity.
    if (h > uIntensity * 0.9) { discard; }
    vec2 f = fract(uv * cell);
    // Droplet slides down over time, speed varies.
    float speed = 0.15 + h * 0.5;
    float y = fract(f.y + uTime * speed * (0.5 + uIntensity));
    float x = f.x + sin(uTime * 0.5 + h * 6.28) * 0.05;
    float d = length(vec2(x - 0.5, y - 0.5));
    float r = 0.08 + h * 0.12;
    float drop = smoothstep(r, r * 0.3, d);
    // Wiper clears a wedge from the bottom.
    float wiperClear = smoothstep(uWiper - 0.15, uWiper + 0.05, uv.y) * 0.7;
    drop *= (1.0 - wiperClear * step(uv.y, 0.7));
    // Refraction-ish bright core.
    float core = smoothstep(r * 0.5, 0.0, d) * 0.5;
    float a = (drop * 0.35 + core) * uIntensity;
    gl_FragColor = vec4(vec3(0.8, 0.85, 0.95) * (drop * 0.5 + core), a);
  }
`;

/**
 * Create the rain system.
 * scene, camera: THREE
 * Returns {
 *   update(dt, { intensity, weather, wiperT }): advance + set visuals,
 *   setCamera(camera), dispose()
 * }.
 */
export function createRain(scene, camera) {
  // ── Falling particles ────────────────────────────────────────────────
  const COUNT = 2500;
  const positions = new Float32Array(COUNT * 3);
  const speeds = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 60;
    positions[i * 3 + 1] = Math.random() * 30;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
    speeds[i] = 8 + Math.random() * 10;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const pMat = new THREE.PointsMaterial({
    color: 0xaabbcc, size: 0.08, transparent: true, opacity: 0.5, depthWrite: false,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.visible = false;
  scene.add(points);

  // ── Windshield droplet overlay ───────────────────────────────────────
  const overlayScene = new THREE.Scene();
  const overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uWiper: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  };
  const oMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position,1.0); }`,
    fragmentShader: DROPLET_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const oQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), oMat);
  overlayScene.add(oQuad);

  let renderer;
  let wiperT = 0;
  let lastWiper = 0;
  let overlayActive = false;
  // Rain-on-glass detail: high=1.0, medium=0.6, low=0.3 (scales droplet density).
  let detailScale = 1.0;

  function setRenderer(r) { renderer = r; }

  /** Live-apply the rain-on-glass detail level (high/medium/low). */
  function setDetail(level) {
    detailScale = level === 'high' ? 1.0 : level === 'medium' ? 0.6 : 0.3;
  }

  function update(dt, { intensity, weather, wiperPeriod }) {
    const isRain = weather === 'rain';
    const isSnow = weather === 'snow';
    const active = (isRain || isSnow) && intensity > 0.02;
    points.visible = active;
    oMat.uniforms.uIntensity.value = isRain ? intensity * detailScale : 0;
    overlayActive = isRain && intensity > 0.02;
    uniforms.uTime.value += dt;

    // Wiper sweep (rain only).
    if (isRain && intensity > 0.05 && wiperPeriod) {
      wiperT += dt / wiperPeriod;
      if (wiperT >= 1) { wiperT -= 1; lastWiper = 0; }
      // Sweep: quick back-and-forth.
      const s = wiperT < 0.5 ? wiperT * 2 : (1 - wiperT) * 2;
      uniforms.uWiper.value = s;
    } else {
      uniforms.uWiper.value = 0;
    }

    // Move particles relative to the camera (so they fall around the car).
    if (active && points.visible) {
      const pos = pGeo.attributes.position;
      const camPos = camera.position;
      for (let i = 0; i < COUNT; i++) {
        let y = pos.array[i * 3 + 1] - speeds[i] * dt * (isSnow ? 0.3 : 1);
        if (y < 0) y += 30;
        pos.array[i * 3 + 1] = y;
        // Wrap around the camera.
        let x = pos.array[i * 3] - camPos.x;
        let z = pos.array[i * 3 + 2] - camPos.z;
        if (x > 30) x -= 60; else if (x < -30) x += 60;
        if (z > 30) z -= 60; else if (z < -30) z += 60;
        pos.array[i * 3] = x + camPos.x;
        pos.array[i * 3 + 2] = z + camPos.z;
      }
      pos.needsUpdate = true;
      pMat.opacity = isSnow ? 0.6 * intensity : 0.4 * intensity;
      pMat.size = isSnow ? 0.15 : 0.08;
      pMat.color.set(isSnow ? 0xffffff : 0xaabbcc);
    }
  }

  /** Render the droplet overlay on top of the scene. Must be called AFTER
   *  renderer.render(scene, camera) — the main render clears the color
   *  buffer, so drawing the overlay earlier would wipe it. */
  function renderOverlay() {
    if (!renderer || !overlayActive) return;
    renderer.autoClear = false;
    renderer.render(overlayScene, overlayCam);
    renderer.autoClear = true;
  }

  function dispose() {
    scene.remove(points);
    pGeo.dispose();
    pMat.dispose();
    oMat.dispose();
  }

  return { update, renderOverlay, setRenderer, setDetail, dispose };
}
