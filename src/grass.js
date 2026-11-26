// Dense grass, wildflowers and shoreline reeds that follow the player.
// Each tuft is a few crossed cards painted with dozens of blades (see textures.js),
// so a modest number of triangles reads as a thick, tall meadow.
// Each field is a fixed G×G grid that wraps around the player (toroidal): when the
// player moves, only tufts that fall off one edge are re-placed on the opposite edge.
// Wind, gusts, distance fade and "push away from the player" run on the GPU.
import * as THREE from 'three';
import { hash2, vnoise, sstep } from './noise.js';
import { sample, biome, groundColor, splat } from './world.js';
import { windTime } from './wind.js';
import { natureTextures } from './textures.js';

const touch = matchMedia('(pointer: coarse)').matches;

/** `planes` vertical cards crossing at the centre, width w, height 1 (scaled per instance) */
function crossedCards(planes, w) {
  const pos = [], uv = [], idx = [];
  for (let k = 0; k < planes; k++) {
    const a = (k / planes) * Math.PI + 0.3, c = Math.cos(a) * w / 2, s = Math.sin(a) * w / 2, b = pos.length / 3;
    pos.push(-c, 0, -s, c, 0, s, c, 1, s, -c, 1, -s);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
attribute vec4 aOff;   // world xyz, scale (0 = hidden)
attribute vec3 aCol;   // tint
uniform float uTime; uniform vec3 uPlayer; uniform float uRadius; uniform float uStiff;
varying vec3 vCol; varying vec3 vWorld; varying vec2 vUv;
void main(){
  vUv = uv;
  float h = uv.y;
  float rnd = fract(sin(dot(aOff.xz, vec2(12.9898, 78.233))) * 43758.5453);
  float a = rnd * 6.2831, c = cos(a), s = sin(a);
  vec3 p = position;
  p.xz = mat2(c, -s, s, c) * p.xz;
  float d = length(aOff.xz - uPlayer.xz);
  float sc = aOff.w * (1. - smoothstep(uRadius * .72, uRadius, d));
  p *= sc;
  vec3 wp = aOff.xyz + p;
  float hh = h * h;
  float wave = sin(uTime * 1.7 + wp.x * .18 + wp.z * .11) * .6 + sin(uTime * 2.9 + wp.x * .5 - wp.z * .3) * .25;
  float gust = smoothstep(.2, 1., sin(uTime * .35 + wp.x * .03 + wp.z * .02));
  vec2 bend = vec2(.8, .6) * (wave * .18 + gust * .38) * hh * sc * uStiff;
  vec2 away = aOff.xz - uPlayer.xz; float ad = length(away);
  bend += (ad > .001 ? away / ad : vec2(0.)) * (1. - smoothstep(.3, 1.6, ad)) * .75 * hh * sc;
  wp.xz += bend;
  wp.y -= dot(bend, bend) * .5;
  vCol = aCol * (1. + .15 * gust * hh);
  vWorld = wp;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.);
  gl_Position = projectionMatrix * mvPosition;
  vec4 worldPosition = vec4(wp, 1.);
  vec3 transformedNormal = (viewMatrix * vec4(0., 1., 0., 0.)).xyz;
  #include <shadowmap_vertex>
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
uniform sampler2D uTex;
uniform vec3 uAmb; uniform vec3 uSun; uniform vec4 uFire;
varying vec3 vCol; varying vec3 vWorld; varying vec2 vUv;
void main(){
  vec4 t = texture2D(uTex, vUv);
  if (t.a < .4) discard;
  // the lower part of a meadow sits in its own shade
  vec3 lit = uAmb * (.65 + .5 * vUv.y) + uSun * getShadowMask() * (.75 + .35 * vUv.y);
  float fd = distance(vWorld, uFire.xyz);
  lit += vec3(1., .55, .25) * uFire.w / (1. + fd * fd * .3);
  gl_FragColor = vec4(t.rgb * vCol * lit * 1.35, 1.);
  #include <fog_fragment>
}`;

/** One wrapped field. place(x, z, r, s, out, jx) returns a scale (0 = none) and writes a tint into out. */
function createField(scene, { grid, spacing, geometry, map, stiff = 1, place }) {
  const N = grid * grid, radius = (grid * spacing) / 2;
  const geo = geometry;
  const off = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const col = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aOff', off);
  geo.setAttribute('aCol', col);
  geo.instanceCount = N;

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, THREE.UniformsLib.lights, {
    uPlayer: { value: new THREE.Vector3() }, uRadius: { value: radius }, uStiff: { value: stiff },
    uAmb: { value: new THREE.Color(0x8c8c8c) }, uSun: { value: new THREE.Color(0x737373) }, uFire: { value: new THREE.Vector4(0, -999, 0, 0) },
  }]);
  uniforms.uTime = windTime; // shared reference, not a copy
  uniforms.uTex = { value: map };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: true, lights: true, side: THREE.DoubleSide, alphaToCoverage: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const cellX = new Int32Array(N).fill(1 << 30), cellZ = new Int32Array(N).fill(1 << 30);
  const rgb = [0, 0, 0];

  function put(i, cx, cz) {
    const jx = hash2(cx * 7 + 3, cz * 13 - 5), jz = hash2(cx * 17 - 1, cz * 5 + 11), r = hash2(cx + 101, cz - 57);
    const x = (cx + jx) * spacing, z = (cz + jz) * spacing, s = sample(x, z);
    const scale = s.h > -0.4 ? place(x, z, r, s, rgb, jx) : 0;
    off.array[i * 4] = x; off.array[i * 4 + 1] = s.h - 0.05; off.array[i * 4 + 2] = z; off.array[i * 4 + 3] = scale;
    if (scale) { col.array[i * 3] = rgb[0]; col.array[i * 3 + 1] = rgb[1]; col.array[i * 3 + 2] = rgb[2]; }
  }

  return {
    setLight(amb, sun, fire) {
      uniforms.uAmb.value.copy(amb);
      uniforms.uSun.value.copy(sun);
      if (fire) uniforms.uFire.value.set(fire.x, fire.y + 0.5, fire.z, fire.strength);
      else uniforms.uFire.value.w = 0;
    },
    update(px, pz) {
      uniforms.uPlayer.value.set(px, 0, pz);
      const fx = px / spacing, fz = pz / spacing;
      let changed = false;
      for (let i = 0; i < N; i++) {
        const gx = i % grid, gz = (i / grid) | 0;
        const cx = gx + grid * Math.round((fx - gx) / grid), cz = gz + grid * Math.round((fz - gz) / grid);
        if (cx !== cellX[i] || cz !== cellZ[i]) {
          cellX[i] = cx; cellZ[i] = cz;
          put(i, cx, cz);
          changed = true;
        }
      }
      if (changed) { off.needsUpdate = true; col.needsUpdate = true; }
    },
  };
}

const GRASS_DENSITY = { meadow: 1, forest: 0.95, jungle: 0.95, mountain: 0.45, beach: 0.04 }; // sea beaches: bare sand, the odd tuft at the back
const GRASS_HEIGHT = { meadow: 1.15, forest: 0.85, jungle: 1.0, mountain: 0.5, beach: 0.55 };
const DRY = [1.25, 1.05, 0.62];
const FLOWER_DENSITY = { meadow: 0.55, forest: 0.08, jungle: 0.2, mountain: 0.18 };

export function createGrass(scene) {
  const T = natureTextures();
  const sw = [0, 0, 0, 0], tmp = [0, 0, 0];

  const grass = createField(scene, {
    grid: touch ? 72 : 92, spacing: 0.8, geometry: crossedCards(3, 1.15), map: T.grass,
    place(x, z, r, s, out, jx) {
      if (s.h < 0.6) return 0;
      const b = biome(s), dens = GRASS_DENSITY[b] || 0;
      if (!dens) return 0;
      splat(s, sw, 0);
      if (b === 'beach' && s.h < 1.8) return 0; // nothing on the open sand
      if (r >= dens * Math.max(sw[0], b === 'beach' ? 0.5 : 0)) return 0;
      // tint toward the ground's own colour, plus sun-dried patches
      groundColor(s, x, z, tmp);
      const dry = sstep(0.25, 0.6, vnoise(x * 0.035 + 7, z * 0.035 - 3)) * (b === 'meadow' ? 0.5 : 0.2) + (b === 'beach' ? 0.5 : 0);
      const v = 0.88 + jx * 0.24;
      for (let k = 0; k < 3; k++) out[k] = (0.45 + tmp[k] * 1.1 + (DRY[k] - 0.45 - tmp[k] * 1.1) * dry) * v;
      return (GRASS_HEIGHT[b] || 0.7) * (0.75 + r * 0.55);
    },
  });

  const flowers = createField(scene, {
    grid: touch ? 36 : 46, spacing: 1.8, geometry: crossedCards(2, 1.0), map: T.flowers,
    place(x, z, r, s, out) {
      if (s.h < 0.6) return 0;
      const b = biome(s), dens = FLOWER_DENSITY[b] || 0;
      if (!dens) return 0;
      splat(s, sw, 0);
      const drift = sstep(0.35, 0.75, vnoise(x * 0.06 - 11, z * 0.06 + 5) * 0.5 + 0.5);
      if (r >= dens * sw[0] * (0.2 + drift * 1.5)) return 0;
      out[0] = out[1] = out[2] = 0.95;
      return 0.6 + r * 0.35;
    },
  });

  // reeds and rushes along the waterline, including the shallows
  const reeds = createField(scene, {
    grid: touch ? 44 : 56, spacing: 1.1, geometry: crossedCards(2, 0.9), map: T.reeds, stiff: 0.6,
    place(x, z, r, s, out) {
      const b = biome(s);
      if (b === 'desert' || b === 'snow' || b === 'mountain') return 0;
      if (b === 'sea') return 0; // open sea shallows stay clear
      const shore = sstep(-0.6, 0.2, s.h) * (1 - sstep(1.2, 2.2, s.h)); // band around the water's edge
      // reeds belong to rivers and lakes; sandy sea beaches only get the odd clump
      if (r >= shore * (b === 'beach' ? 0.015 : 0.75)) return 0;
      out[0] = 0.95; out[1] = 0.95; out[2] = 0.9;
      return 1.5 + r * 0.9;
    },
  });

  const fields = [grass, flowers, reeds];
  return {
    setLight(amb, sun, fire) { for (const f of fields) f.setLight(amb, sun, fire); },
    update(px, pz) { for (const f of fields) f.update(px, pz); },
  };
}
