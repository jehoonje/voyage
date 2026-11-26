// Tree models: bark-textured trunks and branches, and crowns built from many
// alpha-cut leaf cards. Cards get "spherical" normals (pointing out from the crown
// centre) so the crown shades like a soft volume rather than flat planes.
// Vertex colours carry ambient occlusion: darker inside and underneath.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2, sstep, vnoise } from './noise.js';
import { meshRaw, ellipsoid, roundBox, cone, smin, smax } from './character/sculpt.js';

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

/**
 * A living trunk rather than a pipe: bending toward +x, the foot swelling into root ridges
 * (buttress lobes that twist a little as they climb), a knotted, uneven cross-section,
 * and a gentle meander that vanishes at the base and the top (so limbs and crowns still meet it).
 * uv repeats the bark texture.
 */
function trunk(h, r0, r1, { bend = 0, flare = 1.3, seg = 12, hs = 10, uvU = 2, roots = 5, gnarl = 0.09, wander = 0.05 } = {}) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, hs).translate(0, h / 2, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  const ph = rnd() * 6.283, sx = rnd() * 50, sz = rnd() * 50, tw = 0.4 + rnd() * 0.5;
  const meander = Math.min(0.18, wander * h);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), t = y / h;
    const ang = Math.atan2(z, x);
    const foot = Math.pow(Math.max(0, 1 - t), 3.2); // float32 tops can sit a hair above h
    const lobe = Math.pow(Math.max(0, Math.cos(roots * (ang + t * tw) + ph)), 1.6); // root ridges
    const knot = vnoise(ang * 1.7 + sx, y * 1.4 + sz) * 2 - 1;
    const k = 1 + (flare - 1) * foot * (0.3 + 1.6 * lobe) + gnarl * knot * (0.6 + 0.4 * foot);
    const s = Math.sin(Math.PI * t);
    const ox = bend * t * t * h + s * meander * (vnoise(sx, t * 2.2) * 2 - 1);
    const oz = s * meander * (vnoise(sz, t * 2.2 + 9) * 2 - 1);
    p.setXYZ(i, x * k + ox, y, z * k + oz);
    uv.setXY(i, uv.getX(i) * uvU, uv.getY(i) * h / 1.6);
  }
  g.computeVertexNormals();
  return g;
}
/** surface roots snaking out from the foot of a trunk and diving into the soil */
function surfaceRoots(r0, n, reach, rr, { ph = rnd() * 6.283 } = {}) {
  const parts = [];
  for (let k = 0; k < n; k++) {
    const a = ph + (k / n) * 6.283 + (rnd() - 0.5) * 0.5, curl = (rnd() - 0.5) * 0.6, L = reach * (0.7 + rnd() * 0.6);
    const at = (d, y, da = 0) => V(Math.cos(a + da) * d, y, Math.sin(a + da) * d);
    const p0 = at(r0 * 0.55, r0 * 0.55), p1 = at(r0 + L * 0.35, r0 * 0.22, curl * 0.4), p2 = at(r0 + L * 0.75, 0.04, curl), p3 = at(r0 + L, -0.25, curl * 1.4);
    parts.push(limb(p0, p1, rr), limb(p1, p2, rr * 0.62), limb(p2, p3, rr * 0.4));
  }
  return parts;
}
/** a branch from `from` to `to` */
function limb(from, to, r) {
  const d = to.clone().sub(from), len = d.length();
  const g = new THREE.CylinderGeometry(r * 0.55, r, len, 6, 1, true).translate(0, len / 2, 0); // open ends: tips hide in leaves or soil
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * len / 1.6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate(from.x, from.y, from.z);
  return g;
}
/** merge bark parts and bake a height AO gradient into vertex colours */
function barkGeometry(parts, shade = [0.55, 1.05]) {
  const g = mergeGeometries(parts.map((p) => (p.index ? p : p.setIndex([...Array(p.attributes.position.count).keys()])))); // all indexed
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

/**
 * Fir (Abies): whorls of near-level branches from the ground to a spire, each branch carrying
 * flat sprays arranged like a fishbone, the whole forming a narrow cone. Returns the limbs
 * (bark, for the bigger lower branches) and fills `cards` with the sprays.
 */
function firCrown(cards, { y0 = 0.5, y1 = 8.7, whorls = 14, maxLen = 2.4 } = {}) {
  const limbs = [];
  const quadSpray = (b, dir, len, w, roll, shadeIn, shadeOut, droop) => {
    const up = V(0, 1, 0);
    let n0 = up.clone().addScaledVector(dir, -up.dot(dir)).normalize();
    n0.applyAxisAngle(dir, roll);
    const side = V().crossVectors(n0, dir).normalize();
    const e = b.clone().addScaledVector(dir, len).add(V(0, -droop, 0));
    const out = V(b.x, 0, b.z).normalize(), nn = n0.clone().addScaledVector(out, 0.7).normalize();
    cards.quad(b.clone().addScaledVector(side, -w * 0.25), e.clone().addScaledVector(side, -w * 0.5), e.clone().addScaledVector(side, w * 0.5), b.clone().addScaledVector(side, w * 0.25),
      [[0, 0.38], [1, 0], [1, 1], [0, 0.62]], [nn, nn, nn, nn], [shadeIn, shadeOut, shadeOut, shadeIn]);
  };
  for (let i = 0; i < whorls; i++) {
    const t = i / (whorls - 1), y = y0 + (y1 - y0) * Math.pow(t, 1.08);
    const L = (maxLen * Math.pow(1 - t, 1.05) + 0.3) * (0.9 + rnd() * 0.2);
    const nb = t > 0.7 ? 4 : 5;
    for (let k = 0; k < nb; k++) {
      const a = i * 2.4 + (k / nb) * 6.283 + (rnd() - 0.5) * 0.5;
      const pitch = -0.12 + 0.35 * t + (rnd() - 0.5) * 0.08; // low boughs level, young ones lift
      const dir = V(Math.cos(a) * Math.cos(pitch), Math.sin(pitch), Math.sin(a) * Math.cos(pitch));
      const base = V(0, y, 0), tip = base.clone().addScaledVector(dir, L).add(V(0, -L * 0.12, 0));
      if (L > 1.3) limbs.push(limb(base, tip, 0.018 + L * 0.008));
      const sh = (d) => (0.55 + 0.5 * Math.min(1, d / maxLen)) * (0.82 + 0.28 * t); // inner and lower sprays darker
      // fishbone: pairs of sprays angled forward off the branch, and one carrying on from its tip
      const step = 0.56, pairs = Math.max(0, Math.floor((L - 0.2) / step));
      for (let j = 0; j < pairs; j++) {
        const s = 0.25 + j * step, b = base.clone().lerp(tip, s / L);
        for (const lr of [-1, 1]) {
          const ang = lr * (0.55 + rnd() * 0.2);
          const d2 = dir.clone().applyAxisAngle(V(0, 1, 0), ang).normalize();
          const len = Math.min(1.15, 0.55 + (L - s) * 0.4);
          const roll = (0.45 + rnd() * 0.5) * (rnd() < 0.5 ? -1 : 1); // never edge-on: reads from the side too
          quadSpray(b, d2, len, len * 0.62, roll, sh(s), sh(s + len), len * 0.14);
        }
      }
      quadSpray(tip.clone().addScaledVector(dir, -0.15), dir, Math.min(1.1, 0.6 + L * 0.2), 0.6, (0.4 + rnd() * 0.4) * (rnd() < 0.5 ? -1 : 1), sh(L - 0.2), sh(L + 0.6), 0.1);
    }
  }
  // short sprays tucked against the trunk between whorls, so it doesn't show bare through the cone
  for (let i = 0; i < 14; i++) {
    const t = i / 13, y = y0 + 0.3 + (y1 - y0 - 0.5) * t, a = i * 2.17;
    const dir = V(Math.cos(a), 0.15 + t * 0.2, Math.sin(a)).normalize();
    const len = 0.5 + (1 - t) * 0.6;
    quadSpray(V(Math.cos(a) * 0.05, y, Math.sin(a) * 0.05), dir, len, len * 0.6, (0.5 + rnd() * 0.4) * (i % 2 ? 1 : -1), 0.5, 0.7, 0.06);
  }
  // the leader: a pointed spire of crossed upright sprays
  for (const a of [0, 1.57]) {
    const dir = V(0.02, 1, 0).normalize(), b = V(0, y1 - 0.2, 0);
    const side = V(Math.cos(a), 0, Math.sin(a)), e = b.clone().addScaledVector(dir, 1.1), n = V(Math.cos(a + 1.57), 0.3, Math.sin(a + 1.57)).normalize();
    cards.quad(b.clone().addScaledVector(side, -0.18), e.clone().addScaledVector(side, -0.02), e.clone().addScaledVector(side, 0.02), b.clone().addScaledVector(side, 0.18),
      [[0, 0.3], [1, 0.45], [1, 0.55], [0, 0.7]], [n, n, n, n], [0.85, 1.1, 1.1, 0.85]);
  }
  return limbs;
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

/** repaint vertex colours: fn(t = 0..1 height, ny = normal.y, x, y, z) → [r, g, b] */
function paint(g, fn) {
  const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < p.count; i++) { y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i)); }
  for (let i = 0; i < p.count; i++) {
    const [r, gg, b] = fn((p.getY(i) - y0) / Math.max(1e-3, y1 - y0), n.getY(i), p.getX(i), p.getY(i), p.getZ(i));
    c.setXYZ(i, r, gg, b);
  }
  return g;
}
/** layered red sandstone, as in desert cliffs */
const SANDSTONE = [[0.62, 0.31, 0.21], [0.8, 0.49, 0.3], [0.9, 0.74, 0.55], [0.56, 0.27, 0.19], [0.74, 0.42, 0.27]];
function sandstone(x, y, z, ny) {
  const b = SANDSTONE[Math.floor(((y * 1.1 + vnoise(x * 0.7, z * 0.7) * 0.35) % 5 + 5) % 5)];
  const v = 0.82 + 0.18 * Math.max(0, ny) + vnoise(x * 3 + y, z * 3) * 0.06;
  return [b[0] * v, b[1] * v, b[2] * v];
}
/** wet dark foot, grey-brown rock, a green cap of moss and grass on top and ledges */
function mossyStone(t, ny, x, y, z) {
  const m = sstep(0.55, 0.85, t) * 0.7 + sstep(0.35, 0.75, ny) * 0.7 + (vnoise(x * 1.3, z * 1.3 + y) * 0.5 + 0.5) * 0.25 * sstep(0.4, 0.8, t);
  const k = Math.min(1, m), v = 0.75 + 0.25 * t + vnoise(x * 2 + y * 3, z * 2) * 0.08;
  const rock = [0.52 * v, 0.48 * v, 0.42 * v], moss = [0.32 * v, 0.5 * v, 0.2 * v];
  const wet = 1 - 0.35 * (1 - sstep(0.05, 0.25, t));
  return [(rock[0] + (moss[0] - rock[0]) * k) * wet, (rock[1] + (moss[1] - rock[1]) * k) * wet, (rock[2] + (moss[2] - rock[2]) * k) * wet];
}
function sculpted(sdf, min, max, cell) {
  const r = meshRaw(sdf, min, max, cell), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(r.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(r.normal, 3));
  g.setIndex(new THREE.BufferAttribute(r.index, 1));
  return g;
}
/** an arching frond strip from the ground: u along, v across (centre line at v = 0.5) */
function frondStrip(cards, a, len, lift, droop, W, segs = 5, base = 0.05) {
  const dx = Math.cos(a), dz = Math.sin(a), sx = -dz, sz = dx;
  const at = (t) => V(dx * len * t, base + lift * t - droop * t * t, dz * len * t);
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs, p0 = at(t0), p1 = at(t1), n = V(dx * 0.3, 1, dz * 0.3).normalize();
    const w0 = W * (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, t0 + 0.15))), w1 = W * (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, t1 + 0.15)));
    cards.quad(p0.clone().add(V(-sx * w0, 0, -sz * w0)), p1.clone().add(V(-sx * w1, 0, -sz * w1)), p1.clone().add(V(sx * w1, 0, sz * w1)), p0.clone().add(V(sx * w0, 0, sz * w0)),
      [[t0, 0], [t1, 0], [t1, 1], [t0, 1]], [n, n, n, n], [0.5 + 0.55 * t0, 0.5 + 0.55 * t1, 0.5 + 0.55 * t1, 0.5 + 0.55 * t0]);
  }
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
    M.broadTrunk = barkGeometry([trunk(h + 0.6, 0.38, 0.2, { bend, flare: 1.45, roots: 5, gnarl: 0.035, wander: 0.01 }), ...limbs]);
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
    M.birchTrunk = barkGeometry([trunk(h, 0.19, 0.06, { bend, flare: 1.25, uvU: 1, roots: 4, gnarl: 0.02, wander: 0.006, seg: 10 }), ...limbs], [0.75, 1.05]);
    const cards = new Cards();
    crown(cards, V(top(h, bend) * 0.7, 5.6, 0), V(1.6, 2.3, 1.6), 80, 1.25, { outBias: 0.5 });
    M.birchCrown = cards.geometry();
  }

  // pine: straight tall trunk, drooping tiered branches
  seed(3);
  {
    // fir: a slender straight trunk, mostly hidden inside a dense narrow cone of level boughs
    const cards = new Cards();
    const boughs = firCrown(cards, {});
    M.pineTrunk = barkGeometry([trunk(9.4, 0.2, 0.03, { flare: 1.35, roots: 6, gnarl: 0.025, wander: 0.002, seg: 10, hs: 8 }), ...boughs], [0.45, 0.95]);
    M.pineLeaves = cards.geometry();
  }

  // jungle: very tall trunk with buttresses, broad flat canopy and hanging vines
  seed(4);
  {
    const h = 9.2, bend = 0.03, cx = top(h, bend);
    // buttress fins: thin wedges running down the trunk and out across the ground, curving as they go
    const buttress = [];
    for (let k = 0; k < 5; k++) {
      const a = k * 1.257 + rnd() * 0.4, fin = new THREE.BufferGeometry();
      const out = 1.3 + rnd() * 0.7, up = 1.8 + rnd() * 1.2, th = 0.07, curl = (rnd() - 0.5) * 0.5;
      const pts = [], N = 6;
      for (let i = 0; i <= N; i++) { // profile: from high on the trunk to the far root tip, a concave curve
        const u = i / N, d = 0.4 + out * u, y = up * Math.pow(1 - u, 2.2) - 0.15 * u;
        pts.push([d, Math.max(-0.2, y), curl * u * u]);
      }
      const pos = [];
      for (let i = 0; i < N; i++) {
        const [d0, y0, c0] = pts[i], [d1, y1, c1] = pts[i + 1];
        for (const s of [-1, 1]) {
          const q = [[d0, y0, c0 + s * th], [d1, y1, c1 + s * th * 0.6], [d1, -0.2, c1 + s * th * 0.8], [d0, -0.2, c0 + s * th]];
          const tri = s > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
          for (const j of tri) pos.push(...q[j]);
        }
        // the fin's sharp top edge
        pos.push(d0, y0, c0 - th, d1, y1, c1 - th * 0.6, d1, y1, c1 + th * 0.6, d0, y0, c0 - th, d1, y1, c1 + th * 0.6, d0, y0, c0 + th);
      }
      fin.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      fin.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0).map((_, i) => (i % 2 ? (pos[(i >> 1) * 3 + 1] / 1.6) : pos[(i >> 1) * 3] * 0.8)), 2));
      fin.computeVertexNormals();
      buttress.push(fin.rotateY(-a));
    }
    const limbs = [];
    for (let k = 0; k < 6; k++) {
      const a = k * 1.05 + rnd() * 0.3;
      limbs.push(limb(V(cx * 0.8, 7.6, 0), V(cx + Math.cos(a) * 2.6, 8.8 + rnd() * 0.6, Math.sin(a) * 2.6), 0.16));
    }
    M.jungTrunk = barkGeometry([trunk(h, 0.6, 0.3, { bend, flare: 2.2, roots: 5, gnarl: 0.1 }), ...buttress, ...surfaceRoots(0.6, 4, 2.0, 0.18), ...limbs], [0.45, 1.0]);
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
    M.willowTrunk = barkGeometry([trunk(h, 0.52, 0.3, { bend, flare: 1.6, roots: 4, gnarl: 0.07, wander: 0.03 }), ...surfaceRoots(0.52, 3, 0.9, 0.14), ...limbs], [0.5, 1.0]);
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
      trunk(h, 0.27, 0.16, { bend, flare: 1.55, hs: 10, uvU: 1, roots: 9, gnarl: 0.03, wander: 0.02 }), // palms: a tight root boss, no spreading roots
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
  M.boulder = faceted([new THREE.DodecahedronGeometry(1, 2)], { jitter: 0.12, shade: [0.6, 1.08], seed: 6 }); // bare (desert, snow)

  // fern: a low rosette of arching fronds
  seed(8);
  {
    const cards = new Cards();
    for (let k = 0; k < 11; k++) frondStrip(cards, (k / 11) * 6.283 + rnd() * 0.4, 1.1 * (0.8 + rnd() * 0.4), 0.9 + rnd() * 0.3, 1.15, 0.24);
    M.fern = cards.geometry();
  }
  // big tropical leaves (banana / elephant ear) rising on long stems and bending out
  seed(9);
  {
    const cards = new Cards(), UVL = 6;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * 6.283 + rnd() * 0.5, dx = Math.cos(a), dz = Math.sin(a), sx = -dz, sz = dx;
      const L = 1.7 + rnd() * 0.8, W = 0.45 + rnd() * 0.15;
      const at = (t) => V(dx * (0.1 + L * 0.75 * Math.pow(t, 1.4)), L * (1.05 * t - 0.45 * t * t), dz * (0.1 + L * 0.75 * Math.pow(t, 1.4)));
      for (let i = 0; i < UVL; i++) {
        const t0 = i / UVL, t1 = (i + 1) / UVL, p0 = at(t0), p1 = at(t1), n = V(dx * 0.2, 1, dz * 0.2).normalize();
        cards.quad(p0.clone().add(V(-sx * W, 0, -sz * W)), p0.clone().add(V(sx * W, 0, sz * W)), p1.clone().add(V(sx * W, 0, sz * W)), p1.clone().add(V(-sx * W, 0, -sz * W)),
          [[0, t0], [1, t0], [1, t1], [0, t1]], [n, n, n, n], [0.45 + 0.6 * t0, 0.45 + 0.6 * t0, 0.45 + 0.6 * t1, 0.45 + 0.6 * t1]);
      }
    }
    M.bigleaf = cards.geometry();
  }

  // sea stack / crag: a weathered pillar of stacked drums with a mossy, grassy crown
  seed(10);
  {
    const parts = [];
    let y = 0, r = 1.6;
    for (let i = 0; i < 4; i++) {
      const hh = 2.3 + rnd() * 1.3, r1 = r * (0.72 + rnd() * 0.3);
      parts.push(new THREE.CylinderGeometry(r1, r, hh, 9, 2).translate((rnd() - 0.5) * 0.5, y + hh / 2, (rnd() - 0.5) * 0.5));
      y += hh * 0.9; r = r1;
    }
    parts.push(new THREE.SphereGeometry(r * 1.3, 10, 5).scale(1, 0.5, 1).translate(0, y, 0));
    parts.push(new THREE.SphereGeometry(1.25, 8, 4).scale(1, 0.6, 1).translate(1.2, 4.6, 0.3)); // a mossy ledge
    M.seastack = paint(faceted(parts, { jitter: 0.2, seed: 3 }), mossyStone);
  }

  // desert: banded red boulder, a hoodoo (thin column under a cap stone), bones, and a buried stone head
  M.redrock = paint(faceted([new THREE.DodecahedronGeometry(1, 2)], { jitter: 0.14, seed: 11 }), (t, ny, x, y, z) => sandstone(x, y * 2.2, z, ny));
  seed(12);
  {
    const parts = [new THREE.CylinderGeometry(1.0, 1.6, 2.2, 9, 2).translate(0, 1.1, 0), new THREE.CylinderGeometry(0.55, 0.95, 2.6, 8, 2).translate(0.1, 3.4, 0),
      new THREE.CylinderGeometry(0.7, 0.5, 1.6, 8, 2).translate(0.15, 5.3, 0), new THREE.CylinderGeometry(1.25, 1.05, 0.9, 9, 1).translate(0.2, 6.5, 0.1)];
    M.hoodoo = paint(faceted(parts, { jitter: 0.12, seed: 12 }), (t, ny, x, y, z) => sandstone(x, y, z, ny));
  }
  {
    const bone = [];
    const skull = new THREE.SphereGeometry(0.22, 8, 6).scale(1, 0.85, 1.25).translate(0.9, 0.2, 0);
    bone.push(skull, new THREE.BoxGeometry(0.16, 0.1, 0.3).translate(0.9, 0.08, 0.28));
    for (let i = 0; i < 6; i++) { // ribs: half rings along a spine
      const rib = new THREE.TorusGeometry(0.32 - i * 0.02, 0.025, 4, 10, Math.PI).rotateY(Math.PI / 2).translate(-0.1 - i * 0.16, 0.05, 0);
      bone.push(rib);
    }
    bone.push(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 5).rotateZ(Math.PI / 2).translate(-0.1, 0.32, 0));
    bone.push(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 5).rotateZ(1.2).translate(-1.3, 0.05, 0.35), new THREE.CylinderGeometry(0.03, 0.03, 0.7, 5).rotateZ(-1.3).translate(-1.4, 0.05, -0.3));
    M.bones = paint(faceted(bone, { jitter: 0.004 }), (t) => [0.88 + t * 0.06, 0.84 + t * 0.06, 0.74 + t * 0.05]);
  }
  {
    // a colossal head half sunk in the sand, gazing at the horizon
    const head = (x, y, z) => {
      let d = ellipsoid(x, y, z, [0, 3.3, 0], [2.05, 2.9, 2.15]);
      d = smin(d, ellipsoid(x, y, z, [0, 1.6, 0.45], [1.55, 1.5, 1.6]), 0.7); // jaw
      d = smin(d, ellipsoid(x, y, z, [0, 3.95, 1.55], [1.75, 0.38, 0.62]), 0.45); // brow
      d = smin(d, cone(x, y, z, [0, 3.65, 2.0], [0, 2.55, 2.45], 0.22, 0.42), 0.3); // nose
      for (const s of [-1, 1]) {
        d = smax(d, -ellipsoid(x, y, z, [s * 0.78, 3.42, 2.05], [0.52, 0.3, 0.42]), 0.18); // eye sockets
        d = smin(d, ellipsoid(x, y, z, [s * 0.75, 3.38, 1.82], [0.34, 0.2, 0.25]), 0.1); // lids
      }
      d = smin(d, ellipsoid(x, y, z, [0, 1.86, 1.86], [0.78, 0.26, 0.3]), 0.18); // lips
      d = smax(d, -roundBox(x, y, z, [0, 1.84, 2.18], [0.62, 0.035, 0.3], 0.03), 0.05); // mouth line
      return smax(d, -0.2 - y, 0.1);
    };
    const g = sculpted(head, [-2.8, -0.4, -2.6], [2.8, 6.6, 3.1], 0.15);
    M.stonehead = paint(faceted([g.rotateZ(0.12).rotateX(-0.08)], { jitter: 0.03 }), (t, ny, x, y, z) => sandstone(x, y * 1.4, z, ny).map((v) => v * 0.95));
  }

  return M;
}
