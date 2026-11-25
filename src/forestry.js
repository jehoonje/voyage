// Felling and regrowing trees. Trees are instances inside chunk InstancedMeshes;
// a tree record knows its meshes and instance index, so it can be posed alone.
import * as THREE from 'three';

export const CHOPPABLE = new Set(['pine', 'snowpine', 'broad', 'jungle', 'palm', 'birch', 'willow']);
export const RESPAWN_MS = 45000;
const GROW_MS = 2500;

/** tree key → time (performance.now ms) at which it grows back */
export const felled = new Map();

const d = new THREE.Object3D(), qFall = new THREE.Quaternion(), qYaw = new THREE.Quaternion();
const axis = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

/** fall: radians toward (dx,dz); grow: 0..1 scale factor */
export function poseTree(t, fall = 0, dx = 0, dz = 1, grow = 1) {
  axis.set(dz, 0, -dx).normalize();
  qFall.setFromAxisAngle(axis, fall);
  qYaw.setFromAxisAngle(UP, t.rr * 6.283);
  d.position.set(t.x, t.y, t.z);
  d.quaternion.copy(qFall).multiply(qYaw);
  d.scale.setScalar(t.sc * Math.max(grow, 0.0001));
  d.updateMatrix();
  for (const m of t.meshes) {
    m.setMatrixAt(t.idx, d.matrix);
    m.instanceMatrix.needsUpdate = true;
  }
}

/** set a tree's see-through amount (1 = solid) on all its parts */
export function fadeTree(t, f) {
  for (const m of t.meshes) {
    const a = m.geometry.attributes.aFade;
    if (!a) continue;
    a.setX(t.idx, f);
    a.needsUpdate = true;
  }
}

/** screen-door dissolve driven by the per-instance aFade attribute */
export function addFade(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFade; varying float vFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFade;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (vFade < .999) {
    float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
    if (n > vFade) discard;
  }`);
  };
}

const easeOutBack = (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);

const SEE_THROUGH = 0.28;

export function createForestry(chunks) {
  const growing = [];
  const faded = new Map(); // tree → current fade
  const hits = new Set();
  return {
    /** dissolve trees between head (a) and camera (b) */
    occlude(dt, ax, ay, az, bx, by, bz) {
      chunks.treesOnSegment(ax, ay, az, bx, by, bz, hits);
      for (const t of hits) if (!faded.has(t)) faded.set(t, 1);
      const k = Math.min(1, dt * 6);
      for (const [t, f] of faded) {
        const target = hits.has(t) ? SEE_THROUGH : 1;
        const nf = f + (target - f) * k;
        if (target === 1 && nf > 0.99) { fadeTree(t, 1); faded.delete(t); continue; }
        faded.set(t, nf);
        fadeTree(t, nf);
      }
    },
    update(now) {
      for (const [key, at] of felled) {
        if (now < at) continue;
        felled.delete(key);
        const t = chunks.treeAt(key);
        if (t) growing.push({ t, start: now });
      }
      for (let i = growing.length - 1; i >= 0; i--) {
        const g = growing[i], k = Math.min(1, (now - g.start) / GROW_MS);
        poseTree(g.t, 0, 0, 1, easeOutBack(k));
        if (k >= 1) { g.t.hidden = false; growing.splice(i, 1); }
      }
    },
  };
}
