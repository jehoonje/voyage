// Tree models: bark-textured trunks and branches, and crowns built from many
// alpha-cut leaf cards. Cards get "spherical" normals (pointing out from the crown
// centre) so the crown shades like a soft volume rather than flat planes.
// Vertex colours carry ambient occlusion: darker inside and underneath.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2, sstep } from './noise.js';

/* ---------- seeded helpers ---------- */
let s = 1;
const seed = (v) => { s = (v * 7919 + 13) % 2147483647 || 1; };
const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
function randUnit() {
  const z = rnd() * 2 - 1, a = rnd() * 6.283, r = Math.sqrt(1 - z * z);
  return V(Math.cos(a) * r, z, Math.sin(a) * r);
}

/* ---------- bark parts ---------- */

/** tapered trunk bending toward +x, flared at the roots; uv repeats the bark texture */
function trunk(h, r0, r1, { bend = 0, flare = 1.3, seg = 8, hs = 6, uvU = 2 } = {}) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, hs).translate(0, h / 2, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = y / h, f = 1 + (flare - 1) * Math.pow(1 - t, 4);
    p.setXYZ(i, p.getX(i) * f + bend * t * t * h, y, p.getZ(i) * f);
    uv.setXY(i, uv.getX(i) * uvU, uv.getY(i) * h / 1.6);
  }
  g.computeVertexNormals();
  return g;
}
/** a branch from `from` to `to` */
function limb(from, to, r) {
  const d = to.clone().sub(from), len = d.length();
  const g = new THREE.CylinderGeometry(r * 0.55, r, len, 6, 1).translate(0, len / 2, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * len / 1.6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate(from.x, from.y, from.z);
  return g;
}
/** merge bark parts and bake a height AO gradient into vertex colours */
function barkGeometry(parts, shade = [0.55, 1.05]) {
  const g = mergeGeometries(parts.map((p) => (p.index ? p : p)));
  const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3);
  let y1 = 0;
  for (let i = 0; i < n; i++) y1 = Math.max(y1, p.getY(i));
  for (let i = 0; i < n; i++) {
    const c = shade[0] + (shade[1] - shade[0]) * Math.min(1, p.getY(i) / Math.max(1, y1 * 0.6));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = c;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/* ---------- leaf cards ---------- */

class Cards {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; }
  /** quad with corners a,b,c,d (counter-clockwise), uvs, per-corner normal and shade */
  quad(a, b, c, d, uvs, normals, shades) {
    const vs = [a, b, c, a, c, d], idx = [0, 1, 2, 0, 2, 3];
    vs.forEach((v, k) => {
      const j = idx[k];
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(normals[j].x, normals[j].y, normals[j].z);
      this.uv.push(uvs[j][0], uvs[j][1]);
      this.col.push(shades[j], shades[j], shades[j]);
    });
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Fill an ellipsoid crown with leaf cards, mostly near its surface and facing outward.
 * The texture's bottom (twig base) points back toward the crown centre.
 */
function crown(cards, center, radii, count, size, { outBias = 0.65, sizeVar = 0.4, ao = [0.5, 1.1] } = {}) {
  const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let k = 0; k < count; k++) {
    const d = randUnit(), r = Math.pow(rnd(), 0.4);
    const p = V(center.x + d.x * radii.x * r, center.y + d.y * radii.y * r, center.z + d.z * radii.z * r);
    const sz = size * (1 - sizeVar / 2 + rnd() * sizeVar);
    const facing = d.clone().multiplyScalar(outBias).add(randUnit().multiplyScalar(1 - outBias)).normalize();
    let up = d.clone().add(V(0, 0.6, 0)).normalize();
    up.sub(facing.clone().multiplyScalar(up.dot(facing)));
    if (up.lengthSq() < 1e-4) up = V(0, 1, 0);
    up.normalize();
    const side = new THREE.Vector3().crossVectors(up, facing).normalize();
    const base = p.clone().addScaledVector(up, -sz * 0.35);
    const corners = [
      base.clone().addScaledVector(side, -sz / 2), base.clone().addScaledVector(side, sz / 2),
      base.clone().addScaledVector(side, sz / 2).addScaledVector(up, sz), base.clone().addScaledVector(side, -sz / 2).addScaledVector(up, sz),
    ];
    const normals = corners.map((c) => V((c.x - center.x) / radii.x, (c.y - center.y) / radii.y + 0.25, (c.z - center.z) / radii.z).normalize());
    const shades = corners.map((c) => {
      const q = Math.min(1, Math.hypot((c.x - center.x) / radii.x, (c.y - center.y) / radii.y, (c.z - center.z) / radii.z));
      const below = sstep(0.2, -0.8, (c.y - center.y) / radii.y);
      return (ao[0] + (ao[1] - ao[0]) * q) * (1 - 0.25 * below);
    });
    cards.quad(...corners, UV, normals, shades);
  }
}

/** pine: radial tiers of drooping branch cards (two crossed planes per branch) */
function pineTiers(cards, { h0 = 1.4, h1 = 7.2, tiers = 11, perTier = 7, maxLen = 2.7 }) {
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1), y = h0 + (h1 - h0) * t, L = maxLen * (1 - t * 0.85) + 0.35;
    for (let k = 0; k < perTier; k++) {
      const a = i * 0.9 + (k / perTier) * 6.283 + rnd() * 0.4, dir = V(Math.cos(a), 0, Math.sin(a));
      const side = V(-dir.z, 0, dir.x), w = 0.45 + L * 0.25, droop = L * (0.25 + rnd() * 0.15);
      const b = V(0, y, 0), tip = b.clone().addScaledVector(dir, L).add(V(0, -droop, 0));
      const shade = 0.5 + 0.6 * t;
      const up = V(dir.x * 0.3, 1, dir.z * 0.3).normalize();
      // horizontal plane
      cards.quad(b.clone().addScaledVector(side, -w * 0.3), tip.clone().addScaledVector(side, -w * 0.5), tip.clone().addScaledVector(side, w * 0.5), b.clone().addScaledVector(side, w * 0.3),
        [[0, 0.3], [1, 0], [1, 1], [0, 0.7]], [up, up, up, up], [shade * 0.7, shade, shade, shade * 0.7]);
      // vertical plane through the same branch, for thickness from the side
      const v = V(0, w * 0.45, 0);
      cards.quad(b.clone().sub(v.clone().multiplyScalar(0.6)), tip.clone().sub(v), tip.clone().add(v), b.clone().add(v.clone().multiplyScalar(0.6)),
        [[0, 0.3], [1, 0], [1, 1], [0, 0.7]], [up, up, up, up], [shade * 0.7, shade, shade, shade * 0.7]);
    }
  }
}

