// vehicles.js — low-poly car/van/lorry meshes for traffic (Three.js)
//
// Each type is a cached prototype (geometry + materials) cloned per instance.
// The visual mesh matches the raytracing box size from traffic.js.

import * as THREE from 'three';
import { VEHICLE_TYPES } from './traffic.js';

const PALETTE = [0x7a4a3a, 0x3a5a7a, 0x5a5a5a, 0x8a8a8a, 0x2a4a3a, 0x6a3a5a, 0x4a4a5a];

function buildProto(type) {
  const spec = VEHICLE_TYPES[type];
  const group = new THREE.Group();
  const L = spec.length, W = spec.width, H = spec.height;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE[Math.floor(Math.random() * PALETTE.length)]),
    roughness: 0.5, metalness: 0.4,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x223344, roughness: 0.2, metalness: 0.7, transparent: true, opacity: 0.55,
  });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.9 });
  const lightMat = new THREE.MeshStandardMaterial({
    color: 0x111, emissive: 0xfff4d0, emissiveIntensity: 0.9,
  });

  // Body.
  const bodyH = type === 'lorry' ? H * 0.5 : H * 0.6;
  const body = new THREE.Mesh(new THREE.BoxGeometry(L, bodyH, W), bodyMat);
  body.position.y = bodyH / 2 + 0.3;
  group.add(body);

  // Cabin / cargo.
  if (type === 'lorry') {
    // Cab at the front.
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, H * 0.55, W), bodyMat);
    cab.position.set(L / 2 - 1.3, bodyH + 0.3 + H * 0.27, 0);
    group.add(cab);
    const cabGlass = new THREE.Mesh(new THREE.BoxGeometry(2.0, H * 0.4, W * 0.9), glassMat);
    cabGlass.position.set(L / 2 - 1.2, bodyH + 0.3 + H * 0.3, 0);
    group.add(cabGlass);
    // Cargo box.
    const cargo = new THREE.Mesh(
      new THREE.BoxGeometry(L - 2.8, H * 0.75, W * 0.98),
      new THREE.MeshStandardMaterial({ color: 0xbfc4cc, roughness: 0.7 }),
    );
    cargo.position.set(-1.2, bodyH + 0.3 + H * 0.37, 0);
    group.add(cargo);
  } else {
    const cabinLen = type === 'van' ? L * 0.7 : L * 0.55;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(cabinLen, H * 0.5, W * 0.92), bodyMat);
    cabin.position.set(type === 'van' ? 0 : -0.15, bodyH + 0.3 + H * 0.25, 0);
    group.add(cabin);
    const win = new THREE.Mesh(new THREE.BoxGeometry(cabinLen * 0.96, H * 0.4, W * 0.9), glassMat);
    win.position.copy(cabin.position);
    win.position.y += 0.02;
    group.add(win);
  }

  // Wheels.
  const wheelR = type === 'lorry' ? 0.5 : 0.35;
  const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.25, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wl = L / 2 - 0.7, wr = W / 2 - 0.05;
  const nWheels = type === 'lorry' ? 6 : 4;
  for (let i = 0; i < nWheels; i++) {
    const sx = type === 'lorry' ? (i < 3 ? -1 : 1) : i % 2 === 0 ? -1 : 1;
    const sz = i < (type === 'lorry' ? 3 : 2) ? -1 : 1;
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(sx * wl, wheelR, sz * wr);
    group.add(w);
  }

  // Headlights.
  for (const sz of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.25), lightMat);
    hl.position.set(L / 2 - 0.04, 0.6, sz * (W / 2 - 0.3));
    group.add(hl);
  }

  return group;
}

const protos = {};
function protoFor(type) {
  if (!protos[type]) protos[type] = buildProto(type);
  return protos[type];
}

/**
 * Create the traffic vehicle renderer.
 * scene: THREE.Scene
 * Returns {
 *   update(vehicles, dt): syncs meshes to the traffic state,
 *   dispose()
 * }.
 * vehicles: from traffic.js (array of { id, type, x, z, heading, ... }).
 */
export function createVehicleRenderer(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const byId = new Map();

  function ensure(veh) {
    let m = byId.get(veh.id);
    if (!m) {
      m = protoFor(veh.type).clone();
      m.userData.id = veh.id;
      group.add(m);
      byId.set(veh.id, m);
    }
    return m;
  }

  function update(vehicles) {
    const seen = new Set();
    for (const veh of vehicles) {
      seen.add(veh.id);
      const m = ensure(veh);
      m.position.set(veh.x, 0, veh.z);
      m.rotation.y = -veh.heading; // heading is atan2(z,x); mesh forward is +x
    }
    // Remove meshes for vehicles that were recycled.
    for (const [id, m] of byId) {
      if (!seen.has(id)) {
        group.remove(m);
        byId.delete(id);
      }
    }
  }

  function dispose() {
    scene.remove(group);
    byId.clear();
  }

  return { group, update, dispose };
}
