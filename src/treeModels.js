// Procedural low-poly tree models with baked vertex shading.
// Crowns are clusters of jittered lobes; trunks taper, bend and flare at the roots.
// Vertex colours carry ambient occlusion (dark inside / below, light on top),
// which multiplies with each instance's tint.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2, sstep } from './noise.js';

const hash3 = (a, b, c) => hash2(a * 73856 + c * 19349, b * 83492 - c * 7);

function prep(g) {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}

/**
 * Merge parts, jitter vertices (same position → same offset, so no cracks),
 * recompute flat normals, and bake a vertical AO gradient into vertex colours.
 */
function finish(parts, { jitter = 0, shade = [0.6, 1.12], moss = 0, rings = 0, seed = 1 } = {}) {
  const g = mergeGeometries(parts.map(prep));
  const p = g.attributes.position, n = p.count;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const y = p.getY(i); if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (jitter) {
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const kx = Math.round(x * 40), ky = Math.round(y * 40), kz = Math.round(z * 40);
      p.setXYZ(i,
        x + (hash3(kx, ky, kz + seed) - 0.5) * 2 * jitter,
        y + (hash3(ky, kz, kx + seed) - 0.5) * 2 * jitter * 0.7,
        z + (hash3(kz, kx, ky + seed) - 0.5) * 2 * jitter);
    }
  }
  g.computeVertexNormals(); // non-indexed → faceted
  const nrm = g.attributes.normal, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = p.getY(i), t = (y - y0) / Math.max(1e-3, y1 - y0), ny = nrm.getY(i);
    let c = shade[0] + (shade[1] - shade[0]) * Math.pow(t, 0.8) + ny * 0.08;
    if (rings) c *= 0.86 + 0.14 * (Math.sin(y * rings) > 0 ? 1 : 0);
    let r = c, gg = c, b = c;
    if (moss) { const m = moss * sstep(0.45, 0.85, ny); r *= 1 - 0.38 * m; gg *= 1 + 0.06 * m; b *= 1 - 0.45 * m; }
    col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/** tapered trunk; bends toward +x with height and flares at the roots */
function trunk(h, r0, r1, { bend = 0, flare = 1.3, seg = 6, hs = 4 } = {}) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, hs).translate(0, h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = y / h, f = 1 + (flare - 1) * Math.pow(1 - t, 4);
    p.setXYZ(i, p.getX(i) * f + bend * t * t * h, y, p.getZ(i) * f);
  }
  return g;
}
const lobe = (r, x, y, z, sy = 1) => new THREE.IcosahedronGeometry(r, 0).scale(1, sy, 1).translate(x, y, z);
const branch = (len, r, tiltZ, rotY, y) =>
  new THREE.CylinderGeometry(r * 0.6, r, len, 5).translate(0, len / 2, 0).rotateZ(tiltZ).rotateY(rotY).translate(0, y, 0);

