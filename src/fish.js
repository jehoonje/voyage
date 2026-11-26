// Fish: schools of small fish (the most common) and a few larger ones, swimming at random
// through rivers and the sea around the player. Instanced per species; tails swish in the
// vertex shader. Schools wander, turn away from shallows and banks, and scatter if you swim close.
import * as THREE from 'three';
import F from './fishModels.js';
import { sample } from './world.js';
import { windTime } from './wind.js';

/** weight: how often a school is this kind; seaOnly: reef fish stay out of rivers */
const SPECIES = {
  minnow: { weight: 0.6, school: [10, 22], len: [0.3, 0.42], speed: 1.5, wag: 15, amp: 0.1, spread: 1.4, max: 220, seaOnly: false },
  tang: { weight: 0.15, school: [2, 5], len: [0.52, 0.66], speed: 1.1, wag: 9, amp: 0.08, spread: 1.6, max: 40, seaOnly: true },
  clown: { weight: 0.12, school: [2, 4], len: [0.4, 0.5], speed: 0.9, wag: 11, amp: 0.09, spread: 1.2, max: 32, seaOnly: true },
  snapper: { weight: 0.13, school: [1, 3], len: [0.7, 0.9], speed: 1.3, wag: 7, amp: 0.07, spread: 2.2, max: 30, seaOnly: false },
};
const MAX_SCHOOLS = 16, SPAWN_R = [5, 44], DESPAWN_R = 62, MIN_DEPTH = 1.0;

function geometryOf(f) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(f.p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(f.c.map((v) => v / 255), 3));
  g.setIndex(f.i);
  g.computeVertexNormals();
  return g;
}

