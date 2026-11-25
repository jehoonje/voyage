// The player's hiker: sculpted parts (baked in a worker, cached), skinned to one skeleton,
// and posed through the same pose numbers the old hero used (walk / run / jump / actions).
import * as THREE from 'three';
import { EYES, HAIR, HATS, TOPS, BOTTOMS, SHOES, ACCESSORIES, DEFAULT_SPEC, HEAD_PIVOT } from './parts.js';
import { BONES, BONE } from './rig.js';
import MOCAP from './mocap.js';

export const SCALE = 1.35; // model metres → world metres (about 1.7 m with hair)
export const POSE_KEYS = ['drop', 'back', 'lean', 'twist', 'legL', 'legR', 'kneeL', 'kneeR',
  'armLX', 'armRX', 'armLZ', 'armRZ', 'elbowL', 'elbowR'];
const QUALITY = 1.6;
const NECK_TUCK = 0.045; // model metres
const WALK_REF = 2.6, RUN_REF = 5.4; // keep in step with physics WALK / RUN // grid coarsening for game-ready triangle counts
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
outgoingLight += diffuseColor.rgb * .24; // soft fill so faces stay readable in shade
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
  const r = 0.036, white = new THREE.MeshStandardMaterial({ color: 0xece6dc, roughness: 0.45, emissive: 0xece6dc, emissiveIntensity: 0.2 });
  const iris = new THREE.MeshStandardMaterial({ color: s.iris, roughness: 0.35, emissive: s.iris, emissiveIntensity: 0.24 }), pupil = new THREE.MeshBasicMaterial({ color: 0x120c08 });
  const shine = new THREE.MeshBasicMaterial({ color: 0xffffff }), lidMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(skin).multiplyScalar(0.94), roughness: 0.55, emissive: new THREE.Color(skin).multiplyScalar(0.24) });
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

/* ================= key-pose run cycle ================= */
/** periodic track through [t, value] keys (t in 0..1), smooth Catmull-Rom between them */
function track(keys) {
  const n = keys.length;
  // key k (any integer) wraps around the loop, keeping time increasing
  const at = (k) => { const m = ((k % n) + n) % n; return [keys[m][0] + Math.floor(k / n), keys[m][1]]; };
  return (u) => {
    u -= Math.floor(u);
    let i = -1;
    while (i + 1 < n && keys[i + 1][0] <= u) i++;
    const [t0, p0] = at(i - 1), [t1, p1] = at(i), [t2, p2] = at(i + 1), [t3, p3] = at(i + 2);
    const span = t2 - t1, x = (u - t1) / span;
    const m1 = ((p2 - p0) / (t2 - t0)) * span, m2 = ((p3 - p1) / (t3 - t1)) * span;
    const x2 = x * x, x3 = x2 * x;
    return (2 * x3 - 3 * x2 + 1) * p1 + (x3 - 2 * x2 + x) * m1 + (-2 * x3 + 3 * x2) * p2 + (x3 - x2) * m2;
  };
}
/*
 * One leg through a run stride, u = 0 at its own foot strike:
 *   0 contact (foot ahead) · .12 down (weight sinks, knee gives) · .3 push-off · .42 toes leave
 *   .55–.7 heel folds up under the seat · .8 knee drives high in front · .92 reaching for the next strike
 * thigh: + = back · knee: + = bent · foot: ground-relative, + = toes down
 */
const RUN_LEG = {
  thigh: track([[0, -0.36], [0.12, -0.1], [0.3, 0.3], [0.42, 0.42], [0.55, 0.2], [0.7, -0.3], [0.82, -0.68], [0.92, -0.58]]),
  knee: track([[0, 0.14], [0.12, 0.42], [0.3, 0.2], [0.42, 0.45], [0.55, 1.55], [0.68, 1.9], [0.82, 1.2], [0.92, 0.4]]),
  foot: track([[0, -0.18], [0.12, 0.0], [0.3, 0.35], [0.42, 0.75], [0.55, 0.5], [0.72, 0.15], [0.86, -0.1]]),
};
/* body over one full cycle (left strike at 0, right strike at .5) */
const RUN_BODY = {
  // hips: sink after each strike, float during the flight between steps
  drop: track([[0, -0.01], [0.1, -0.045], [0.25, 0.0], [0.37, 0.03], [0.5, -0.01], [0.6, -0.045], [0.75, 0.0], [0.87, 0.03]]),
  lean: track([[0, 0.27], [0.1, 0.32], [0.3, 0.25], [0.5, 0.27], [0.6, 0.32], [0.8, 0.25]]),
};
/** left arm: forward as the right leg strikes, back as the left does; elbow closes in front */
const RUN_ARM = {
  x: track([[0, 0.6], [0.1, 0.62], [0.3, 0.05], [0.5, -0.62], [0.6, -0.66], [0.8, 0.0]]),
  elbow: track([[0, -1.2], [0.15, -1.25], [0.35, -1.65], [0.55, -2.1], [0.7, -1.95], [0.9, -1.45]]),
  y: track([[0, -0.05], [0.25, 0.12], [0.55, 0.38], [0.8, 0.15]]),
};