/** willow curtains: vertical strand cards hanging from the crown rim, facing outward */
function curtains(cards, cx, cy, count) {
  for (let k = 0; k < count; k++) {
    const a = (k / count) * 6.283 + rnd() * 0.3, out = V(Math.cos(a), 0, Math.sin(a)), side = V(-out.z, 0, out.x);
    const rad = 1.3 + rnd() * 1.4, top = cy + 0.4 - rad * 0.25, len = 2.6 + rnd() * 1.4, w = 0.9;
    const c0 = V(cx + out.x * rad, top, out.z * rad), c1 = c0.clone().addScaledVector(out, 0.35).add(V(0, -len, 0));
    const n = out.clone().add(V(0, 0.2, 0)).normalize();
    cards.quad(c1.clone().addScaledVector(side, -w / 2), c1.clone().addScaledVector(side, w / 2), c0.clone().addScaledVector(side, w / 2), c0.clone().addScaledVector(side, -w / 2),
      [[0, 0], [1, 0], [1, 1], [0, 1]], [n, n, n, n], [0.6, 0.6, 1.05, 1.05]);
  }
}

/** palm fronds: arched strips mapped with the frond texture (u along, v across) */
function fronds(cards, tx, ty, count = 9) {
  for (let k = 0; k < count; k++) {
    const a = (k / count) * 6.283 + hash2(k, 7) * 0.4, dx = Math.cos(a), dz = Math.sin(a), sx = -dz, sz = dx;
    const len = 3.1 * (0.85 + hash2(k, 3) * 0.3), lift = 0.5 + hash2(k, 5) * 0.3, W = 0.8;
    const at = (t) => V(tx + dx * len * t, ty + lift * t - 1.9 * t * t, dz * len * t);
    for (let sgi = 0; sgi < 6; sgi++) {
      const t0 = sgi / 6, t1 = (sgi + 1) / 6, p0 = at(t0), p1 = at(t1);
      const n = V(0, 1, 0);
      const sh0 = 0.6 + 0.45 * t0, sh1 = 0.6 + 0.45 * t1;
      cards.quad(p0.clone().add(V(-sx * W, -0.05, -sz * W)), p1.clone().add(V(-sx * W, -0.05, -sz * W)), p1.clone().add(V(sx * W, -0.05, sz * W)), p0.clone().add(V(sx * W, -0.05, sz * W)),
        [[t0, 0], [t1, 0], [t1, 1], [t0, 1]], [n, n, n, n], [sh0, sh1, sh1, sh0]);
    }
  }
}

