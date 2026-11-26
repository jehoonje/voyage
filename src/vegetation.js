// Vegetation library: models, materials with wind and per-biome spawn rules.
import * as THREE from 'three';
import { windTime, rimLight } from './wind.js';
import { addFade } from './forestry.js';
import { buildModels } from './treeModels.js';
import { natureTextures } from './textures.js';
import { ATMOS } from './atmos.js';

const G = buildModels();

/**
 * Whole tree bends with the wind (more toward the top, trunk and crown together);
 * foliage also flutters, and lit edges get a soft rim of light.
 */
function vegShader(mat, { flutter = false, rim = false, hang = false, snow = 0 } = {}) {
  // snow: 1 = always snow-covered; 0 = only while fresh snow is falling (ATMOS.snow)
  const snowK = { value: snow };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windTime;
    sh.uniforms.uRim = rimLight;
    sh.uniforms.uSnowK = snowK;
    sh.uniforms.uSnowfall = ATMOS.snow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; varying float vUpN; varying vec3 vWPos;')
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
#endif`)
      .replace('#include <project_vertex>', `#include <project_vertex>
  { mat3 nm = mat3(modelMatrix);
#ifdef USE_INSTANCING
    nm = nm * mat3(instanceMatrix);
#endif
    vUpN = normalize(nm * objectNormal).y; vWPos = (modelMatrix * vec4(transformed, 1.)).xyz; }`);
    // snow settles on whatever faces the sky, in uneven patches
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSnowK, uSnowfall; varying float vUpN; varying vec3 vWPos;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  { float k = max(uSnowK, uSnowfall * .75);
    if (k > .01) {
      float patchy = fract(sin(dot(floor(vWPos.xz * 2.3 + vWPos.y * 1.7), vec2(12.9898, 78.233))) * 43758.5453);
      float sn = smoothstep(.15, .55, vUpN + (patchy - .5) * .35) * k;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.93, .96, 1.), sn);
    } }`);
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
  // The leaf textures are black wherever they're transparent, so smaller mip levels blend that black into
  // the leaves: thin fronds seen from afar or from above turned into dark blots. Dividing by the averaged
  // alpha takes the black back out (the transparent texels are zero, so it's an alpha-weighted average).
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  sampledDiffuseColor.rgb = min( sampledDiffuseColor.rgb / max( sampledDiffuseColor.a, .08 ), 1. );
  diffuseColor *= sampledDiffuseColor;
#endif`);
  };
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
  fern: foliage(T.fern),
  bigleaf: foliage(T.bigleaf),
  snowPine: foliage(T.pine, { snow: 1 }),
  snowBark: vegShader(Lm(0xffffff, { map: T.barkBrown }), { snow: 1 }),
  cact: vegShader(Lm(0x4f8a4a), { rim: true }),
  rock: vegShader(Lm(0x948f88)),
  snowRock: vegShader(Lm(0xb4b2ba), { snow: 1 }),
  stone: vegShader(Lm(0xffffff)), // colours painted into the model
};

/** per-instance colour variation; leaf colour itself comes from the textures */
export const TINT = {
  pine: [0.95, 1, 0.95], broad: [1, 1, 0.95], jungle: [0.95, 1, 0.95],
  bush: [1, 1, 0.95], palm: [1, 1, 0.95], birch: [1.02, 1, 0.92], willow: [1, 1, 0.92],
  dry: [1.2, 0.86, 0.5], fern: [0.95, 1.05, 0.9], bigleaf: [1, 1.05, 0.95],
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
  fern: [[G.fern, M.fern, 'fern']],
  bigleaf: [[G.bigleaf, M.bigleaf, 'bigleaf']],
  dryshrub: [[G.bush, M.bush, 'dry']],
  snowpine: [[G.pineTrunk, M.snowBark], [G.pineLeaves, M.snowPine, 'pine']],
  snowrock: [[G.boulder, M.snowRock]],
  seastack: [[G.seastack, M.stone]],
  crag: [[G.seastack, M.stone]],
  redrock: [[G.redrock, M.stone]],
  hoodoo: [[G.hoodoo, M.stone]],
  bones: [[G.bones, M.stone]],
  stonehead: [[G.stonehead, M.stone]],
};

/** pick a vegetation type for a biome given a random r in [0,1) */
/**
 * stand (-1..1, slowly varying): forests grow in stands of one kind — fir woods, broadleaf
 * woods, birch groves — with only a little of anything else mixed in. Jungles stay a tangle.
 */
export function pickVegetation(b, r, h, stand = 0) {
  // willows like the low ground by rivers and lakes
  if ((b === 'meadow' || b === 'forest' || b === 'jungle') && h < 5 && r < 0.05) return 'willow';
  switch (b) {
    case 'forest':
      if (stand < -0.18) return r < 0.3 ? 'pine' : r < 0.315 ? 'broad' : r < 0.33 ? 'rock' : r < 0.43 ? 'fern' : null; // fir wood (wide cones: fewer trunks)
      if (stand > 0.28) return r < 0.34 ? 'birch' : r < 0.37 ? 'pine' : r < 0.45 ? 'bush' : r < 0.5 ? 'fern' : null; // birch grove
      return r < 0.34 ? 'broad' : r < 0.37 ? 'birch' : r < 0.39 ? 'rock' : r < 0.47 ? 'bush' : r < 0.53 ? 'fern' : null; // broadleaf wood
    case 'jungle': return r < 0.5 ? 'jungle' : r < 0.57 ? 'broad' : r < 0.67 ? 'bigleaf' : r < 0.78 ? 'fern' : r < 0.84 ? 'bush' : r < 0.86 ? 'rock' : null;
    case 'meadow': return r < 0.03 ? 'broad' : r < 0.055 ? 'birch' : r < 0.07 ? 'rock' : r < 0.16 ? 'bush' : null;
    case 'desert': return r < 0.03 ? 'cactus' : r < 0.055 ? 'redrock' : r < 0.11 ? 'dryshrub' : r < 0.113 ? 'bones' : null;
    case 'beach': return h > 0.8 && r < 0.07 ? 'palm' : null;
    case 'mountain': return h > 48 ? (r < 0.1 ? 'snowpine' : r < 0.16 ? 'snowrock' : null)
      : r < 0.13 ? 'pine' : r < 0.21 ? 'rock' : r < 0.24 ? 'fern' : null;
    case 'snow': return r < 0.06 ? 'snowpine' : r < 0.1 ? 'snowrock' : null;
  }
  return null;
}
