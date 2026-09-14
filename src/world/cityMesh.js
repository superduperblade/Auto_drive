// cityMesh.js — render the generated city: instanced buildings, streetlights,
// zebra crosswalks, and parked-car props (Three.js).
//
// Buildings use one InstancedMesh per facade bucket (few draw calls). Windows
// are faked with an emissive canvas texture that lights up at night.

import * as THREE from 'three';
import { FACADE_PALETTE } from './city.js';

function makeWindowTexture(variant, lit) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 16;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(0, 0, 8, 16);
  const rng = mulberry(variant * 97 + 13);
  for (let y = 1; y < 15; y += 2) {
    for (let x = 1; x < 7; x += 2) {
      const on = rng() < lit;
      ctx.fillStyle = on ? '#ffd98a' : '#141820';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create the city meshes.
 * scene: THREE.Scene
 * city: from generateCity
 * Returns { group, setNight(night01), dispose }.
 */
export function createCityMesh(scene, city) {
  const group = new THREE.Group();
  scene.add(group);

  const buildings = city.buildings;
  if (buildings.length) {
    // One InstancedMesh per facade bucket.
    const buckets = {};
    for (const b of buildings) {
      (buckets[b.bucket] = buckets[b.bucket] || []).push(b);
    }
    const dummy = new THREE.Object3D();
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const nightMats = [];
    for (const [bucket, list] of Object.entries(buckets)) {
      const col = FACADE_PALETTE[Number(bucket)];
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(col[0], col[1], col[2]),
        roughness: 0.9, metalness: 0.0,
        emissive: new THREE.Color(0xffd98a),
        emissiveIntensity: 0.0,
      });
      nightMats.push(mat);
      const mesh = new THREE.InstancedMesh(unitBox, mat, list.length);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        dummy.position.set(b.x, b.h / 2, b.z);
        dummy.scale.set(b.w, b.h, b.d);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }

    function setNight(n01) {
      for (const m of nightMats) m.emissiveIntensity = n01 * 0.55;
    }
    return { group, setNight, dispose: () => { scene.remove(group); } };
  }

  // No buildings (e.g. outskirts): still provide a no-op setNight.
  return { group, setNight: () => {}, dispose: () => { scene.remove(group); } };
}

/** Streetlights: emissive poles + fake light pools (cheap). */
export function createStreetlights(scene, city) {
  const group = new THREE.Group();
  scene.add(group);
  const poles = [];

  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 5, 5);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x333840, roughness: 0.8 });
  const headGeo = new THREE.SphereGeometry(0.25, 8, 6);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x222, emissive: 0xffd98a, emissiveIntensity: 1.0,
  });
  const poolGeo = new THREE.CircleGeometry(3.5, 16);
  const poolMat = new THREE.MeshBasicMaterial({
    color: 0xffd98a, transparent: true, opacity: 0.12, depthWrite: false,
  });

  for (const l of city.streetlights) {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(l.x, 2.5, l.z);
    group.add(pole);
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(l.x, 5, l.z);
    group.add(head);
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(l.x, 0.04, l.z);
    group.add(pool);
    poles.push({ head, pool });
  }

  let glowScale = 1.0; // streetlight glow on/off (live option)

  function setNight(n01) {
    for (const p of poles) {
      p.head.material.emissiveIntensity = (0.15 + n01 * 1.0) * glowScale;
      p.pool.material.opacity = (0.02 + n01 * 0.12) * glowScale;
    }
  }

  /** Live-apply the streetlight glow option (on/off). Applied on the next
   *  setNight() call (every frame). */
  function setGlow(on) {
    glowScale = on ? 1.0 : 0.25;
  }

  return { group, setNight, setGlow, dispose: () => { scene.remove(group); } };
}

/** Zebra crosswalks at the city's crossings near the route. */
export function createCrosswalks(scene, crossings) {
  const group = new THREE.Group();
  scene.add(group);
  const stripeGeo = new THREE.PlaneGeometry(0.6, 3.5);
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xd8d8d8 });
  for (const cr of crossings) {
    for (let i = -3; i <= 3; i++) {
      const s = new THREE.Mesh(stripeGeo, stripeMat);
      s.rotation.x = -Math.PI / 2;
      // orient along the crossing direction
      s.rotation.z = Math.atan2(cr.dir.x, cr.dir.z) + Math.PI / 2;
      s.position.set(
        cr.x + cr.dir.x * (i * 1.2),
        0.04,
        cr.z + cr.dir.z * (i * 1.2),
      );
      group.add(s);
    }
  }
  return { group, dispose: () => { scene.remove(group); } };
}
