// Streams terrain chunks around the player: build near, drop far, cull off-screen.
import * as THREE from 'three';
import { hash2 } from './noise.js';
import { sample, biome, groundColor, splat } from './world.js';
import { createTerrainMaterial } from './terrainMaterial.js';
import { TYPES, TINT, pickVegetation } from './vegetation.js';

export const CHUNK = 48;
const SEG = 16, RADIUS = 3, STEP = CHUNK / SEG, VEG_GRID = 4;

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
    const cl = new Float32Array(n * n * 3), sw = new Float32Array(n * n * 4);
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
    geo.setIndex(idx);
    geo.computeBoundingSphere();

    const group = new THREE.Group();
    const ground = new THREE.Mesh(geo, this.mat);
    ground.receiveShadow = true;
    group.add(ground);
    const meshes = this._vegetation(cx, cz, group);

    this.scene.add(group);
    const sphere = new THREE.Sphere(
      new THREE.Vector3(x0 + CHUNK / 2, (hmin + hmax) / 2 + 4, z0 + CHUNK / 2),
      CHUNK * 0.75 + (hmax - hmin) / 2 + 8,
    );
    this.chunks.set(cx + ',' + cz, { group, geo, sphere, meshes });
  }

  _vegetation(cx, cz, group) {
    const lists = {}, gn = CHUNK / VEG_GRID;
    for (let gj = 0; gj < gn; gj++) for (let gi = 0; gi < gn; gi++) {
      const wi = cx * gn + gi, wj = cz * gn + gj;
      const r = hash2(wi * 3 + 1, wj * 7 + 2);
      if (r > 0.82) continue;
      const x = (wi + hash2(wi, wj * 5 + 9)) * VEG_GRID, z = (wj + hash2(wi * 11 + 3, wj)) * VEG_GRID;
      const s = sample(x, z), t = pickVegetation(biome(s), r, s.h);
      if (!t) continue;
      (lists[t] || (lists[t] = [])).push(x, s.h - 0.15, z, hash2(wi + 77, wj - 31));
    }
    const meshes = [], dummy = this._dummy, col = this._col;
    for (const t in lists) {
      const L = lists[t], cnt = L.length / 4;
      for (const [g, mat, tint] of TYPES[t]) {
        const im = new THREE.InstancedMesh(g, mat, cnt);
        im.frustumCulled = false; // culled per chunk instead
        im.castShadow = true;
        for (let q = 0; q < cnt; q++) {
          const rr = L[q * 4 + 3], sc = t === 'rock' ? 0.6 + rr * 1.6 : 0.75 + rr * 0.6;
          dummy.position.set(L[q * 4], L[q * 4 + 1], L[q * 4 + 2]);
          dummy.rotation.set(0, rr * 6.283, 0);
          if (t === 'rock') dummy.scale.set(sc * (1 + rr), sc * 0.65, sc);
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
      }
    }
    return meshes;
  }

  drop(key) {
    const c = this.chunks.get(key);
    this.scene.remove(c.group);
    c.geo.dispose();
    for (const m of c.meshes) m.dispose();
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