/** palm fronds: arched, tapering leaves with a slight V fold */
function fronds(tx, ty, count = 8, L = 2.9) {
  const pos = [];
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2 + hash2(k, 7) * 0.4, dx = Math.cos(a), dz = Math.sin(a);
    const sx = -dz, sz = dx, len = L * (0.85 + hash2(k, 3) * 0.3), lift = 0.5 + hash2(k, 5) * 0.3;
    const pts = [];
    for (let s = 0; s <= 5; s++) {
      const t = s / 5, w = 0.5 * Math.sin(Math.PI * Math.pow(t, 0.8));
      const cx = tx + dx * len * t, cy = ty + lift * t - 1.9 * t * t, cz = dz * len * t;
      pts.push([[cx - sx * w, cy - 0.08 * w, cz - sz * w], [cx, cy + 0.06 * w, cz], [cx + sx * w, cy - 0.08 * w, cz + sz * w]]);
    }
    for (let s = 0; s < 5; s++) {
      const [l0, m0, r0] = pts[s], [l1, m1, r1] = pts[s + 1];
      pos.push(...l0, ...m0, ...l1, ...m0, ...m1, ...l1, ...m0, ...r0, ...m1, ...r0, ...r1, ...m1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export function buildModels() {
  // broadleaf: bent trunk with two branches, six-lobe crown
  const bx = 0.15;
  const broadTrunk = finish([
    trunk(2.9, 0.38, 0.2, { bend: 0.05, flare: 1.5 }),
    branch(1.5, 0.11, -0.75, 0.4, 2.0), branch(1.3, 0.1, 0.7, -0.9, 2.3),
  ], { shade: [0.55, 1.05] });
  const broadCrown = finish([
    lobe(1.65, bx, 4.0, 0, 0.85), lobe(1.2, bx + 0.95, 3.65, 0.35, 0.85), lobe(1.25, bx - 0.85, 3.75, -0.4, 0.85),
    lobe(1.1, bx + 0.15, 4.75, -0.15, 0.85), lobe(1.0, bx - 0.25, 3.35, 0.85, 0.85), lobe(0.95, bx + 0.5, 3.4, -0.9, 0.85),
  ], { jitter: 0.14, shade: [0.52, 1.14], seed: 2 });

  // pine: five stacked tiers, each turned a little
  const tiers = [[1.95, 2.1, 1.9], [1.6, 1.9, 2.95], [1.25, 1.7, 3.9], [0.85, 1.5, 4.8], [0.45, 1.2, 5.6]];
  const pineTrunk = finish([trunk(3.2, 0.3, 0.12, { flare: 1.7 })], { shade: [0.5, 1.0] });
  const pineLeaves = finish(
    tiers.map(([r, h, y], k) => new THREE.ConeGeometry(r, h, 8).rotateY(k * 0.7).translate(0, y + h / 2, 0)),
    { jitter: 0.1, shade: [0.48, 1.12], seed: 3 },
  );

  // jungle: tall flared trunk with buttress roots, wide flat canopy
  const jungTrunk = finish([
    trunk(7.2, 0.55, 0.28, { bend: 0.03, flare: 2.2, hs: 5 }),
    ...[0, 2.1, 4.2].map((a) => new THREE.BoxGeometry(0.12, 1.2, 0.9).translate(0, 0.5, 0.55).rotateY(a)),
  ], { shade: [0.45, 1.0] });
  const jx = 0.22;
  const jungCrown = finish([
    lobe(2.5, jx, 7.6, 0, 0.55), lobe(1.8, jx + 1.9, 7.2, 0.5, 0.6), lobe(1.9, jx - 1.7, 7.35, -0.7, 0.6),
    lobe(1.6, jx + 0.4, 7.1, -1.8, 0.6), lobe(1.5, jx - 0.5, 8.2, 1.0, 0.6), lobe(1.3, jx + 1.2, 8.0, -0.9, 0.6),
  ], { jitter: 0.2, shade: [0.48, 1.1], seed: 4 });

  // palm: curved ringed trunk, coconuts, arched fronds
  const ph = 5.2, pb = 0.12, ptx = pb * ph;
  const palmTrunk = finish([
    trunk(ph, 0.27, 0.15, { bend: pb, flare: 1.4, hs: 6 }),
    ...[0, 2.1, 4.2].map((a) => new THREE.IcosahedronGeometry(0.17, 0).translate(ptx + Math.cos(a) * 0.2, ph - 0.25, Math.sin(a) * 0.2)),
  ], { shade: [0.6, 1.05], rings: 7 });
  const palmFronds = finish([fronds(ptx, ph)], { shade: [0.62, 1.08] });

  const bush = finish([lobe(0.85, 0, 0.55, 0), lobe(0.6, 0.55, 0.4, 0.25), lobe(0.65, -0.5, 0.45, -0.2), lobe(0.55, 0.1, 0.5, -0.55)],
    { jitter: 0.1, shade: [0.58, 1.1], seed: 5 });

  // saguaro: ribbed body and two elbowed arms
  const arm = (side, y, s) => [
    new THREE.CylinderGeometry(0.2 * s, 0.2 * s, 0.7 * s, 8).rotateZ(Math.PI / 2).translate(side * 0.6 * s, y, 0),
    new THREE.CylinderGeometry(0.18 * s, 0.21 * s, 1.1 * s, 8).translate(side * 0.9 * s, y + 0.5 * s, 0),
    new THREE.SphereGeometry(0.18 * s, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(side * 0.9 * s, y + 1.05 * s, 0),
  ];
  const cactus = finish([
    new THREE.CylinderGeometry(0.36, 0.42, 3.1, 8, 3).translate(0, 1.55, 0),
    new THREE.SphereGeometry(0.36, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 3.1, 0),
    ...arm(1, 1.5, 1), ...arm(-1, 1.95, 0.8),
  ], { jitter: 0.02, shade: [0.68, 1.06] });

  const rock = finish([new THREE.DodecahedronGeometry(1, 1)], { jitter: 0.16, shade: [0.62, 1.08], moss: 0.8, seed: 6 });

  return { broadTrunk, broadCrown, pineTrunk, pineLeaves, jungTrunk, jungCrown, palmTrunk, palmFronds, bush, cactus, rock };
}