/* ---------- flat low-poly helpers kept for cactus and rock ---------- */
const hash3 = (a, b, c) => hash2(a * 73856 + c * 19349, b * 83492 - c * 7);
function prep(g) {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}
function faceted(parts, { jitter = 0, shade = [0.6, 1.12], moss = 0, seed: sd = 1 } = {}) {
  const g = mergeGeometries(parts.map(prep));
  const p = g.attributes.position, n = p.count;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const y = p.getY(i); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (jitter) {
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), kx = Math.round(x * 40), ky = Math.round(y * 40), kz = Math.round(z * 40);
      p.setXYZ(i, x + (hash3(kx, ky, kz + sd) - 0.5) * 2 * jitter, y + (hash3(ky, kz, kx + sd) - 0.5) * 1.4 * jitter, z + (hash3(kz, kx, ky + sd) - 0.5) * 2 * jitter);
    }
  }
  g.computeVertexNormals();
  const nrm = g.attributes.normal, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = (p.getY(i) - y0) / Math.max(1e-3, y1 - y0), ny = nrm.getY(i);
    let c = shade[0] + (shade[1] - shade[0]) * Math.pow(t, 0.8) + ny * 0.08, r = c, gg = c, b = c;
    if (moss) { const m = moss * sstep(0.45, 0.85, ny); r *= 1 - 0.38 * m; gg *= 1 + 0.06 * m; b *= 1 - 0.45 * m; }
    col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/* ---------- models ---------- */

