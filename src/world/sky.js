// sky.js — gradient skybox, fog, and time-of-day lighting (Three.js)
//
// A big inverted sphere with a vertical gradient shader, plus a directional
// "sun" light and ambient/hemisphere light. Fog is set on the scene.

import * as THREE from 'three';

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // push to far plane
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 midColor;
  uniform vec3 botColor;
  uniform vec3 sunDir;
  uniform float sunGlow;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(botColor, midColor, smoothstep(0.0, 0.5, h));
    col = mix(col, topColor, smoothstep(0.5, 1.0, h));
    // sun glow
    float s = max(0.0, dot(d, normalize(sunDir)));
    col += sunGlow * (pow(s, 220.0) * 1.2 + pow(s, 12.0) * 0.15);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * Create the sky system.
 * scene: THREE.Scene
 * Returns { update(lighting), setFog(density), dispose }.
 * lighting: { sunDir, sunIntensity, ambient, night, dusk, fogDensity }
 */
export function createSky(scene) {
  const uniforms = {
    topColor: { value: new THREE.Color(0x0a1430) },
    midColor: { value: new THREE.Color(0x1a2a50) },
    botColor: { value: new THREE.Color(0x2a3a55) },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunGlow: { value: 0.0 },
  };

  const geo = new THREE.SphereGeometry(4000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -1;
  scene.add(sky);

  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0x8899bb, 0x223344, 0.6);
  scene.add(hemi);

  const FOG_COLORS = {
    clear: new THREE.Color(0x9db4d0),
    overcast: new THREE.Color(0x8a94a0),
    rain: new THREE.Color(0x5a6470),
    snow: new THREE.Color(0xb8c4d0),
    fog: new THREE.Color(0x707a88),
    night: new THREE.Color(0x0a0e18),
  };

  function update(lighting, weather) {
    const { sunDir, sunIntensity, ambient, night, dusk } = lighting;
    sun.position.set(sunDir.x * 1000, sunDir.y * 1000, sunDir.z * 1000);
    sun.target.position.set(0, 0, 0);
    sun.intensity = sunIntensity * 1.6;
    sun.color.set(dusk ? 0xffb070 : 0xfff4e0);
    hemi.intensity = ambient;
    hemi.color.set(night ? 0x223355 : dusk ? 0xffa060 : 0x8899bb);
    hemi.groundColor.set(night ? 0x0a0e18 : 0x223344);

    // Sky gradient by time of day.
    if (night) {
      uniforms.topColor.value.set(0x050a18);
      uniforms.midColor.value.set(0x0a1430);
      uniforms.botColor.value.set(0x14203a);
      uniforms.sunGlow.value = 0.15; // moon-ish
    } else if (dusk) {
      uniforms.topColor.value.set(0x1a2a55);
      uniforms.midColor.value.set(0x6a4a6a);
      uniforms.botColor.value.set(0xd08050);
      uniforms.sunGlow.value = 0.9;
    } else {
      uniforms.topColor.value.set(0x3a6ab0);
      uniforms.midColor.value.set(0x7aa0d0);
      uniforms.botColor.value.set(0xbcd0e0);
      uniforms.sunGlow.value = 0.6;
    }
    // Weather darkens the sky.
    const dim = { clear: 1, overcast: 0.7, rain: 0.5, snow: 0.75, fog: 0.6 }[weather] ?? 1;
    uniforms.topColor.value.multiplyScalar(dim);
    uniforms.midColor.value.multiplyScalar(dim);
    uniforms.botColor.value.multiplyScalar(dim);

    uniforms.sunDir.value.set(sunDir.x, sunDir.y, sunDir.z);

    // Fog.
    const fogColor = night ? FOG_COLORS.night : FOG_COLORS[weather] || FOG_COLORS.clear;
    if (!scene.fog) scene.fog = new THREE.FogExp2(fogColor.getHex(), lighting.fogDensity);
    scene.fog.color.copy(fogColor);
    scene.fog.density = lighting.fogDensity;
    scene.background = null; // sky mesh handles the background
  }

  function dispose() {
    scene.remove(sky);
    geo.dispose();
    mat.dispose();
  }

  return { update, dispose };
}
