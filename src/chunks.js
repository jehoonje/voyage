// Streams terrain chunks around the player: build near, drop far, cull off-screen.
import * as THREE from 'three';
import { hash2, vnoise } from './noise.js';
import { sample, biome, groundColor, splat, weights } from './world.js';
import { createTerrainMaterial } from './terrainMaterial.js';
import { TYPES, TINT, pickVegetation } from './vegetation.js';
import { CHOPPABLE, felled, poseTree, treeStretch } from './forestry.js';

export const CHUNK = 48;
const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
// phones stream a smaller ring of chunks (dense foliage is expensive)
const SEG = 32, RADIUS = touch ? 2 : 3, STEP = CHUNK / SEG, VEG_GRID = 4;
/** trunk radius per type, before instance scale */
const TRUNK_R = { pine: 0.3, snowpine: 0.3, broad: 0.36, jungle: 0.5, palm: 0.26, cactus: 0.42, birch: 0.17, willow: 0.5 };
/** solid props: [collider radius, scale range [min, span]] before instance scale */
const PROPS = { seastack: [1.5, 0.8, 0.8], crag: [1.3, 0.5, 0.5], hoodoo: [1.2, 0.6, 0.7], stonehead: [2.4, 0.95, 0.25], redrock: [0, 0.6, 1.6], snowrock: [0, 0.6, 1.6], rock: [0, 0.6, 1.6] };
/** [centre height, radius] spheres approximating each tree type, before instance scale */
const OCCLUDERS = {
  pine: [[1.2, 0.45], [3.0, 1.8], [4.8, 1.3], [6.2, 0.8]],
  snowpine: [[1.2, 0.45], [3.0, 1.8], [4.8, 1.3], [6.2, 0.8]],
  broad: [[1.2, 0.5], [3.8, 2.0]],
  jungle: [[2, 0.6], [4.5, 0.6], [7.4, 3.0]],
  palm: [[2.5, 0.4], [5.3, 2.4]],
  birch: [[1.6, 0.3], [4.9, 1.6]],
  willow: [[1.3, 0.6], [3.6, 2.7]],
};

export class ChunkManager {
  constructor(scene) {
    this.scene = scene;
    this.mat = createTerrainMaterial();
    this.chunks = new Map();
    this.queue = [];
    this.center = '';
    this._dummy = new THREE.Object3D();
    this._col = new THREE.Color();
    this._tmp = [0, 0, 0];
    this._frustum = new THREE.Frustum();
    this._pm = new THREE.Matrix4();
  }

