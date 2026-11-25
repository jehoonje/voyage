// The player's hiker: sculpted parts (baked in a worker, cached), skinned to one skeleton,
// and posed through the same pose numbers the old hero used (walk / run / jump / actions).
import * as THREE from 'three';
import { EYES, HAIR, HATS, TOPS, BOTTOMS, SHOES, ACCESSORIES, DEFAULT_SPEC, HEAD_PIVOT } from './parts.js';
import { BONES, BONE } from './rig.js';

export const SCALE = 1.35; // model metres → world metres (about 1.7 m with hair)
export const POSE_KEYS = ['drop', 'back', 'lean', 'twist', 'legL', 'legR', 'kneeL', 'kneeR',
  'armLX', 'armRX', 'armLZ', 'armRZ', 'elbowL', 'elbowR'];
const QUALITY = 1.6; // grid coarsening for game-ready triangle counts
const DROP_K = 0.42 / 0.93; // (model units) action poses were authored for a 0.93 m hip height

/* ================= spec: what the player chose ================= */
const KEY = 'mjdr-hero';
const isCol = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffff;
export function sanitize(s) {
  const d = DEFAULT_SPEC, o = { ...d, ...(s || {}) };
  for (const k of ['skin', 'iris', 'hairColor', 'hatColor', 'topColor', 'topAccent', 'bottomColor', 'shoesColor', 'soleColor']) if (!isCol(o[k])) o[k] = d[k];
  if (!EYES[o.eyes]) o.eyes = d.eyes;
  if (!HAIR[o.hair]) o.hair = d.hair;
  if (!HATS[o.hat]) o.hat = d.hat;
  if (!TOPS[o.top]) o.top = d.top;
  if (!BOTTOMS[o.bottom]) o.bottom = d.bottom;
  if (!SHOES[o.shoes]) o.shoes = d.shoes;
  o.freckles = !!o.freckles;
  const acc = {}, groups = new Set();
  for (const [k, v] of Object.entries(o.acc && typeof o.acc === 'object' ? o.acc : {})) {
    const A = ACCESSORIES[k];
    if (!A || (A.group && groups.has(A.group))) continue;
    if (A.group) groups.add(A.group);
    acc[k] = { c: isCol(v && v.c) ? v.c : A.c };
    if (A.c2 !== undefined) acc[k].c2 = isCol(v && v.c2) ? v.c2 : A.c2;
  }
  o.acc = acc;
  return o;
}
export function loadSpec() {
  try { const t = localStorage.getItem(KEY); return t ? sanitize(JSON.parse(t)) : null; } catch { return null; }
}
export function saveSpec(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

/* ================= textures & materials ================= */
let sd = 5; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
function tex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; // colours used as authored (game runs without colour management)
  return t;
}
const blotchTex = (base, cols, n, a, b) => tex(128, (g, s) => { g.fillStyle = base; g.fillRect(0, 0, s, s); for (let i = 0; i < n; i++) { g.fillStyle = cols[i % cols.length]; const x = rnd() * s, y = rnd() * s, r = a + rnd() * (b - a); for (const [ox, oy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) { g.beginPath(); g.ellipse(x + ox, y + oy, r, r * 0.7, rnd() * 3, 0, 6.283); g.fill(); } } });
const TEX = {};
function T(name) {
  if (TEX[name]) return TEX[name];
  const mk = {
    cotton: () => tex(64, (g, s) => { g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); for (let i = 0; i < s; i += 2) { g.fillStyle = 'rgba(0,0,0,.035)'; g.fillRect(i, 0, 1, s); g.fillRect(0, i, s, 1); } }),
    ripstop: () => tex(64, (g, s) => { g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); g.fillStyle = 'rgba(0,0,0,.07)'; for (let i = 0; i < s; i += 8) { g.fillRect(i, 0, 1, s); g.fillRect(0, i, s, 1); } }),
    crinkle: () => tex(128, (g, s) => { g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.05 + rnd() * 0.08})`; g.lineWidth = 1 + rnd() * 2; g.beginPath(); const x = rnd() * s, y = rnd() * s; g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 30); g.stroke(); } }),
    knit: () => tex(64, (g, s) => { g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); for (let i = 0; i < s; i += 4) { g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(i, 0, 2, s); } }),
    mesh: () => tex(64, (g, s) => { g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); g.fillStyle = 'rgba(0,0,0,.14)'; for (let j = 0; j < s; j += 6) for (let i = (j / 6) % 2 ? 3 : 0; i < s; i += 6) g.fillRect(i, j, 3, 3); }),
    camo: () => blotchTex('#58584e', ['#48483f', '#67675c', '#3d3e38'], 36, 8, 18),
    olivecamo: () => blotchTex('#6a7046', ['#5a603c', '#7a8052', '#4e5434'], 30, 8, 18),
    plaid: () => tex(64, (g, s) => { g.fillStyle = '#d8ccb2'; g.fillRect(0, 0, s, s); for (const [c, w, o] of [['rgba(120,100,80,.55)', 9, 4], ['rgba(90,80,70,.4)', 3, 26], ['rgba(150,135,110,.5)', 6, 42]]) { g.fillStyle = c; g.fillRect(o, 0, w, s); g.fillRect(0, o, s, w); } }),
    floral: () => tex(128, (g, s) => { g.fillStyle = '#e8ecdc'; g.fillRect(0, 0, s, s); for (let i = 0; i < 40; i++) { g.strokeStyle = ['#6a9a6a', '#8ab08a', '#4a7a5a'][i % 3]; g.lineWidth = 2; g.beginPath(); const x = rnd() * s, y = rnd() * s; g.moveTo(x, y); g.quadraticCurveTo(x + 8, y - 10, x + 4, y - 18); g.stroke(); } }),
  };
  return (TEX[name] = mk[name]());
}
/** fabric: colour × a tri-planar weave sampled in rest-pose space, so it never swims as limbs move */
function cloth(color, texName = 'cotton', scale = 22, rough = 0.88) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
  const t = T(texName);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uD: { value: t }, uS: { value: scale } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vR; varying vec3 vRN;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvR = position; vRN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uD; uniform float uS; varying vec3 vR; varying vec3 vRN;')
      .replace('#include <map_fragment>', `vec3 n0 = normalize(vRN), w = pow(abs(n0), vec3(3.)); w /= w.x + w.y + w.z;
diffuseColor.rgb *= texture2D(uD, vR.zy * uS).rgb * w.x + texture2D(uD, vR.xz * uS).rgb * w.y + texture2D(uD, vR.xy * uS).rgb * w.z;`);
  };
  return m;
}
const plain = (color, roughness = 0.6) => new THREE.MeshStandardMaterial({ color, roughness });
function faceDecal(freckles) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  sd = 7;
  if (freckles) for (let i = 0; i < 80; i++) { const a = rnd() * 6.283, r = Math.sqrt(rnd()); g.fillStyle = `rgba(160,85,55,${0.28 + rnd() * 0.3})`; g.beginPath(); g.arc(128 + Math.cos(a) * r * 82, 135 + Math.sin(a) * r * 26, 1.4 + rnd() * 1.6, 0, 6.283); g.fill(); }
  for (const s of [-1, 1]) { const gr = g.createRadialGradient(128 + s * 70, 150, 0, 128 + s * 70, 150, 34); gr.addColorStop(0, 'rgba(235,115,105,.35)'); gr.addColorStop(1, 'rgba(235,115,105,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }
  return new THREE.CanvasTexture(c);
}
const DECALS = {};
function skinMat(color, freckles) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  const f = DECALS[freckles] || (DECALS[freckles] = faceDecal(freckles));
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uF = { value: f };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vR; varying vec3 vRN;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvR = position; vRN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uF; varying vec3 vR; varying vec3 vRN;')
      .replace('#include <map_fragment>', `{ vec2 uv = vec2((vR.x + .16) / .32, (vR.y - .84) / .32); float fr = smoothstep(.3, .7, normalize(vRN).z) * step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.) * step(.8, vR.y);
  vec4 d = texture2D(uF, uv); diffuseColor.rgb = mix(diffuseColor.rgb, d.rgb, d.a * fr); }`)
      .replace('#include <opaque_fragment>', `float tt = 1. - abs(dot(normal, normalize(vViewPosition)));
