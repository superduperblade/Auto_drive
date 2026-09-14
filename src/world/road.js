// road.js — road mesh from the route polyline (lanes, centerline, curbs)
//
// Builds a flat ribbon along the spline with a dashed centerline and edge
// lines, plus a wide ground plane. Crosswalk stripes are added at crossings.

import * as THREE from 'three';

const ROAD_W = 8; // full width (2 lanes each direction is overkill; use 1+1)
const LANES = 2; // one per direction

/**
 * Create the road.
 * scene: THREE.Scene
 * spline: from buildSpline
 * Returns { group, updateCar? , dispose }.
 */
export function createRoad(scene, spline) {
  const group = new THREE.Group();
  scene.add(group);

  const pts = spline.points;
  const n = pts.length;

  // Build the road ribbon: for each sample, left/right edge points.
  const roadVerts = [];
  const roadUv = [];
  const roadIdx = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const t = spline.tangentAt(i * (spline.length / (n - 1)));
    const rx = -t.z, rz = t.x; // right perpendicular
    const half = ROAD_W / 2;
    roadVerts.push(p.x + rx * half, 0.02, p.z + rz * half);
    roadVerts.push(p.x - rx * half, 0.02, p.z - rz * half);
    const u = 0, v = i * 0.5;
    roadUv.push(u, v, 1, v);
    if (i < n - 1) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      roadIdx.push(a, c, b, b, c, d);
    }
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadVerts, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUv, 2));
  roadGeo.setIndex(roadIdx);
  roadGeo.computeVertexNormals();
  const roadMat = new THREE.MeshStandardMaterial({
    color: 0x2a2d33, roughness: 0.95, metalness: 0.0,
  });
  const road = new THREE.Mesh(roadGeo, roadMat);
  group.add(road);

  // Wetness: darkens the asphalt and lowers roughness (wet sheen) after rain.
  const DRY = { color: 0x2a2d33, roughness: 0.95, metalness: 0.0 };
  const WET = { color: 0x17191d, roughness: 0.35, metalness: 0.35 };
  const cDry = new THREE.Color(DRY.color);
  const cWet = new THREE.Color(WET.color);
  function setWetness(v) {
    const t = Math.max(0, Math.min(1, v));
    roadMat.color.copy(cDry).lerp(cWet, t);
    roadMat.roughness = DRY.roughness + (WET.roughness - DRY.roughness) * t;
    roadMat.metalness = DRY.metalness + (WET.metalness - DRY.metalness) * t;
  }

  // Centerline dashes: thin quads every 4 m.
  const dashVerts = [];
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8d2a0 });
  const dashGeo = new THREE.BufferGeometry();
  for (let d = 2; d < spline.length - 2; d += 8) {
    const p = spline.posAt(d);
    const t = spline.tangentAt(d);
    const rx = -t.z, rz = t.x;
    const len = 3;
    const w = 0.15;
    const p1 = spline.posAt(d - len / 2), p2 = spline.posAt(d + len / 2);
    const t1 = spline.tangentAt(d - len / 2), t2 = spline.tangentAt(d + len / 2);
    const r1 = { x: -t1.z, z: t1.x }, r2 = { x: -t2.z, z: t2.x };
    dashVerts.push(
      p1.x + r1.x * w, 0.03, p1.z + r1.z * w,
      p1.x - r1.x * w, 0.03, p1.z - r1.z * w,
      p2.x + r2.x * w, 0.03, p2.z + r2.z * w,
      p2.x - r2.x * w, 0.03, p2.z - r2.z * w,
    );
  }
  const dashIdx = [];
  for (let i = 0; i < dashVerts.length / 4; i++) {
    const a = i * 4, b = a + 1, c = a + 2, d2 = a + 3;
    dashIdx.push(a, c, b, b, c, d2);
  }
  dashGeo.setAttribute('position', new THREE.Float32BufferAttribute(dashVerts, 3));
  dashGeo.setIndex(dashIdx);
  dashGeo.computeVertexNormals();
  group.add(new THREE.Mesh(dashGeo, dashMat));

  // Edge lines (solid white).
  const edgeVerts = [];
  for (let d = 0; d < spline.length; d += 4) {
    const p = spline.posAt(d);
    const t = spline.tangentAt(d);
    const rx = -t.z, rz = t.x;
    for (const side of [-1, 1]) {
      const off = (ROAD_W / 2 - 0.3) * side;
      const p2 = spline.posAt(d + 4);
      const t2 = spline.tangentAt(d + 4);
      const r2 = { x: -t2.z, z: t2.x };
      edgeVerts.push(
        p.x + rx * off, 0.03, p.z + rz * off,
        p2.x + r2.x * off, 0.03, p2.z + r2.z * off,
      );
    }
  }
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgeVerts, 3));
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xcfd2d8 });
  group.add(new THREE.LineSegments(edgeGeo, edgeMat));

  // Ground plane (big, dark).
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 1.0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  group.add(ground);

  function dispose() {
    scene.remove(group);
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  return { group, setWetness, dispose };
}

/**
 * 3D speed-limit signs at zone boundaries along the route.
 * scene, spline, city: the route + city (for zoneAt).
 * Returns { group, setSigns(on), dispose }.
 */
export function createSigns(scene, spline, city) {
  const group = new THREE.Group();
  scene.add(group);

  // Walk the route and place a sign wherever the zone limit changes.
  let lastLimit = null;
  const step = 25;
  for (let d = 10; d < spline.length - 10; d += step) {
    const p = spline.posAt(d);
    const zone = city.zoneAt(p.x, p.z);
    if (zone.limit === lastLimit) continue;
    lastLimit = zone.limit;
    const t = spline.tangentAt(d);
    // Right side of the road.
    const rx = -t.z, rz = t.x;
    const sx = p.x + rx * (ROAD_W / 2 + 1.2);
    const sz = p.z + rz * (ROAD_W / 2 + 1.2);

    // Post.
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6),
      new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 }),
    );
    post.position.set(sx, 0.8, sz);
    group.add(post);

    // Round white sign with red border (limit number as a basic texture).
    const sign = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, 0.06, 20),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x222222, roughness: 0.5 }),
    );
    sign.rotation.z = Math.PI / 2;
    sign.rotation.y = Math.atan2(t.z, t.x);
    sign.position.set(sx, 1.7, sz);
    group.add(sign);
    const border = new THREE.Mesh(
      new THREE.TorusGeometry(0.45, 0.05, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xd02020, roughness: 0.5 }),
    );
    border.rotation.y = Math.atan2(t.z, t.x);
    border.position.set(sx, 1.7, sz);
    group.add(border);
  }

  function setSigns(on) { group.visible = !!on; }

  function dispose() {
    scene.remove(group);
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  return { group, setSigns, dispose };
}
