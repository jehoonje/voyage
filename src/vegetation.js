// Vegetation library: models, materials with wind and per-biome spawn rules.
import * as THREE from 'three';
import { windTime, rimLight } from './wind.js';
import { addFade } from './forestry.js';
import { buildModels } from './treeModels.js';

const G = buildModels();

/**
 * Whole tree bends with the wind (more toward the top, trunk and crown together);
 * foliage also flutters, and lit edges get a soft rim of light.
 */
function vegShader(mat, { flutter = false, rim = false, hang = false } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windTime;
    sh.uniforms.uRim = rimLight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = instanceMatrix[3].xyz;
  float hy = max(transformed.y, 0.);
  vec2 sway = vec2(sin(uTime * 1.1 + ip.x * .13 + ip.z * .07), cos(uTime * .9 + ip.x * .05 - ip.z * .11));
  transformed.xz += sway * hy * hy * .0032;
  ${flutter ? `float ph = uTime * 6.5 + dot(transformed, vec3(2.7, 1.9, 2.3)) + ip.x;
  transformed += vec3(sin(ph), sin(ph * 1.3) * .5, cos(ph * .9)) * .03 * smoothstep(1., 3., hy);` : ''}
  ${hang ? `float dn = max(4.6 - hy, 0.); // hanging strands swing from their tips
  transformed.xz += vec2(sin(uTime * 1.6 + ip.x * .3 + transformed.y * .8), cos(uTime * 1.3 + ip.z * .3 + transformed.y * .7)) * dn * .07;` : ''}
#endif`);
    if (rim) {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uRim;')
        .replace('#include <opaque_fragment>', `outgoingLight += diffuseColor.rgb * uRim * pow(1. - abs(dot(normal, geometryViewDir)), 2.);
#include <opaque_fragment>`);
    }
  };
  addFade(mat);
  return mat;
}

const Lm = (c, extra) => new THREE.MeshLambertMaterial({ color: c, vertexColors: true, ...extra });
const M = {
  bark: vegShader(Lm(0x6b4a2f)),
  palmBark: vegShader(Lm(0x9a7a52)),
  leaf: vegShader(Lm(0xffffff), { flutter: true, rim: true }),
  frond: vegShader(Lm(0xffffff, { side: THREE.DoubleSide }), { flutter: true, rim: true }),
  cact: vegShader(Lm(0x4f8a4a), { rim: true }),
  birchBark: vegShader(Lm(0xe6e1d4)),
  curtain: vegShader(Lm(0xffffff, { side: THREE.DoubleSide }), { flutter: true, rim: true, hang: true }),
  rock: vegShader(Lm(0x948f88)),
};

/** base foliage colours, varied per instance (vertex shading multiplies on top) */
export const TINT = {
  pine: [0.2, 0.42, 0.26], broad: [0.4, 0.64, 0.27], jungle: [0.18, 0.5, 0.19],
  bush: [0.45, 0.66, 0.3], palm: [0.36, 0.64, 0.27], birch: [0.56, 0.72, 0.3], willow: [0.4, 0.58, 0.27],
};

/** each type: list of [geometry, material, tintKey?] parts sharing one transform */
export const TYPES = {
  pine: [[G.pineTrunk, M.bark], [G.pineLeaves, M.leaf, 'pine']],
  birch: [[G.birchTrunk, M.birchBark], [G.birchCrown, M.leaf, 'birch']],
  willow: [[G.willowTrunk, M.bark], [G.willowDome, M.leaf, 'willow'], [G.willowCurtain, M.curtain, 'willow']],
  broad: [[G.broadTrunk, M.bark], [G.broadCrown, M.leaf, 'broad']],
  jungle: [[G.jungTrunk, M.bark], [G.jungCrown, M.leaf, 'jungle']],
  palm: [[G.palmTrunk, M.palmBark], [G.palmFronds, M.frond, 'palm']],
  cactus: [[G.cactus, M.cact]],
  rock: [[G.rock, M.rock]],
  bush: [[G.bush, M.leaf, 'bush']],
};

/** pick a vegetation type for a biome given a random r in [0,1) */
export function pickVegetation(b, r, h) {
  // willows like the low ground by rivers and lakes
  if ((b === 'meadow' || b === 'forest') && h < 5 && r < 0.06) return 'willow';
  switch (b) {
    case 'forest': return r < 0.14 ? 'birch' : r < 0.3 ? 'broad' : r < 0.5 ? 'pine' : r < 0.53 ? 'rock' : r < 0.6 ? 'bush' : null;
    case 'jungle': return r < 0.55 ? 'jungle' : r < 0.68 ? 'broad' : r < 0.8 ? 'bush' : null;
    case 'meadow': return r < 0.03 ? 'broad' : r < 0.055 ? 'birch' : r < 0.07 ? 'rock' : r < 0.16 ? 'bush' : null;
    case 'desert': return r < 0.035 ? 'cactus' : r < 0.06 ? 'rock' : null;
    case 'beach': return h > 0.8 && r < 0.07 ? 'palm' : null;
    case 'mountain': return r < 0.13 ? 'pine' : r < 0.21 ? 'rock' : null;
    case 'snow': return r < 0.03 ? 'pine' : r < 0.07 ? 'rock' : null;
  }
  return null;
}