outgoingLight += vec3(.9, .35, .25) * .07 * smoothstep(.2, .8, tt);
#include <opaque_fragment>`);
  };
  return m;
}

/* ================= baking (worker pool + cache) ================= */
let workers = null, seq = 0;
const pending = new Map();
function pool() {
  if (workers) return workers;
  workers = [];
  if (typeof Worker === 'undefined') return workers;
  const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  for (let i = 0; i < n; i++) {
    try {
      const w = new Worker(new URL('./bake.worker.js', import.meta.url), { type: 'module' });
      w.load = 0;
      w.onmessage = (e) => {
        const p = pending.get(e.data.id); if (!p) return;
        pending.delete(e.data.id); w.load--;
        if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.r);
      };
      workers.push(w);
    } catch { /* module workers unsupported: bake inline */ }
  }
  return workers;
}
let inline = null;
function bakeRaw(kind, params, quality) {
  const ws = pool();
  if (ws.length) {
    const w = ws.reduce((a, b) => (b.load < a.load ? b : a));
    w.load++;
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      w.postMessage({ id, kind, params, quality });
    });
  }
  inline = inline || import('./bake.js');
  return inline.then((m) => new Promise((r) => setTimeout(() => r(m.bake(kind, params, quality)), 0)));
}
const GEO = new Map();
const FINE = new Set(['hands', 'glove', 'zip', 'armband', 'rope', 'ropeBelt']); // thin parts keep a finer grid
function geometry(kind, params) {
  const q = FINE.has(kind) ? 1.2 : QUALITY;
  const key = kind + JSON.stringify(params);
  if (!GEO.has(key)) {
    GEO.set(key, bakeRaw(kind, params, q).then((r) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(r.position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(r.normal, 3));
      g.setAttribute('skinIndex', new THREE.BufferAttribute(r.skinIndex, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(r.skinWeight, 4));
      g.setIndex(new THREE.BufferAttribute(r.index, 1));
      g.computeBoundingSphere();
      return g;
    }).catch((e) => { GEO.delete(key); throw e; }));
  }
  return GEO.get(key);
}