/* ================= mocap walk / run (Mixamo, retargeted by tools/mocap-convert.mjs) ================= */
const NB = BONES.length;
/** cartoon pacing: how much faster than real time a clip may play before the feet start to slide */
const MAX_RATE = { walk: 1.8, run: 1.7 };
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
/** pose at phase u (0..1) into out quats / out hip offset, wrapping smoothly */
function sampleClip(c, u, outQ, outP) {
  const x = (u - Math.floor(u)) * c.n, i = Math.floor(x) % c.n, j = (i + 1) % c.n, t = x - Math.floor(x);
  for (let b = 0; b < NB; b++) {
    const a = (i * NB + b) * 4, d = (j * NB + b) * 4;
    _qa.set(c.q[a], c.q[a + 1], c.q[a + 2], c.q[a + 3]);
    _qb.set(c.q[d], c.q[d + 1], c.q[d + 2], c.q[d + 3]);
    outQ[b].slerpQuaternions(_qa, _qb, t).normalize();
  }
  outP.set(c.p[i * 3] + (c.p[j * 3] - c.p[i * 3]) * t, c.p[i * 3 + 1] + (c.p[j * 3 + 1] - c.p[i * 3 + 1]) * t, c.p[i * 3 + 2] + (c.p[j * 3 + 2] - c.p[i * 3 + 2]) * t);
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
  bones[BONE.head].position.y -= NECK_TUCK; // shorter neck: the head (and all it carries) rides lower
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
      m.castShadow = true;
      m.receiveShadow = p.kind !== 'head'; // hat and hair would otherwise throw the whole face into shade
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

  // extra channels only locomotion drives (action poses leave them at 0)
  const KEYS = [...POSE_KEYS, 'hipYaw', 'sway', 'shiftX', 'chestRoll', 'headX', 'headY', 'toeL', 'toeR', 'armLY', 'armRY'];
  const cur = Object.fromEntries(KEYS.map((k) => [k, 0]));
  const tg = { ...cur };
  let phase = 0, breathT = 0, blinkT = 2, moveW = 0, runW = 0, airT = 0;
  let mocapU = 0, mocapW = 0;
  const mk = () => Array.from({ length: NB }, () => new THREE.Quaternion());
  const walkQ = mk(), runQ = mk(), walkP = new THREE.Vector3(), runP = new THREE.Vector3();
  const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const pos = (v) => (v > 0 ? v : 0);

  return {
    root,
    get spec() { return spec; },
    get ready() { return meshes.length > 0; },
    apply,
    /**
     * speed: actual ground speed (world m/s) so slopes and inertia show in the stride.
     * target: action pose or null for locomotion.
     */
    animate(dt, p, speed, target) {
      let rate;
      breathT += dt;
      if (target) {
        for (const k of KEYS) tg[k] = target[k] || 0;
        rate = 9;
      } else {
        // walk ↔ run blend follows speed, eased so starts and stops don't snap
        const mw = sat(speed / 1.6), rw = sat((speed - WALK_REF * 1.05) / (RUN_REF - WALK_REF * 1.05));
        moveW += (mw - moveW) * Math.min(1, dt * 7);
        runW += (rw - runW) * Math.min(1, dt * 5);
        // stride frequency rises with speed (cycles per second), phase advances with distance travelled
        const freq = p.swim ? 0.7 : 0.55 + 0.13 * Math.min(speed, RUN_REF);
        phase += dt * freq * Math.PI * 2 * (speed > 0.05 ? 1 : 0);
        const w = moveW, r = runW, f = phase;
        const sL = Math.sin(f), sR = -sL, cL = Math.cos(f);
        const legA = (0.42 + 0.3 * r) * w;
        // knee bends while the leg swings forward, a little give at heel strike
        const knee = (ph) => (0.05 + (0.08 + 0.04 * r) * pos(Math.sin(ph + 2.2)) + (0.7 + 0.75 * r) * Math.pow(pos(-Math.cos(ph - 0.35)), 1.4)) * w + 0.04 * (1 - w);
        const toe = (ph) => (0.45 * pos(Math.sin(ph) - 0.35) - 0.22 * pos(-Math.sin(ph) - 0.55) * (1 - r)) * w;
        const armA = (0.38 + 0.35 * r) * w, lag = 0.3;
        const idle = 1 - w;
        Object.assign(tg, {
          // two dips per cycle: low on contact when walking, at mid-stance when running
          drop: -(0.035 * (1 - r) * Math.abs(sL) + 0.075 * r * (1 - Math.abs(sL))) * w - (0.02 * r) - 0.006 * idle * (1 + Math.sin(breathT * 1.7)),
          back: 0,
          lean: 0.05 * w + 0.17 * r + 0.03 * r * Math.cos(2 * f) + 0.012 * idle * Math.sin(breathT * 1.7),
          twist: 0,
          hipYaw: -(0.1 + 0.08 * r) * sL * w,
          sway: (0.07 - 0.03 * r) * cL * w + 0.025 * idle * Math.sin(breathT * 0.45),
          shiftX: -0.012 * cL * w * (1 - r) + 0.006 * idle * Math.sin(breathT * 0.45),
          chestRoll: -0.05 * cL * w,
          headX: 0.03 * Math.cos(2 * f) * w + 0.015 * idle * Math.sin(breathT * 0.6),
          headY: 0.05 * idle * Math.sin(breathT * 0.31),
          legL: legA * sL - 0.06 * r * w, legR: legA * sR - 0.06 * r * w,
          kneeL: knee(f), kneeR: knee(f + Math.PI),
          toeL: toe(f), toeR: toe(f + Math.PI),
          armLX: -armA * Math.sin(f - lag) - 0.05 * r * w, armRX: armA * Math.sin(f - lag) - 0.05 * r * w,
          elbowL: -(0.22 + 0.25 * w * pos(Math.sin(f - lag + Math.PI)) + 1.05 * r - 0.2 * r * Math.sin(f - lag)),
          elbowR: -(0.22 + 0.25 * w * pos(Math.sin(f - lag)) + 1.05 * r + 0.2 * r * Math.sin(f - lag)),
          armLZ: -0.07 - 0.07 * r - 0.02 * idle * Math.sin(breathT * 1.7),
          armRZ: 0.07 + 0.07 * r + 0.02 * idle * Math.sin(breathT * 1.7),
        });
        // running: blend toward the key-pose cycle as speed climbs past a walk
        if (r > 0.001 && !p.swim) {
          const u = f / (Math.PI * 2) - 0.75; // align: left foot strike where the walk has the left leg forward
          const legKeys = (ul) => {
            const th = RUN_LEG.thigh(ul), kn = RUN_LEG.knee(ul);
            return [th, kn, RUN_LEG.foot(ul) + 0.15 * (th + kn)]; // foot bone is 85% counter-rotated below
          };
          const [thL, knL, ftL] = legKeys(u), [thR, knR, ftR] = legKeys(u + 0.5);
          const rk = (key, v) => { tg[key] += (v * w - tg[key]) * r; };
          rk('legL', thL); rk('legR', thR); rk('kneeL', knL); rk('kneeR', knR); rk('toeL', ftL); rk('toeR', ftR);
          rk('drop', RUN_BODY.drop(u)); rk('lean', RUN_BODY.lean(u));
          rk('hipYaw', 0.16 * Math.cos((u) * Math.PI * 2)); // the striking leg's hip reaches forward
          rk('sway', 0.05 * Math.sin(u * Math.PI * 2)); rk('shiftX', 0); rk('chestRoll', -0.03 * Math.sin(u * Math.PI * 2));
          rk('headX', 0.05 * Math.cos(u * Math.PI * 4 + 0.6));
          rk('armLX', RUN_ARM.x(u)); rk('armRX', RUN_ARM.x(u + 0.5));
          rk('elbowL', RUN_ARM.elbow(u)); rk('elbowR', RUN_ARM.elbow(u + 0.5));
          rk('armLY', RUN_ARM.y(u)); rk('armRY', -RUN_ARM.y(u + 0.5));
          rk('armLZ', -0.12); rk('armRZ', 0.12);
          // (rk scales by w, so arms rest naturally if the run fades out mid-stride)
        }
        if (p.swim) {
          Object.assign(tg, {
            armLZ: -0.9 + Math.sin(f) * 0.35, armRZ: 0.9 - Math.sin(f) * 0.35, armLX: -0.3 + Math.cos(f) * 0.3, armRX: -0.3 - Math.cos(f) * 0.3,
            elbowL: -0.5, elbowR: -0.5, legL: 0.3 * sL, legR: 0.3 * sR, kneeL: 0.3, kneeR: 0.3, lean: 0.25, drop: 0, hipYaw: 0,
          });
        }
        // airborne: knees tuck at the top of the jump, arms lift for balance
        airT = !p.grounded && !p.swim ? airT + dt : 0;
        if (airT > 0) {
          const a = sat(airT * 6);
          tg.kneeL += 0.7 * a; tg.kneeR += 0.35 * a; tg.legL -= 0.45 * a; tg.legR -= 0.1 * a;
          tg.armLZ -= 0.35 * a; tg.armRZ += 0.35 * a; tg.armLX -= 0.2 * a; tg.armRX += 0.15 * a; tg.elbowL -= 0.3 * a; tg.elbowR -= 0.3 * a;
          tg.toeL += 0.25 * a; tg.toeR += 0.25 * a;
        }
        const lk = p.land || 0; // landing squash, 0..1
        tg.drop -= 0.22 * lk; tg.lean += 0.25 * lk; tg.legL -= 0.6 * lk; tg.legR -= 0.6 * lk;
        tg.kneeL += 1.1 * lk; tg.kneeR += 1.1 * lk; tg.armLZ -= 0.4 * lk; tg.armRZ += 0.4 * lk;
        rate = 30;
      }
      const a = Math.min(1, dt * rate);
      for (const k of KEYS) cur[k] += (tg[k] - cur[k]) * a;

      root.position.set(p.x, p.y, p.z);
      root.rotation.y = p.face;
      for (const b of bones) b.quaternion.identity(); // start clean: the mocap blend below writes full rotations
      J.hips.position.set(rest[0].x + cur.shiftX, rest[0].y + cur.drop * DROP_K, rest[0].z + cur.back * DROP_K);
      J.hips.rotation.set(0, cur.hipYaw, cur.sway);
      // shoulders counter-rotate against the pelvis; spine leans
      J.spine.rotation.set(cur.lean, cur.twist - cur.hipYaw * 1.8, cur.chestRoll - cur.sway * 1.2);
      // head stays level and looks ahead whatever the body does
      J.head.rotation.set(-cur.lean * 0.6 + cur.headX, cur.hipYaw * 0.8 - cur.twist * 0.6 + cur.headY, -(cur.chestRoll - cur.sway * 0.2) * 0.8);
      J.thighL.rotation.set(cur.legL, 0, -cur.sway); J.thighR.rotation.set(cur.legR, 0, -cur.sway);
      J.shinL.rotation.x = cur.kneeL; J.shinR.rotation.x = cur.kneeR;
      J.footL.rotation.x = -(cur.legL + cur.kneeL) * 0.85 + cur.toeL; J.footR.rotation.x = -(cur.legR + cur.kneeR) * 0.85 + cur.toeR;
      J.upperArmL.rotation.set(cur.armLX, cur.armLY, cur.armLZ); J.upperArmR.rotation.set(cur.armRX, cur.armRY, cur.armRZ);
      J.foreArmL.rotation.x = cur.elbowL; J.foreArmR.rotation.x = cur.elbowR;
      // locomotion from mocap: blended over the procedural pose (which still drives idle, jumps, swimming, actions)
      const mwT = target || p.swim ? 0 : sat(speed / 0.9) * (airT > 0 ? 0 : 1) * (1 - (p.land || 0));
      mocapW += (mwT - mocapW) * Math.min(1, dt * (mwT > mocapW ? 8 : 12));
      if (speed > 0.02) {
        // playback rate keeps the planted foot under the body up to a cartoon cadence cap
        const W = MOCAP.walk, R = MOCAP.run, v = speed / SCALE;
        const rw = Math.min(MAX_RATE.walk, Math.max(0.5, v / W.speed)), rr = Math.min(MAX_RATE.run, Math.max(0.6, v / R.speed));
        mocapU += dt * ((1 - runW) * rw / W.duration + runW * rr / R.duration);
      }
      if (mocapW > 0.001) {
        sampleClip(MOCAP.walk, mocapU, walkQ, walkP);
        sampleClip(MOCAP.run, mocapU, runQ, runP);
        for (let b = 0; b < NB; b++) {
          walkQ[b].slerp(runQ[b], runW);
          bones[b].quaternion.slerp(walkQ[b], mocapW);
        }
        walkP.lerp(runP, runW);
        J.hips.position.x += (rest[0].x + walkP.x - J.hips.position.x) * mocapW;
        J.hips.position.y += (rest[0].y + walkP.y - J.hips.position.y) * mocapW;
        J.hips.position.z += (rest[0].z + walkP.z - J.hips.position.z) * mocapW;
      }
      axe.visible = !!(target && target.axe);
      // blink every few seconds
      blinkT -= dt;
      const shut = blinkT < 0.12;
      for (const l of lids) l.visible = shut;
      if (blinkT < 0) blinkT = 2.5 + Math.random() * 3;
    },
  };
}
