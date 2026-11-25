// Vegetation library: models, materials with wind and per-biome spawn rules.
import * as THREE from 'three';
import { windTime, rimLight } from './wind.js';
import { addFade } from './forestry.js';
import { buildModels } from './treeModels.js';
import { natureTextures } from './textures.js';

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

const T = natureTextures();
const Lm = (c, extra) => new THREE.MeshLambertMaterial({ color: c, vertexColors: true, ...extra });

/** cut-out foliage: alpha-tested texture, both sides, with a matching shadow caster */
function foliage(map, opts = {}) {
  // alpha-to-coverage keeps distant (mipmapped) leaves solid instead of fading away
  const mat = vegShader(Lm(0xffffff, { map, alphaTest: 0.3, alphaToCoverage: true, side: THREE.DoubleSide }), { flutter: true, rim: true, ...opts });
  mat.userData.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.3, side: THREE.DoubleSide });
  return mat;
}

const M = {
  bark: vegShader(Lm(0xffffff, { map: T.barkBrown })),
  birchBark: vegShader(Lm(0xffffff, { map: T.barkBirch })),
  palmBark: vegShader(Lm(0xffffff, { map: T.barkPalm })),
  broad: foliage(T.broad),
  birch: foliage(T.birch),
  jungle: foliage(T.jungle),
  bush: foliage(T.bush),
  pine: foliage(T.pine),
  palm: foliage(T.palm),
  willow: foliage(T.willow, { hang: true }),
  cact: vegShader(Lm(0x4f8a4a), { rim: true }),
  rock: vegShader(Lm(0x948f88)),
};

/** per-instance colour variation; leaf colour itself comes from the textures */
export const TINT = {
  pine: [0.95, 1, 0.95], broad: [1, 1, 0.95], jungle: [0.95, 1, 0.95],
  bush: [1, 1, 0.95], palm: [1, 1, 0.95], birch: [1.02, 1, 0.92], willow: [1, 1, 0.92],
};

/** each type: list of [geometry, material, tintKey?] parts sharing one transform */
export const TYPES = {
  pine: [[G.pineTrunk, M.bark], [G.pineLeaves, M.pine, 'pine']],
  birch: [[G.birchTrunk, M.birchBark], [G.birchCrown, M.birch, 'birch']],
  willow: [[G.willowTrunk, M.bark], [G.willowDome, M.willow, 'willow'], [G.willowCurtain, M.willow, 'willow']],
  broad: [[G.broadTrunk, M.bark], [G.broadCrown, M.broad, 'broad']],
  jungle: [[G.jungTrunk, M.bark], [G.jungCrown, M.jungle, 'jungle'], [G.jungVines, M.willow, 'jungle']],
  palm: [[G.palmTrunk, M.palmBark], [G.palmFronds, M.palm, 'palm']],
  cactus: [[G.cactus, M.cact]],
  rock: [[G.rock, M.rock]],
  bush: [[G.bush, M.bush, 'bush']],
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