/* ================= spec → parts ================= */
function partsFor(s) {
  const P = [];
  const add = (kind, params, mat) => P.push({ kind, params, mat });
  const sk = () => skinMat(s.skin, s.freckles);
  add('head', {}, sk); add('hands', {}, sk); add('legs', {}, sk);

  const Tp = TOPS[s.top], g = Tp.g;
  add('top', { g }, () => cloth(s.topColor, g.tex || 'cotton', 22));
  if (g.zones === 'block') {
    add('topZone', { g, zone: 0 }, () => cloth(s.topAccent, g.tex, 22));
    add('topZone', { g, zone: 1 }, () => cloth(0xd9d0b2, g.tex, 22));
    add('zip', { g }, () => cloth(0xd06a2a, 'cotton', 40, 0.5));
  } else if (g.armband) {
    add('armband', { g }, () => cloth(s.topAccent, 'cotton', 30, 0.6));
    add('zip', { g }, () => cloth(0x3a3048, 'cotton', 40, 0.5));
  } else if (g.tee) add('tee', {}, () => cloth(s.topAccent, 'cotton', 22));
  else add('zip', { g }, () => cloth(s.topAccent, 'cotton', 40, 0.5));

  const B = BOTTOMS[s.bottom];
  if (B.g.type === 'skirt') {
    add('bottom', { g: { type: 'shorts' } }, () => cloth(0x55585e));
    add('skirt', {}, () => cloth(s.bottomColor, B.tex, 10));
  } else add('bottom', { g: B.g }, () => cloth(s.bottomColor, B.tex || 'cotton', 20));

  const S = SHOES[s.shoes];
  add('shoes', { type: S.g.type }, () => cloth(s.shoesColor, S.tex || 'mesh', 26, 0.7));
  add('soles', {}, () => cloth(s.soleColor, 'cotton', 30, 0.8));

  const A = s.acc;
  const ac = (k) => A[k].c, ac2 = (k) => A[k].c2 ?? A[k].c;
  if (A.phones) add('phones', {}, () => plain(ac('phones'), 0.4));
  if (A.goggles) add('goggles', {}, () => plain(0x1c1c1e, 0.4));
  if (A.gloves) add('glove', { fingerless: false }, () => cloth(ac('gloves'), 'cotton', 40, 0.7));
  if (A.fingerless) add('glove', { fingerless: true }, () => cloth(ac('fingerless'), 'cotton', 40, 0.7));
  if (A.leggings) add('leggings', {}, () => cloth(ac('leggings'), 'knit', 30));
  if (A.socks) add('socks', { lo: 0.12, hi: 0.2 }, () => cloth(ac('socks'), 'knit', 30));
  if (A.longsocks) add('socks', { lo: 0.12, hi: 0.25 }, () => cloth(ac('longsocks'), 'knit', 30));
  if (A.gaiters) add('gaiters', {}, () => cloth(ac('gaiters'), 'ripstop', 24));
  for (const k of ['daypack', 'bigpack', 'campack']) if (A[k]) {
    const big = k !== 'daypack';
    add('pack', { big }, () => cloth(ac(k), ACCESSORIES[k].tex || 'ripstop', 16));
    add('straps', { sternum: true, hipBelt: big }, () => cloth(ac2(k), 'cotton', 40, 0.7));
  }
  if (A.vest) add('vest', {}, () => cloth(ac('vest'), 'ripstop', 16));
  if (A.sling) { add('sling', {}, () => cloth(ac('sling'), 'ripstop', 16)); add('slingStrap', {}, () => cloth(ac2('sling'), 'cotton', 40, 0.7)); }
  if (A.rope) add('rope', {}, () => cloth(ac('rope'), 'knit', 60, 0.7));
  if (A.ropeBelt) add('ropeBelt', {}, () => cloth(ac('ropeBelt'), 'knit', 60, 0.7));

  const hat = s.hat !== 'none' ? s.hat : null;
  add('hair', { hair: s.hair, cut: hat ? (HATS[hat].cut ?? 1.13) : 0 }, () => plain(s.hairColor, 0.6));
  if (hat) add('hat', { hat }, () => cloth(s.hatColor, HATS[hat].tex || 'cotton', HATS[hat].texScale || 22));
  return P;
}

