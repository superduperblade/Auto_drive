// car.js — the player's car: low-poly exterior + interior shell (Three.js)
//
// The exterior is built from extruded side profiles (hood slope, roofline,
// trunk) instead of plain boxes, plus a glass canopy, hubbed wheels, mirrors,
// bumpers and emissive lights.
//
// The interior (dashboard, seats, A-pillars, window quads) is what the camera
// sees from inside. Geometry is simple boxes so it stays cheap. The car-local
// frame matches seats.js / raytracer.js: +x forward, +y up, +z left.

import * as THREE from 'three';

/**
 * Create the player's car.
 * color: css color string
 * type: 'car' | 'van'
 * Returns { group, setInteriorVisible(v), setHudGlow(v), setColor(c), dispose }.
 */
export function createCar(color, type = 'car') {
  const group = new THREE.Group();
  const isVan = type === 'van';
  const L = isVan ? 5.2 : 4.4;
  const W = 1.85;

  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), roughness: 0.35, metalness: 0.55,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.9 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x223344, roughness: 0.1, metalness: 0.8, transparent: true, opacity: 0.5,
  });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.9 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.8 });
  const lightMat = new THREE.MeshStandardMaterial({
    color: 0x111, emissive: 0xfff4d0, emissiveIntensity: 1.4,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x111, emissive: 0xff2222, emissiveIntensity: 1.0,
  });

  // ── Body: extruded side profile ────────────────────────────────────────
  // Profile in the XY plane (x = length, y = height), extruded along z.
  const bodyShape = new THREE.Shape();
  if (isVan) {
    bodyShape.moveTo(L / 2, 0.16);
    bodyShape.lineTo(L / 2, 0.5);
    bodyShape.quadraticCurveTo(L / 2 - 0.15, 0.72, L / 2 - 0.4, 0.75); // hood
    bodyShape.lineTo(-L / 2 + 0.25, 0.78); // beltline
    bodyShape.quadraticCurveTo(-L / 2, 0.74, -L / 2, 0.5); // rear
    bodyShape.lineTo(-L / 2, 0.16);
  } else {
    bodyShape.moveTo(L / 2, 0.16);
    bodyShape.lineTo(L / 2, 0.48);
    bodyShape.quadraticCurveTo(L / 2 - 0.1, 0.6, L / 2 - 0.35, 0.63); // fascia
    bodyShape.lineTo(0.95, 0.72); // hood
    bodyShape.lineTo(-1.3, 0.74); // beltline
    bodyShape.lineTo(-L / 2 + 0.2, 0.68); // trunk
    bodyShape.quadraticCurveTo(-L / 2, 0.62, -L / 2, 0.45); // rear
    bodyShape.lineTo(-L / 2, 0.16);
  }
  bodyShape.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
    depth: W, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2,
  });
  bodyGeo.translate(0, 0, -W / 2);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(body);

  // ── Greenhouse (cabin shell, body color) ───────────────────────────────
  const ghShape = new THREE.Shape();
  if (isVan) {
    ghShape.moveTo(L / 2 - 0.45, 0.72);
    ghShape.lineTo(L / 2 - 0.6, 1.85); // near-vertical van windshield
    ghShape.quadraticCurveTo(L / 2 - 0.65, 1.95, L / 2 - 0.85, 1.95);
    ghShape.lineTo(-L / 2 + 0.15, 1.95); // flat roof
    ghShape.lineTo(-L / 2 + 0.15, 0.75);
  } else {
    ghShape.moveTo(0.95, 0.7);
    ghShape.lineTo(0.55, 1.3); // A-pillar
    ghShape.quadraticCurveTo(0.3, 1.38, -0.2, 1.38); // roof
    ghShape.lineTo(-0.8, 1.38);
    ghShape.lineTo(-1.35, 0.72); // rear window
  }
  ghShape.closePath();
  const ghGeo = new THREE.ExtrudeGeometry(ghShape, {
    depth: W * 0.94, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2,
  });
  ghGeo.translate(0, 0, -(W * 0.94) / 2);
  const greenhouse = new THREE.Mesh(ghGeo, bodyMat);
  group.add(greenhouse);

  // ── Glass ──────────────────────────────────────────────────────────────
  function glassBox(len, hgt, wdt, x, y, rotZ = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, hgt, wdt), glassMat);
    m.position.set(x, y, 0);
    if (rotZ) m.rotation.z = rotZ;
    group.add(m);
    return m;
  }
  if (isVan) {
    glassBox(2.4, 0.95, W * 0.96, -0.2, 1.32); // side windows (one long band)
    glassBox(1.3, 0.08, W * 0.85, L / 2 - 0.52, 1.3, -0.22); // windshield
    glassBox(0.5, 0.9, W * 0.9, -L / 2 + 0.28, 1.32); // rear window
  } else {
    glassBox(2.05, 0.48, W * 0.96, -0.22, 1.02); // side windows
    glassBox(0.72, 0.07, W * 0.86, 0.75, 1.0, -0.98); // windshield (sloped)
    glassBox(0.8, 0.07, W * 0.86, -1.08, 1.05, 0.88); // rear window (sloped)
  }

  // ── Wheels (tire + hub) ────────────────────────────────────────────────
  const wheelR = 0.35;
  const tireGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.26, 14);
  tireGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.28, 10);
  hubGeo.rotateZ(Math.PI / 2);
  const wl = L / 2 - (isVan ? 0.8 : 0.6), wr = W / 2 - 0.05;
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.position.set(sx * wl, wheelR, sz * wr);
    group.add(tire);
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.position.set(sx * wl, wheelR, sz * wr);
    group.add(hub);
  }

  // ── Bumpers ────────────────────────────────────────────────────────────
  for (const sx of [1, -1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, W * 0.95), darkMat);
    b.position.set(sx * (L / 2 - 0.02), 0.32, 0);
    group.add(b);
  }

  // ── Mirrors ────────────────────────────────────────────────────────────
  for (const sz of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.18), bodyMat);
    m.position.set(isVan ? L / 2 - 0.7 : 0.85, 0.95, sz * (W / 2 + 0.09));
    group.add(m);
  }

  // ── Lights ─────────────────────────────────────────────────────────────
  for (const sz of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.3), lightMat);
    hl.position.set(L / 2 - 0.06, 0.58, sz * (W / 2 - 0.4));
    group.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.35), tailMat);
    tl.position.set(-L / 2 + 0.06, 0.55, sz * (W / 2 - 0.4));
    group.add(tl);
  }

  // ── Interior shell (visible from inside) ───────────────────────────────
  const interior = new THREE.Group();
  group.add(interior);
  const dashMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.8 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x2a2d38, roughness: 0.9 });

  // Dashboard.
  const dash = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, W * 0.85), dashMat);
  dash.position.set(0.55, 0.95, 0);
  interior.add(dash);

  // Instrument cluster (glowing).
  const clusterMat = new THREE.MeshStandardMaterial({
    color: 0x0a0c10, emissive: 0x4a90d0, emissiveIntensity: 0.8,
  });
  const cluster = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.4), clusterMat);
  cluster.position.set(0.35, 1.0, 0.35);
  interior.add(cluster);

  // Steering wheel.
  const wheelRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.18, 0.02, 8, 16),
    dashMat,
  );
  wheelRing.position.set(0.35, 1.0, 0.35);
  wheelRing.rotation.y = Math.PI / 2;
  interior.add(wheelRing);

  // Seats (4).
  const seatGeo = new THREE.BoxGeometry(0.5, 0.15, 0.45);
  const backGeo = new THREE.BoxGeometry(0.12, 0.5, 0.45);
  const seats = [
    [0.6, 0.35], [0.6, -0.35], [-0.7, 0.35], [-0.7, -0.35],
  ];
  for (const [sx, sz] of seats) {
    const s = new THREE.Mesh(seatGeo, seatMat);
    s.position.set(sx, 0.6, sz);
    interior.add(s);
    const b = new THREE.Mesh(backGeo, seatMat);
    b.position.set(sx - 0.22, 0.85, sz);
    interior.add(b);
  }

  // A-pillars.
  const pillarGeo = new THREE.BoxGeometry(0.08, 0.7, 0.08);
  for (const sz of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, dashMat);
    p.position.set(isVan ? L / 2 - 0.65 : 0.85, 1.05, sz * (W / 2 - 0.1));
    p.rotation.z = isVan ? -0.22 : -0.3;
    interior.add(p);
  }

  // Ceiling (so looking up shows the roof).
  const ceil = new THREE.Mesh(
    new THREE.BoxGeometry(isVan ? 2.6 : 1.4, 0.05, W * 0.88),
    dashMat,
  );
  ceil.position.set(isVan ? -0.1 : -0.15, isVan ? 1.92 : 1.36, 0);
  interior.add(ceil);

  function setInteriorVisible(v) {
    interior.visible = v;
  }

  /** Live-apply the in-car HUD glow (the instrument cluster's backlight):
   *  off / dim / neon. */
  function setHudGlow(v) {
    clusterMat.emissiveIntensity = v === 'neon' ? 2.2 : v === 'dim' ? 0.8 : 0;
  }

  /** Live-apply a new car body color (css color string). */
  function setColor(c) {
    bodyMat.color.set(c);
  }

  function dispose() {
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  return { group, setInteriorVisible, setHudGlow, setColor, dispose };
}