  build(cx, cz) {
    const n = SEG + 1, W = SEG + 3, hg = new Float32Array(W * W);
    const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3);
    const cl = new Float32Array(n * n * 3), sw = new Float32Array(n * n * 4), dz = new Float32Array(n * n);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    let hmin = 1e9, hmax = -1e9;
    const ss = [];
    // one extra ring of samples so normals match across chunk seams
    for (let j = -1; j <= SEG + 1; j++) for (let i = -1; i <= SEG + 1; i++) {
      const s = sample(x0 + i * STEP, z0 + j * STEP);
      hg[(j + 1) * W + i + 1] = s.h;
      if (i >= 0 && j >= 0 && i <= SEG && j <= SEG) ss[j * n + i] = s;
    }
    const tmp = this._tmp;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, s = ss[k], x = x0 + i * STEP, z = z0 + j * STEP, a = (j + 1) * W + i + 1;
      pos[k * 3] = x; pos[k * 3 + 1] = s.h; pos[k * 3 + 2] = z;
      const nx = hg[a - 1] - hg[a + 1], ny = 2 * STEP, nz = hg[a - W] - hg[a + W];
      const l = Math.hypot(nx, ny, nz);
      nor[k * 3] = nx / l; nor[k * 3 + 1] = ny / l; nor[k * 3 + 2] = nz / l;
      groundColor(s, x, z, tmp);
      cl[k * 3] = tmp[0]; cl[k * 3 + 1] = tmp[1]; cl[k * 3 + 2] = tmp[2];
      splat(s, sw, k * 4);
      dz[k] = weights(s)[0];
      if (s.h < hmin) hmin = s.h;
      if (s.h > hmax) hmax = s.h;
    }
    const idx = [];
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cl, 3));
    geo.setAttribute('aW', new THREE.BufferAttribute(sw, 4));
    geo.setAttribute('aD', new THREE.BufferAttribute(dz, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();

    const group = new THREE.Group();
    const ground = new THREE.Mesh(geo, this.mat);
    ground.receiveShadow = true;
    group.add(ground);
    const { meshes, trees, solids } = this._vegetation(cx, cz, group);

    this.scene.add(group);
    const sphere = new THREE.Sphere(
      new THREE.Vector3(x0 + CHUNK / 2, (hmin + hmax) / 2 + 4, z0 + CHUNK / 2),
      CHUNK * 0.75 + (hmax - hmin) / 2 + 8,
    );
    this.chunks.set(cx + ',' + cz, { group, geo, sphere, meshes, trees, solids });
  }

  _vegetation(cx, cz, group) {
    const lists = {}, gn = CHUNK / VEG_GRID;
    for (let gj = 0; gj < gn; gj++) for (let gi = 0; gi < gn; gi++) {
      const wi = cx * gn + gi, wj = cz * gn + gj;
      const r = hash2(wi * 3 + 1, wj * 7 + 2);
      if (r > 0.82) continue;
      const x = (wi + hash2(wi, wj * 5 + 9)) * VEG_GRID, z = (wj + hash2(wi * 11 + 3, wj)) * VEG_GRID;
      const s = sample(x, z), b = biome(s);
      // landmarks: a rare colossal stone head somewhere in the dunes
      let t = b === 'desert' && hash2(wi * 13 + 5, wj * 29 + 1) < 0.00005 && s.h < 30 ? 'stonehead'
        : pickVegetation(b, r, s.h, b === 'sea' ? Math.max(0, vnoise(x * 0.012 + 40, z * 0.012 - 9)) : 0);
      if (!t) continue;
      (lists[t] || (lists[t] = [])).push(x, s.h - 0.15, z, hash2(wi + 77, wj - 31), wi, wj);
    }
    const meshes = [], trees = new Map(), solids = [], dummy = this._dummy, col = this._col;
    for (const t in lists) {
      const L = lists[t], cnt = L.length / 6, typeMeshes = [];
      for (const [g, mat, tint] of TYPES[t]) {
        // per-chunk geometry wrapper: shares the vertex buffers, adds a per-instance fade
        const geo = new THREE.BufferGeometry();
        geo.setIndex(g.index);
        for (const name in g.attributes) geo.setAttribute(name, g.attributes[name]);
        geo.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(cnt).fill(1), 1));
        const im = new THREE.InstancedMesh(geo, mat, cnt);
        im.frustumCulled = false; // culled per chunk instead
        im.castShadow = true;
        if (mat.userData.depth) im.customDepthMaterial = mat.userData.depth; // leaf-shaped shadows
        for (let q = 0; q < cnt; q++) {
          const rr = L[q * 6 + 3], P = PROPS[t], sc = P ? P[1] + rr * P[2] : 0.75 + rr * 0.6;
          dummy.position.set(L[q * 6], L[q * 6 + 1] - (t === 'stonehead' ? 0.6 : 0), L[q * 6 + 2]);
          dummy.rotation.set(0, rr * 6.283, 0);
          if (P && !P[0]) dummy.scale.set(sc * (1 + rr), sc * 0.65, sc); // boulders: squat
          else if (TRUNK_R[t] && t !== 'cactus') dummy.scale.set(sc, sc * treeStretch(rr), sc);
          else dummy.scale.setScalar(sc);
          dummy.updateMatrix();
          im.setMatrixAt(q, dummy.matrix);
          if (tint) {
            const b = TINT[tint], v = 0.82 + rr * 0.36;
            col.setRGB(b[0] * v, b[1] * (0.9 + rr * 0.2), b[2] * v);
            im.setColorAt(q, col);
          }
        }
        group.add(im);
        meshes.push(im);
        typeMeshes.push(im);
      }
      if (CHOPPABLE.has(t)) {
        for (let q = 0; q < cnt; q++) {
          const rr = L[q * 6 + 3], key = L[q * 6 + 4] + ',' + L[q * 6 + 5];
          const tree = { key, type: t, x: L[q * 6], y: L[q * 6 + 1], z: L[q * 6 + 2], rr, sc: 0.75 + rr * 0.6, meshes: typeMeshes, idx: q, hidden: false, busy: false };
          if (felled.has(key)) { tree.hidden = true; poseTree(tree, 0, 0, 1, 0); }
          trees.set(key, tree);
          solids.push({ x: tree.x, z: tree.z, r: TRUNK_R[t] * tree.sc, top: Infinity, tree });
        }
      } else if (t === 'cactus' || PROPS[t]) {
        for (let q = 0; q < cnt; q++) {
          const rr = L[q * 6 + 3], x = L[q * 6], y = L[q * 6 + 1], z = L[q * 6 + 2], P = PROPS[t];
          if (t === 'cactus') solids.push({ x, z, r: TRUNK_R.cactus * (0.75 + rr * 0.6), top: Infinity });
          else if (P[0]) solids.push({ x, z, r: P[0] * (P[1] + rr * P[2]), top: Infinity }); // pillars and statues
          else {
            const sc = P[1] + rr * P[2];
            if (sc > 0.9) solids.push({ x, z, r: sc * (1 + rr * 0.5) * 0.8, top: y + sc * 0.6 });
          }
        }
      }
    }
    return { meshes, trees, solids };
  }

  drop(key) {
    const c = this.chunks.get(key);
    this.scene.remove(c.group);
    c.geo.dispose();
    for (const m of c.meshes) { m.geometry.dispose(); m.dispose(); }
    this.chunks.delete(key);
  }

  /** queue chunks around (px,pz); sync builds everything immediately */
  update(px, pz, sync = false) {
    const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK), key = ccx + ',' + ccz;
    if (key === this.center && !sync) return;
    this.center = key;
    for (const k of [...this.chunks.keys()]) {
      const [a, b] = k.split(',').map(Number);
      if (Math.abs(a - ccx) > RADIUS + 1 || Math.abs(b - ccz) > RADIUS + 1) this.drop(k);
    }
    this.queue = [];
    for (let j = -RADIUS; j <= RADIUS; j++) for (let i = -RADIUS; i <= RADIUS; i++) {
      if (!this.chunks.has(ccx + i + ',' + (ccz + j))) this.queue.push([ccx + i, ccz + j, i * i + j * j]);
    }
    this.queue.sort((a, b) => a[2] - b[2]);
    if (sync) { for (const q of this.queue) this.build(q[0], q[1]); this.queue = []; }
  }

  /** build a few queued chunks per frame to avoid hitches */
  pump(perFrame = 2) {
    for (let n = 0; n < perFrame && this.queue.length; n++) {
      const q = this.queue.shift();
      if (!this.chunks.has(q[0] + ',' + q[1])) this.build(q[0], q[1]);
    }
  }

  /** solid colliders within ~4 m of (px,pz), written into out */
  solidsNear(px, pz, out) {
    out.length = 0;
    const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const c = this.chunks.get(ccx + i + ',' + (ccz + j));
      if (!c) continue;
      for (const s of c.solids) {
        if (s.tree && s.tree.hidden) continue;
        if (Math.abs(s.x - px) < 4 && Math.abs(s.z - pz) < 4) out.push(s);
      }
    }
    return out;
  }

  /** tree record by key "wi,wj", if its chunk is loaded */
  treeAt(key) {
    const [wi, wj] = key.split(',').map(Number), gn = CHUNK / VEG_GRID;
    const c = this.chunks.get(Math.floor(wi / gn) + ',' + Math.floor(wj / gn));
    return c ? c.trees.get(key) : null;
  }

  /** closest standing tree within maxD of (px,pz) */
  nearestTree(px, pz, maxD) {
    const ccx = Math.floor(px / CHUNK), ccz = Math.floor(pz / CHUNK);
    let best = null, bd = maxD * maxD;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const c = this.chunks.get(ccx + i + ',' + (ccz + j));
      if (!c) continue;
      for (const t of c.trees.values()) {
        if (t.hidden || t.busy) continue;
        const d = (t.x - px) ** 2 + (t.z - pz) ** 2;
        if (d < bd) { bd = d; best = t; }
      }
    }
    return best;
  }

  /**
   * Trees whose crown or trunk (rough spheres per type) the segment a→b passes through.
   * Used to dissolve trees standing between the camera and the hero.
   */
  treesOnSegment(ax, ay, az, bx, by, bz, out) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, len2 = dx * dx + dy * dy + dz * dz;
    const ccx = Math.floor(ax / CHUNK), ccz = Math.floor(az / CHUNK);
    out.clear();
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const c = this.chunks.get(ccx + i + ',' + (ccz + j));
      if (!c) continue;
      for (const t of c.trees.values()) {
        if (t.hidden) continue;
        if (Math.abs(t.x - ax) > 16 || Math.abs(t.z - az) > 16) continue;
        for (const [cy, r] of OCCLUDERS[t.type]) {
          const ox = t.x - ax, oy = t.y + cy * t.sc - ay, oz = t.z - az, rr = r * t.sc + 0.3;
          const proj = Math.min(1, Math.max(0, (ox * dx + oy * dy + oz * dz) / len2));
          if (proj <= 0.02) continue;
          const px = ox - dx * proj, py = oy - dy * proj, pz = oz - dz * proj;
          if (px * px + py * py + pz * pz < rr * rr) { out.add(t); break; }
        }
      }
    }
    return out;
  }

  /** hide chunks outside the view, but keep nearby ones so they still cast shadows into it */
  cull(camera, px, pz) {
    this._pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._pm);
    for (const c of this.chunks.values()) {
      const dx = c.sphere.center.x - px, dz = c.sphere.center.z - pz;
      c.group.visible = this._frustum.intersectsSphere(c.sphere) || Math.hypot(dx, dz) < c.sphere.radius + 60;
    }
  }
}