/* ================= face (rigid on the head bone) ================= */
function buildFace(face, s) {
  const E = EYES[s.eyes], skin = s.skin, hairColor = s.hairColor;
  const r = 0.036, white = new THREE.MeshStandardMaterial({ color: 0xfbf8f2, roughness: 0.25 });
  const iris = new THREE.MeshStandardMaterial({ color: s.iris, roughness: 0.3 }), pupil = new THREE.MeshBasicMaterial({ color: 0x120c08 });
  const shine = new THREE.MeshBasicMaterial({ color: 0xffffff }), lidMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(skin).multiplyScalar(0.94), roughness: 0.55, emissive: new THREE.Color(skin).multiplyScalar(0.28) });
  const lash = new THREE.MeshBasicMaterial({ color: 0x1c1410 }), browMat = plain(hairColor);
  const [sx, sy] = E.scale || [1, 1], cover = E.cover ?? 0.62, tilt = E.tilt ?? 0;
  const lids = [];
  for (const sd of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(sd * 0.061, 1.03, 0.124); g.rotation.z = sd * tilt; g.scale.set(sx, sy, 1); face.add(g);
    if (E.smile) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.02, 24, 16), lidMat); cap.scale.z = 0.45; g.add(cap);
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.0045, 8, 20, Math.PI), lash); arc.position.set(0, -0.004, r * 0.47); g.add(arc);
    } else {
      g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), white));
      const look = new THREE.Group(); look.rotation.set(0.06, -sd * 0.04, 0); g.add(look);
      const ir = new THREE.Mesh(new THREE.SphereGeometry(r * 1.006, 24, 14, 0, Math.PI * 2, 0, E.irisSize ?? 0.64), iris); ir.rotation.x = Math.PI / 2; look.add(ir);
      const pu = new THREE.Mesh(new THREE.SphereGeometry(r * 1.009, 24, 14, 0, Math.PI * 2, 0, (E.irisSize ?? 0.64) * 0.46), pupil); pu.rotation.x = Math.PI / 2; look.add(pu);
      const sh1 = new THREE.Mesh(new THREE.SphereGeometry(0.0072, 10, 8), shine); sh1.position.set(0.011, 0.012, r * 0.97); g.add(sh1);
      if ((E.shine ?? 1) > 1) { const sh2 = new THREE.Mesh(new THREE.SphereGeometry(0.0038, 8, 6), shine); sh2.position.set(-0.008, -0.009, r * 0.99); g.add(sh2); }
      const lid = new THREE.Group(); lid.rotation.x = 0.12; g.add(lid);
      const rl = r * 1.04;
      lid.add(new THREE.Mesh(new THREE.SphereGeometry(rl, 24, 12, 0, Math.PI * 2, 0, cover), lidMat));
      const rim = new THREE.Mesh(new THREE.TorusGeometry(rl * Math.sin(cover), 0.0022 * (E.lash ?? 1), 6, 30, Math.PI).rotateX(Math.PI / 2), lash);
      rim.position.y = rl * Math.cos(cover); lid.add(rim);
      if (E.flick) for (const k of [0, 1]) { const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0022, 0.012, 3, 6), lash); f.position.set(sd * (rl * Math.sin(cover) - 0.002), rl * Math.cos(cover) + 0.006 + k * 0.004, 0.012 - k * 0.008); f.rotation.z = -sd * (0.9 + k * 0.3); lid.add(f); }
      if (E.lower) { const lo = new THREE.Group(); lo.rotation.x = -0.35; g.add(lo); lo.add(new THREE.Mesh(new THREE.SphereGeometry(rl * 0.99, 24, 8, 0, Math.PI * 2, Math.PI - E.lower, E.lower), lidMat)); }
      // blink: a full-cover lid shown for a moment
      const blink = new THREE.Mesh(new THREE.SphereGeometry(rl * 1.004, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), lidMat);
      blink.rotation.x = 0.12; blink.visible = false; g.add(blink); lids.push(blink);
    }
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.0062, 0.038, 4, 8).rotateZ(Math.PI / 2 - sd * (0.1 + (E.brow ?? 0))), browMat);
    brow.position.set(sd * 0.064, 1.098 + (E.brow ?? 0) * 0.01, 0.16); face.add(brow);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0036, 6, 18, Math.PI * 0.72).rotateZ(Math.PI + 0.36), new THREE.MeshBasicMaterial({ color: 0x8a3c30 }));
  mouth.position.set(0.006, 0.928, 0.152); face.add(mouth);
  if (s.acc.goggles) {
    const lens = new THREE.MeshStandardMaterial({ color: s.acc.goggles.c, roughness: 0.15, metalness: 0.3 });
    for (const sd of [-1, 1]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.034, 20, 12).scale(1.5, 0.75, 0.6), lens); l.position.set(sd * 0.055, 1.2, 0.186); face.add(l); }
  }
  const H = HAIR[s.hair];
  if (H.tie) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 8, 16), cloth(0xc84a4a)); t.position.set(...H.tie); t.rotation.x = 0.9; face.add(t); }
  face.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return lids;
}

