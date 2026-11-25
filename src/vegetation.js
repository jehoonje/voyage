// Low-poly vegetation library: shared geometries, materials and per-biome spawn rules.
import * as THREE from 'three';

function facet(g) { g = g.toNonIndexed(); g.computeVertexNormals(); return g; }

const G = {
  pineT: facet(new THREE.CylinderGeometry(0.2, 0.3, 2, 5).translate(0, 1, 0)),
  pineA: facet(new THREE.ConeGeometry(1.8, 3.6, 7).translate(0, 3.4, 0)),
  pineB: facet(new THREE.ConeGeometry(1.25, 2.8, 7).translate(0, 5.2, 0)),
  broadT: facet(new THREE.CylinderGeometry(0.25, 0.38, 2.6, 5).translate(0, 1.3, 0)),
  broadC: new THREE.IcosahedronGeometry(2, 0).translate(0, 3.8, 0),
  jungT: facet(new THREE.CylinderGeometry(0.3, 0.5, 7, 6).translate(0, 3.5, 0)),
  jungC: new THREE.IcosahedronGeometry(3, 0).scale(1, 0.6, 1).translate(0, 7.4, 0),
  palmT: facet(new THREE.CylinderGeometry(0.16, 0.26, 5, 5).translate(0, 2.5, 0)),
  palmC: facet(new THREE.ConeGeometry(2.6, 1.1, 7).translate(0, 5.3, 0)),
  cact: facet(new THREE.CylinderGeometry(0.36, 0.42, 3, 7).translate(0, 1.5, 0)),
  cactArm: facet(new THREE.CylinderGeometry(0.22, 0.22, 1.4, 6).translate(0.7, 1.9, 0)),
  rock: new THREE.DodecahedronGeometry(1, 0),
  bush: new THREE.IcosahedronGeometry(0.9, 0).translate(0, 0.6, 0),
};

const Lm = (c) => new THREE.MeshLambertMaterial({ color: c });
const M = {
  trunk: Lm(0x6b4a2f), palmT: Lm(0x8a6b45), tint: Lm(0xffffff), cact: Lm(0x4f8a4a), rock: Lm(0x8f8a84),
};

/** base foliage colours, varied per instance */
export const TINT = {
  pine: [0.18, 0.38, 0.24], broad: [0.36, 0.6, 0.25], jungle: [0.16, 0.45, 0.17],
  bush: [0.42, 0.62, 0.28], palm: [0.32, 0.6, 0.25],
};

/** each type: list of [geometry, material, tintKey?] parts sharing one transform */
export const TYPES = {
  pine: [[G.pineT, M.trunk], [G.pineA, M.tint, 'pine'], [G.pineB, M.tint, 'pine']],
  broad: [[G.broadT, M.trunk], [G.broadC, M.tint, 'broad']],
  jungle: [[G.jungT, M.trunk], [G.jungC, M.tint, 'jungle']],
  palm: [[G.palmT, M.palmT], [G.palmC, M.tint, 'palm']],
  cactus: [[G.cact, M.cact], [G.cactArm, M.cact]],
  rock: [[G.rock, M.rock]],
  bush: [[G.bush, M.tint, 'bush']],
};

/** pick a vegetation type for a biome given a random r in [0,1) */
export function pickVegetation(b, r, h) {
  switch (b) {
    case 'forest': return r < 0.26 ? 'broad' : r < 0.5 ? 'pine' : r < 0.53 ? 'rock' : r < 0.6 ? 'bush' : null;
    case 'jungle': return r < 0.55 ? 'jungle' : r < 0.68 ? 'broad' : r < 0.8 ? 'bush' : null;
    case 'meadow': return r < 0.035 ? 'broad' : r < 0.05 ? 'rock' : r < 0.14 ? 'bush' : null;
    case 'desert': return r < 0.035 ? 'cactus' : r < 0.06 ? 'rock' : null;
    case 'beach': return h > 0.8 && r < 0.07 ? 'palm' : null;
    case 'mountain': return r < 0.13 ? 'pine' : r < 0.21 ? 'rock' : null;
    case 'snow': return r < 0.03 ? 'pine' : r < 0.07 ? 'rock' : null;
  }
  return null;
}
