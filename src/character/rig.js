// Skeleton for the hiker: bone hierarchy at the sculpt's landmarks, and automatic
// skin weights (distance to each bone's segment, softly blended at the joints).
// Pure maths so the worker can weight a mesh right after meshing it.
import { ARM, LEG, HEAD_PIVOT } from './parts.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const aL = ARM(-1), aR = ARM(1), lL = LEG(-1), lR = LEG(1);

/**
 * L = the character's −x side (matches the old hero: armL/legL/kneeL).
 * pos: rest position in model space. seg: segment used for weighting. side: −1/+1 for limbs.
 */
export const BONES = [
  { name: 'hips', parent: -1, pos: [0, 0.42, 0], seg: [[-0.06, 0.43, 0], [0.06, 0.43, 0]] },
  { name: 'spine', parent: 0, pos: [0, 0.47, 0], seg: [[0, 0.5, 0], [0, 0.7, 0]] },
  { name: 'neck', parent: 1, pos: [0, 0.74, 0], seg: [[0, 0.74, 0], [0, 0.86, 0]] },
  { name: 'head', parent: 2, pos: HEAD_PIVOT, seg: [[0, 0.93, 0.02], [0, 1.12, 0]] },
  { name: 'upperArmL', parent: 1, pos: aL.sh, seg: [[-0.146, 0.655, 0], aL.el], side: -1 },
  { name: 'foreArmL', parent: 4, pos: aL.el, seg: [aL.el, aL.wr], side: -1 },
  { name: 'handL', parent: 5, pos: aL.wr, seg: [aL.wr, add(aL.wr, [0.004, -0.075, 0.01])], side: -1 },
  { name: 'upperArmR', parent: 1, pos: aR.sh, seg: [[0.146, 0.655, 0], aR.el], side: 1 },
  { name: 'foreArmR', parent: 7, pos: aR.el, seg: [aR.el, aR.wr], side: 1 },
  { name: 'handR', parent: 8, pos: aR.wr, seg: [aR.wr, add(aR.wr, [-0.004, -0.075, 0.01])], side: 1 },
  { name: 'thighL', parent: 0, pos: lL.hip, seg: [[lL.hip[0], 0.39, 0], lL.kn], side: -1 },
  { name: 'shinL', parent: 10, pos: lL.kn, seg: [lL.kn, [lL.an[0], 0.1, 0]], side: -1 },
  { name: 'footL', parent: 11, pos: lL.an, seg: [[lL.an[0], 0.07, 0], [lL.an[0] * 1.04, 0.03, 0.12]], side: -1 },
  { name: 'thighR', parent: 0, pos: lR.hip, seg: [[lR.hip[0], 0.39, 0], lR.kn], side: 1 },
  { name: 'shinR', parent: 13, pos: lR.kn, seg: [lR.kn, [lR.an[0], 0.1, 0]], side: 1 },
  { name: 'footR', parent: 14, pos: lR.an, seg: [[lR.an[0], 0.07, 0], [lR.an[0] * 1.04, 0.03, 0.12]], side: 1 },
];
export const BONE = Object.fromEntries(BONES.map((b, i) => [b.name, i]));

const pick = (...names) => names.flatMap((n) => BONES.map((b, i) => (b.name.startsWith(n) ? i : -1)).filter((i) => i >= 0));
/** which bones may move each kind of part (plus optional per-bone bias) */
const GROUPS = {
  head: { bones: pick('head', 'neck', 'spine') },
  skull: { bones: pick('head') },
  hair: { bones: pick('head', 'neck', 'spine') },
  hands: { bones: pick('hand', 'foreArm') },
  legs: { bones: pick('thigh', 'shin', 'foot', 'hips') },
  top: { bones: pick('spine', 'hips', 'neck', 'upperArm', 'foreArm') },
  bottom: { bones: pick('hips', 'thigh', 'shin', 'foot') },
  skirt: { bones: pick('hips', 'thigh'), bias: { thigh: 0.25 } },
  feet: { bones: pick('foot', 'shin') },
  chest: { bones: pick('spine') },
  harness: { bones: pick('spine', 'hips') },
  hips: { bones: pick('hips') },
};

function segDist(px, py, pz, a, b) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const qx = px - a[0], qy = py - a[1], qz = pz - a[2];
  let h = (qx * bx + qy * by + qz * bz) / (bx * bx + by * by + bz * bz);
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  return Math.hypot(qx - bx * h, qy - by * h, qz - bz * h);
}

/** skinIndex / skinWeight (4 per vertex) for positions in model space */
export function skinWeights(position, group) {
  const G = GROUPS[group];
  const n = position.length / 3;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  if (G.bones.length === 1) {
    for (let v = 0; v < n; v++) { si[v * 4] = G.bones[0]; sw[v * 4] = 1; }
    return { skinIndex: si, skinWeight: sw };
  }
  const bias = G.bones.map((i) => { const b = G.bias || {}; const k = Object.keys(b).find((key) => BONES[i].name.startsWith(key)); return k ? b[k] : 1; });
  const d = new Float32Array(G.bones.length), w = new Float32Array(G.bones.length);
  const TAU = 0.011; // joint blend width (m)
  for (let v = 0; v < n; v++) {
    const x = position[v * 3], y = position[v * 3 + 1], z = position[v * 3 + 2];
    let dmin = Infinity;
    for (let k = 0; k < G.bones.length; k++) {
      const b = BONES[G.bones[k]];
      // keep a limb's influence on its own side of the body
      d[k] = b.side && x * b.side < -0.012 ? Infinity : segDist(x, y, z, b.seg[0], b.seg[1]);
      if (d[k] < dmin) dmin = d[k];
    }
    for (let k = 0; k < d.length; k++) w[k] = d[k] === Infinity ? 0 : Math.exp(-(d[k] - dmin) / TAU) * bias[k];
    // keep the 4 strongest
    for (let s = 0; s < 4; s++) {
      let best = -1, bw = 0;
      for (let k = 0; k < w.length; k++) if (w[k] > bw) { bw = w[k]; best = k; }
      if (best < 0) break;
      si[v * 4 + s] = G.bones[best]; sw[v * 4 + s] = bw; w[best] = 0;
    }
    const t = sw[v * 4] + sw[v * 4 + 1] + sw[v * 4 + 2] + sw[v * 4 + 3] || 1;
    for (let s = 0; s < 4; s++) sw[v * 4 + s] /= t;
  }
  return { skinIndex: si, skinWeight: sw };
}