/* ================= the character ================= */
export function createCharacter(scene) {
  const root = new THREE.Group();
  root.scale.setScalar(SCALE);
  scene.add(root);

  // bones in rest pose (identity rotations; offsets from the parent's landmark)
  const bones = BONES.map((b) => { const o = new THREE.Bone(); o.name = b.name; return o; });
  BONES.forEach((b, i) => {
    const p = b.parent < 0 ? [0, 0, 0] : BONES[b.parent].pos;
    bones[i].position.set(b.pos[0] - p[0], b.pos[1] - p[1], b.pos[2] - p[2]);
    (b.parent < 0 ? root : bones[b.parent]).add(bones[i]);
  });
  const inverses = BONES.map((b) => new THREE.Matrix4().makeTranslation(-b.pos[0], -b.pos[1], -b.pos[2]));
  const skeleton = new THREE.Skeleton(bones, inverses);
  const J = Object.fromEntries(Object.entries(BONE).map(([k, i]) => [k, bones[i]]));
  const rest = BONES.map((b, i) => bones[i].position.clone());

  // face rides the head bone; meshes inside use model-space positions
  let face = null, lids = [];
  const IDENT = new THREE.Matrix4();

  // axe in the right hand: handle along +z, blade toward −y (as the old hero)
  const wood = new THREE.MeshLambertMaterial({ color: 0x8a5a32 }), steel = new THREE.MeshLambertMaterial({ color: 0xb9c0c6 });
  const axe = new THREE.Group(); axe.position.set(0, -0.05, 0.01); axe.scale.setScalar(0.62); J.handR.add(axe);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.75, 8).rotateX(Math.PI / 2), wood); handle.position.z = 0.28; axe.add(handle);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.2, 0.13), steel); blade.position.set(0, -0.07, 0.6); axe.add(blade);
  axe.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  axe.visible = false;

  let meshes = [], token = 0, spec = null;

  async function apply(s) {
    s = sanitize(s);
    const my = ++token;
    const list = partsFor(s);
    const geos = await Promise.all(list.map((p) => geometry(p.kind, p.params)));
    if (my !== token) return false; // a newer choice arrived meanwhile
    for (const m of meshes) { root.remove(m); m.material.dispose(); }
    meshes = list.map((p, i) => {
      const m = new THREE.SkinnedMesh(geos[i], p.mat());
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      root.add(m);
      m.bind(skeleton, IDENT);
      return m;
    });
    if (face) { J.head.remove(face); face.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); }
    face = new THREE.Group(); face.position.set(-HEAD_PIVOT[0], -HEAD_PIVOT[1], -HEAD_PIVOT[2]); J.head.add(face);
    lids = buildFace(face, s);
    spec = s;
    return true;
  }

  const cur = Object.fromEntries(POSE_KEYS.map((k) => [k, 0]));
  const tg = { ...cur };
  let walkT = 0, breathT = 0, blinkT = 2;

  return {
    root,
    get spec() { return spec; },
    get ready() { return meshes.length > 0; },
    apply,
    /** target: action pose or null for locomotion (same contract as the old hero) */
    animate(dt, p, mag, run, target) {
      let rate;
      breathT += dt;
      if (target) {
        for (const k of POSE_KEYS) tg[k] = target[k] || 0;
        rate = 9;
      } else {
        walkT += dt * (mag > 0 ? (run ? 11 : 8) : 0);
        const amp = (p.swim ? 0.45 : run ? 0.85 : 0.6) * Math.min(1, mag * 1.5);
        const sw = mag > 0 ? Math.sin(walkT) * amp : 0;
        const knee = (ph) => (mag > 0 ? (0.1 + (run ? 1.3 : 0.75) * Math.max(0, Math.sin(ph - 0.9))) * Math.min(1, mag * 1.5) : 0.04);
        Object.assign(tg, {
          drop: mag > 0 ? -Math.abs(Math.cos(walkT)) * (run ? 0.05 : 0.025) : -0.005 * Math.sin(breathT * 1.8),
          back: 0, lean: run && mag ? 0.18 : mag ? 0.05 : 0, twist: sw * 0.12,
          legL: sw, legR: -sw, kneeL: knee(walkT + Math.PI), kneeR: knee(walkT),
          armLX: -sw * 0.9, armRX: sw * 0.9, elbowL: run ? -1.2 : -0.25, elbowR: run ? -1.2 : -0.25,
          armLZ: p.swim ? -0.9 + Math.sin(walkT) * 0.3 : -0.06,
          armRZ: p.swim ? 0.9 - Math.sin(walkT) * 0.3 : 0.06,
        });
        const lk = p.land || 0; // landing squash, 0..1
        tg.drop -= 0.22 * lk; tg.lean += 0.25 * lk; tg.legL -= 0.6 * lk; tg.legR -= 0.6 * lk;
        tg.kneeL += 1.1 * lk; tg.kneeR += 1.1 * lk; tg.armLZ -= 0.4 * lk; tg.armRZ += 0.4 * lk;
        if (!p.grounded && !p.swim) { tg.kneeL += 0.6; tg.kneeR += 0.3; tg.legL -= 0.3; }
        rate = 22;
      }
      const a = Math.min(1, dt * rate);
      for (const k of POSE_KEYS) cur[k] += (tg[k] - cur[k]) * a;

      root.position.set(p.x, p.y, p.z);
      root.rotation.y = p.face;
      J.hips.position.set(rest[0].x, rest[0].y + cur.drop * DROP_K, rest[0].z + cur.back * DROP_K);
      J.spine.rotation.set(cur.lean, cur.twist, 0);
      J.head.rotation.set(-cur.lean * 0.5, -cur.twist * 0.6, 0); // keep the gaze level
      J.thighL.rotation.x = cur.legL; J.thighR.rotation.x = cur.legR;
      J.shinL.rotation.x = cur.kneeL; J.shinR.rotation.x = cur.kneeR;
      J.footL.rotation.x = -(cur.legL + cur.kneeL) * 0.6; J.footR.rotation.x = -(cur.legR + cur.kneeR) * 0.6;
      J.upperArmL.rotation.set(cur.armLX, 0, cur.armLZ); J.upperArmR.rotation.set(cur.armRX, 0, cur.armRZ);
      J.foreArmL.rotation.x = cur.elbowL; J.foreArmR.rotation.x = cur.elbowR;
      axe.visible = !!(target && target.axe);
      // blink every few seconds
      blinkT -= dt;
      const shut = blinkT < 0.12;
      for (const l of lids) l.visible = shut;
      if (blinkT < 0) blinkT = 2.5 + Math.random() * 3;
    },
  };
}