/** a fish body bends side to side, more toward the tail; aPh gives each fish its own beat */
function swimMaterial(sp) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windTime;
    sh.uniforms.uWag = { value: sp.wag };
    sh.uniforms.uAmp = { value: sp.amp };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uWag, uAmp; attribute float aPh;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  float back = clamp(.25 - position.z * 1.5, 0., 1.2); // 0 at the head, ~1 at the tail
  transformed.x += sin(uTime * uWag + aPh - position.z * 6.) * uAmp * back * back;`);
  };
  return m;
}

export function createFish(scene) {
  const kinds = {};
  for (const [name, sp] of Object.entries(SPECIES)) {
    const mesh = new THREE.InstancedMesh(geometryOf(F[name]), swimMaterial(sp), sp.max);
    const ph = new Float32Array(sp.max);
    for (let i = 0; i < sp.max; i++) ph[i] = Math.random() * 6.283;
    mesh.geometry.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph, 1));
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
    kinds[name] = { sp, mesh, used: 0 };
  }

  const schools = [];
  let spawnT = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pv = new THREE.Vector3();

  /** water depth at a point (0 on land) and whether it's sea */
  const water = (x, z) => { const s = sample(x, z); return { depth: Math.max(0, -s.h), sea: !s.riv, floor: s.h }; };

  function pickSpecies(sea) {
    const opts = Object.entries(SPECIES).filter(([, s]) => sea || !s.seaOnly);
    let r = Math.random() * opts.reduce((a, [, s]) => a + s.weight, 0);
    for (const [n, s] of opts) { r -= s.weight; if (r <= 0) return n; }
    return opts[0][0];
  }

  function spawn(px, pz) {
    for (let tries = 0; tries < 6; tries++) {
      const a = Math.random() * 6.283, r = SPAWN_R[0] + Math.random() * (SPAWN_R[1] - SPAWN_R[0]);
      const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r, w = water(x, z);
      if (w.depth < MIN_DEPTH + 0.3) continue;
      const name = pickSpecies(w.sea), K = kinds[name], sp = K.sp;
      const n = Math.min(sp.school[0] + Math.floor(Math.random() * (sp.school[1] - sp.school[0] + 1)), sp.max - K.used);
      if (n <= 0) continue;
      K.used += n;
      const fish = [];
      for (let i = 0; i < n; i++) {
        const len = sp.len[0] + Math.random() * (sp.len[1] - sp.len[0]);
        const off = new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 2).multiplyScalar(sp.spread * (0.4 + Math.random() * 0.6));
        fish.push({ len, off, pos: new THREE.Vector3(x + off.x, -w.depth * 0.5 + off.y, z + off.z), yaw: a, pitch: 0, wob: Math.random() * 10 });
      }
      schools.push({ name, fish, x, z, y: -Math.min(w.depth * 0.5, 2), yaw: Math.random() * 6.283, speed: sp.speed * (0.7 + Math.random() * 0.5), turn: 0, dive: 0, flee: 0, t: Math.random() * 50 });
      return;
    }
  }

  return {
    /** P: the player (x, y, z, swim) */
    update(dt, P) {
      // keep a few schools around, drop ones left far behind
      // keep the water stocked: a few attempts each tick, so arriving at a lake it's already alive
      if ((spawnT -= dt) <= 0) {
        spawnT = 0.4;
        for (let k = 0; k < 4 && schools.length < MAX_SCHOOLS; k++) spawn(P.x, P.z);
      }
      for (let i = schools.length - 1; i >= 0; i--) {
        const s = schools[i];
        if (Math.hypot(s.x - P.x, s.z - P.z) > DESPAWN_R) { kinds[s.name].used -= s.fish.length; schools.splice(i, 1); }
      }

      for (const K of Object.values(kinds)) K.mesh.count = 0;
      for (const s of schools) {
        const sp = SPECIES[s.name], K = kinds[s.name];
        s.t += dt;
        // wander; look ahead and turn away from shallows and banks
        s.turn += (Math.sin(s.t * 0.37 + s.fish.length) * 0.6 - s.turn) * dt * 0.5;
        const ahead = water(s.x + Math.sin(s.yaw) * 3.5, s.z + Math.cos(s.yaw) * 3.5);
        const here = water(s.x, s.z);
        let turn = s.turn;
        if (ahead.depth < MIN_DEPTH) turn = 2.2;
        // scatter from a swimmer close by
        const dp = Math.hypot(s.x - P.x, s.z - P.z);
        if (P.swim && dp < 4.5) { s.flee = 1.2; s.yaw = Math.atan2(s.x - P.x, s.z - P.z); }
        s.flee = Math.max(0, s.flee - dt);
        s.yaw += turn * dt;
        const v = s.speed * (1 + s.flee * 1.8) * (ahead.depth < MIN_DEPTH ? 0.4 : 1);
        s.x += Math.sin(s.yaw) * v * dt; s.z += Math.cos(s.yaw) * v * dt;
        // rise and fall between the floor and just under the surface
        const top = -0.35, bottom = Math.min(-0.5, here.floor + 0.4);
        s.dive += (Math.sin(s.t * 0.21 + s.fish.length * 1.7) - s.dive) * dt * 0.3;
        const ty = bottom + (top - bottom) * (0.68 + 0.28 * s.dive); // mostly in the bright upper water
        s.y += (ty - s.y) * Math.min(1, dt * 0.8);
        const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);

        for (const f of s.fish) {
          // each fish keeps its slot in the school, drifting around it a little
          f.wob += dt;
          const ox = f.off.x + Math.sin(f.wob * 0.9) * 0.25, oz = f.off.z + Math.cos(f.wob * 0.7) * 0.3, oy = f.off.y + Math.sin(f.wob * 1.3) * 0.08;
          const tx = s.x + ox * cy + oz * sy, tz = s.z - ox * sy + oz * cy;
          const ty2 = Math.min(-0.15 - f.len * 0.3, Math.max(here.floor + 0.25, s.y + oy));
          pv.set(tx - f.pos.x, ty2 - f.pos.y, tz - f.pos.z);
          const k = Math.min(1, dt * (2.2 + s.flee * 3));
          f.pos.addScaledVector(pv, k);
          // face where it's going
          const mvx = pv.x, mvz = pv.z;
          if (mvx * mvx + mvz * mvz > 1e-6) {
            let d = Math.atan2(mvx, mvz) - f.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
            f.yaw += d * Math.min(1, dt * 5);
          }
          f.pitch += (Math.max(-0.5, Math.min(0.5, -pv.y * 2)) - f.pitch) * Math.min(1, dt * 3);
          if (K.mesh.count >= sp.max) continue;
          e.set(f.pitch, f.yaw, 0, 'YXZ');
          q.setFromEuler(e);
          m4.compose(f.pos, q, sc.setScalar(f.len));
          K.mesh.setMatrixAt(K.mesh.count++, m4);
        }
      }
      for (const K of Object.values(kinds)) K.mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
