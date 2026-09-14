// freecam.js — freecam orbit/zoom/pan controls. The raytracer's listener
// follows the camera, so stepping outside the car flips the acoustics.

import * as THREE from 'three';

/**
 * Create the freecam controller.
 * camera: THREE.PerspectiveCamera
 * dom: renderer.domElement
 * Returns {
 *   active: bool,
 *   enable(), disable(),
 *   getPose(): { pos, forward, up } — for the audio listener,
 *   update(dt): apply any inertia (no-op for direct control)
 * }.
 */
export function createFreecam(camera, dom) {
  let active = false;
  let target = new THREE.Vector3(0, 1, 0);
  let spherical = new THREE.Spherical(8, Math.PI / 3, 0);
  let dragging = false;
  let panning = false;
  let lastX = 0, lastY = 0;

  function onDown(e) {
    if (!active) return;
    if (e.button === 2) panning = true;
    else dragging = true;
    lastX = e.clientX; lastY = e.clientY;
    e.preventDefault();
  }
  function onMove(e) {
    if (!active) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (dragging) {
      spherical.theta -= dx * 0.005;
      spherical.phi = clamp(spherical.phi - dy * 0.005, 0.05, Math.PI - 0.05);
    } else if (panning) {
      // Pan in the camera's local plane.
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      target.addScaledVector(right, dx * 0.02 * spherical.radius / 8);
      target.addScaledVector(new THREE.Vector3(0, 1, 0), dy * 0.02 * spherical.radius / 8);
    }
  }
  function onUp() { dragging = false; panning = false; }
  function onWheel(e) {
    if (!active) return;
    spherical.radius = clamp(spherical.radius * (1 + e.deltaY * 0.001), 1, 200);
    e.preventDefault();
  }
  function onContext(e) { if (active) e.preventDefault(); }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function apply() {
    const sinPhi = Math.sin(spherical.phi);
    const offset = new THREE.Vector3(
      spherical.radius * sinPhi * Math.sin(spherical.theta),
      spherical.radius * Math.cos(spherical.phi),
      spherical.radius * sinPhi * Math.cos(spherical.theta),
    );
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
  }

  function enable() {
    active = true;
    // Initialize the orbit around the current camera target.
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    target.copy(camera.position).addScaledVector(dir, -8);
    spherical.radius = 8;
    dom.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    dom.addEventListener('wheel', onWheel, { passive: false });
    dom.addEventListener('contextmenu', onContext);
  }

  function disable() {
    active = false;
    dom.removeEventListener('mousedown', onDown);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    dom.removeEventListener('wheel', onWheel);
    dom.removeEventListener('contextmenu', onContext);
  }

  function getPose() {
    if (!active) return null;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    return {
      pos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      forward: { x: fwd.x, y: fwd.y, z: fwd.z },
      up: { x: 0, y: 1, z: 0 },
    };
  }

  function update() {
    if (active) apply();
  }

  return {
    get active() { return active; },
    enable, disable, getPose, update,
    destroy: disable,
  };
}