export function buildModels() {
  const M = {};
  const top = (h, bend) => bend * h; // x offset of a bent trunk's top

  // broadleaf (oak-like): sturdy trunk, five limbs into a rounded crown
  seed(1);
  {
    const h = 3.4, bend = 0.05, cx = top(h, bend) * 0.8, c = V(cx, 5.0, 0);
    const limbs = [];
    for (let k = 0; k < 5; k++) {
      const a = k * 1.26 + rnd() * 0.3, from = V(bend * h * 0.6, 2.6 + rnd() * 0.6, 0);
      limbs.push(limb(from, V(cx + Math.cos(a) * 1.6, 4.4 + rnd() * 1.2, Math.sin(a) * 1.6), 0.13));
    }
    M.broadTrunk = barkGeometry([trunk(h + 0.6, 0.4, 0.2, { bend, flare: 1.6 }), ...limbs]);
    const cards = new Cards();
    crown(cards, c, V(2.4, 1.9, 2.4), 95, 1.6);
    M.broadCrown = cards.geometry();
  }

  // birch: slender white trunk, thin rising limbs, light airy crown
  seed(2);
  {
    const h = 7.4, bend = 0.04, limbs = [];
    for (let k = 0; k < 7; k++) {
      const y = 3.4 + k * 0.5, a = k * 2.3, from = V(bend * h * (y / h) ** 2, y, 0);
      limbs.push(limb(from, from.clone().add(V(Math.cos(a) * 1.1, 1.0 + rnd() * 0.6, Math.sin(a) * 1.1)), 0.05));
    }
    M.birchTrunk = barkGeometry([trunk(h, 0.2, 0.06, { bend, flare: 1.3, uvU: 1 }), ...limbs], [0.75, 1.05]);
    const cards = new Cards();
    crown(cards, V(top(h, bend) * 0.7, 5.6, 0), V(1.6, 2.3, 1.6), 80, 1.25, { outBias: 0.5 });
    M.birchCrown = cards.geometry();
  }

  // pine: straight tall trunk, drooping tiered branches
  seed(3);
  {
    M.pineTrunk = barkGeometry([trunk(7.6, 0.32, 0.08, { flare: 1.7 })]);
    const cards = new Cards();
    pineTiers(cards, {});
    M.pineLeaves = cards.geometry();
  }

  // jungle: very tall trunk with buttresses, broad flat canopy and hanging vines
  seed(4);
  {
    const h = 9.2, bend = 0.03, cx = top(h, bend);
    const buttress = [0, 2.1, 4.2].map((a) => new THREE.BoxGeometry(0.14, 1.4, 1.0).translate(0, 0.6, 0.6).rotateY(a));
    const limbs = [];
    for (let k = 0; k < 6; k++) {
      const a = k * 1.05 + rnd() * 0.3;
      limbs.push(limb(V(cx * 0.8, 7.6, 0), V(cx + Math.cos(a) * 2.6, 8.8 + rnd() * 0.6, Math.sin(a) * 2.6), 0.16));
    }
    M.jungTrunk = barkGeometry([trunk(h, 0.6, 0.3, { bend, flare: 2.0 }), ...buttress, ...limbs], [0.45, 1.0]);
    const cards = new Cards();
    crown(cards, V(cx, 9.2, 0), V(3.8, 1.4, 3.8), 70, 2.1, { outBias: 0.4 });
    M.jungCrown = cards.geometry();
    const vines = new Cards();
    curtains(vines, cx, 8.6, 10);
    M.jungVines = vines.geometry();
  }

  // willow: thick leaning trunk, low dome and long hanging curtains
  seed(5);
  {
    const h = 3.0, bend = 0.18, cx = top(h, bend), limbs = [];
    for (let k = 0; k < 5; k++) {
      const a = k * 1.26 + 0.3;
      limbs.push(limb(V(cx * 0.8, 2.4, 0), V(cx + Math.cos(a) * 1.8, 4.2 + rnd() * 0.5, Math.sin(a) * 1.8), 0.15));
    }
    M.willowTrunk = barkGeometry([trunk(h, 0.55, 0.3, { bend, flare: 1.8 }), ...limbs], [0.5, 1.0]);
    const dome = new Cards();
    crown(dome, V(cx, 4.4, 0), V(2.5, 1.1, 2.5), 40, 1.4);
    M.willowDome = dome.geometry();
    const cur = new Cards();
    curtains(cur, cx, 4.5, 46);
    M.willowCurtain = cur.geometry();
  }

  // palm: curved ringed trunk, coconuts, arched fronds
  seed(6);
  {
    const h = 5.4, bend = 0.12, tx = top(h, bend);
    M.palmTrunk = barkGeometry([
      trunk(h, 0.27, 0.16, { bend, flare: 1.4, hs: 8, uvU: 1 }),
      ...[0, 2.1, 4.2].map((a) => new THREE.SphereGeometry(0.17, 8, 6).translate(tx + Math.cos(a) * 0.2, h - 0.25, Math.sin(a) * 0.2)),
    ], [0.6, 1.05]);
    const cards = new Cards();
    fronds(cards, tx, h);
    M.palmFronds = cards.geometry();
  }

  // bush: a small ball of leaf cards
  seed(7);
  {
    const cards = new Cards();
    crown(cards, V(0, 0.6, 0), V(1.0, 0.65, 1.0), 26, 0.95, { outBias: 0.5 });
    M.bush = cards.geometry();
  }

  // saguaro and rocks stay solid
  const arm = (side, y, sc) => [
    new THREE.CylinderGeometry(0.2 * sc, 0.2 * sc, 0.7 * sc, 8).rotateZ(Math.PI / 2).translate(side * 0.6 * sc, y, 0),
    new THREE.CylinderGeometry(0.18 * sc, 0.21 * sc, 1.1 * sc, 8).translate(side * 0.9 * sc, y + 0.5 * sc, 0),
    new THREE.SphereGeometry(0.18 * sc, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(side * 0.9 * sc, y + 1.05 * sc, 0),
  ];
  M.cactus = faceted([
    new THREE.CylinderGeometry(0.36, 0.42, 3.1, 10, 3).translate(0, 1.55, 0),
    new THREE.SphereGeometry(0.36, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 3.1, 0),
    ...arm(1, 1.5, 1), ...arm(-1, 1.95, 0.8),
  ], { jitter: 0.015, shade: [0.68, 1.06] });
  M.rock = faceted([new THREE.DodecahedronGeometry(1, 2)], { jitter: 0.12, shade: [0.55, 1.08], moss: 0.85, seed: 6 });

  return M;
}
