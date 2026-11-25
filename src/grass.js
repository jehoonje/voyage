// Swaying grass and wildflowers that follow the player.
// Each field is a fixed G×G grid of tufts that wraps around the player (toroidal):
// when the player moves, only tufts that fall off one edge are re-placed on the
// opposite edge. Wind, gusts, distance fade and "push away from the player" run on the GPU.
import * as THREE from 'three';
import { hash2, vnoise, sstep } from './noise.js';
import { sample, biome, groundColor, splat } from './world.js';
import { windTime } from './wind.js';

const touch = matchMedia('(pointer: coarse)').matches;

/** blades: [angle, height, lean, width]; each blade curves in three segments to a point */
function bladeGeometry(blades, part = 0) {
  const pos = [], parts = [], idx = [];
  for (const [ang, h, lean, w] of blades) {
    const c = Math.cos(ang), s = Math.sin(ang), b = pos.length / 3;
    const pt = (x, y, z) => { pos.push(x * c - z * s, y, x * s + z * c); parts.push(part); };
    for (const t of [0, 0.35, 0.7]) {
      const ww = w * (1 - Math.pow(t, 1.4)), z = lean * t * t;
      pt(-ww, h * t, z); pt(ww, h * t, z);
    }
    pt(0, h, lean);
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2, b + 2, b + 3, b + 4, b + 3, b + 5, b + 4, b + 4, b + 5, b + 6);
  }
  return { pos, parts, idx };
}

function tuft() {
  return bladeGeometry([[0, 0.78, 0.12, 0.085], [1.6, 0.62, -0.14, 0.075], [3.2, 0.7, 0.16, 0.08], [4.7, 0.55, -0.1, 0.07], [5.6, 0.48, 0.08, 0.065]]);
}

/** a stem and a five-petal head (two crossed fans so it reads from any side) */
function flower() {
  const g = bladeGeometry([[0, 0.56, 0.05, 0.026]], 0);
  const cy = 0.56, r = 0.17;
  for (const tilt of [0, Math.PI / 2]) {
    const b = g.pos.length / 3;
    g.pos.push(0, cy, 0.05); g.parts.push(1);
    for (let k = 0; k <= 10; k++) {
      const a = (k / 10) * Math.PI * 2, rr = r * (k % 2 ? 0.45 : 1);
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.35;
      const ct = Math.cos(tilt), st = Math.sin(tilt);
      g.pos.push(x * ct, cy + y + 0.02, 0.05 + x * st); g.parts.push(1);
      if (k) g.idx.push(b, b + k, b + k + 1);
    }
  }
  return g;
}

function toGeometry({ pos, parts, idx }) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(parts, 1));
  g.setIndex(idx);
  return g;
}

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
attribute vec4 aOff;   // world xyz, scale (0 = hidden)
attribute vec3 aCol;
attribute float aPart; // 0 = blade / stem, 1 = flower head
uniform float uTime; uniform vec3 uPlayer; uniform float uRadius; uniform float uHeight; uniform float uFlower;
varying vec3 vCol; varying vec3 vWorld; varying float vH;
void main(){
  float h = clamp(position.y / uHeight, 0., 1.);
  float rnd = fract(sin(dot(aOff.xz, vec2(12.9898, 78.233))) * 43758.5453);
  float a = rnd * 6.2831, c = cos(a), s = sin(a);
  vec3 p = position;
  p.xz = mat2(c, -s, s, c) * p.xz;
  float d = length(aOff.xz - uPlayer.xz);
  float sc = aOff.w * (1. - smoothstep(uRadius * .72, uRadius, d)) * (.8 + rnd * .5);
  p *= sc;
  vec3 wp = aOff.xyz + p;
  float hh = h * h;
  float wave = sin(uTime * 1.7 + wp.x * .18 + wp.z * .11) * .6 + sin(uTime * 2.9 + wp.x * .5 - wp.z * .3) * .25;
  float gust = smoothstep(.2, 1., sin(uTime * .35 + wp.x * .03 + wp.z * .02));
  vec2 bend = vec2(.8, .6) * (wave * .18 + gust * .38) * hh * sc;
  vec2 away = aOff.xz - uPlayer.xz; float ad = length(away);
  bend += (ad > .001 ? away / ad : vec2(0.)) * (1. - smoothstep(.3, 1.6, ad)) * .75 * hh * sc;
  wp.xz += bend;
  wp.y -= dot(bend, bend) * .5;
  // blades: dark root → light, slightly yellow tips; flowers: green stem, coloured head
  vec3 stem = mix(aCol, vec3(.26, .46, .17), uFlower);
  vec3 blade = stem * (.82 + .5 * h) + vec3(.1, .085, 0.) * hh + vec3(.05) * gust * hh;
  vCol = mix(blade, aCol * 1.4, aPart);
  vH = max(h, aPart);
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
varying vec3 vCol; varying vec3 vWorld; varying float vH;
uniform vec3 uAmb; uniform vec3 uSun; uniform vec4 uFire;
void main(){
  // roots sit in their own shade; tips catch more light
  vec3 lit = uAmb * (.85 + .3 * vH) + uSun * getShadowMask() * (.9 + .25 * vH);
  float fd = distance(vWorld, uFire.xyz);
  lit += vec3(1., .55, .25) * uFire.w / (1. + fd * fd * .3);
  gl_FragColor = vec4(vCol * lit, 1.);
  #include <fog_fragment>
}`;

/**
 * One wrapped field. place(x, z, r, s, out) returns a scale (0 = none) and writes rgb into out.
 */
function createField(scene, { grid, spacing, geometry, height, isFlower, place }) {
  const N = grid * grid, radius = (grid * spacing) / 2;
  const geo = toGeometry(geometry);
  const off = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const col = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aOff', off);
  geo.setAttribute('aCol', col);
  geo.instanceCount = N;

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, THREE.UniformsLib.lights, {
    uPlayer: { value: new THREE.Vector3() }, uRadius: { value: radius }, uHeight: { value: height }, uFlower: { value: isFlower ? 1 : 0 },
    uAmb: { value: new THREE.Color(0x8c8c8c) }, uSun: { value: new THREE.Color(0x737373) }, uFire: { value: new THREE.Vector4(0, -999, 0, 0) },
  }]);
  uniforms.uTime = windTime; // shared reference, not a copy
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: true, lights: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const cellX = new Int32Array(N).fill(1 << 30), cellZ = new Int32Array(N).fill(1 << 30);
  const rgb = [0, 0, 0];

  function put(i, cx, cz) {
    const jx = hash2(cx * 7 + 3, cz * 13 - 5), jz = hash2(cx * 17 - 1, cz * 5 + 11), r = hash2(cx + 101, cz - 57);
    const x = (cx + jx) * spacing, z = (cz + jz) * spacing, s = sample(x, z);
    const scale = s.h > 0.6 ? place(x, z, r, s, rgb, jx) : 0;
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

const GRASS_DENSITY = { meadow: 0.95, forest: 0.7, jungle: 0.85, mountain: 0.35 };
const DRY = [0.66, 0.62, 0.34];
const FLOWER_DENSITY = { meadow: 0.8, forest: 0.12, jungle: 0.25, mountain: 0.2 };
const PALETTE = {
  meadow: [[0.82, 0.82, 0.76], [0.86, 0.72, 0.2], [0.55, 0.38, 0.8], [0.84, 0.46, 0.6]],
  forest: [[0.82, 0.82, 0.76], [0.55, 0.38, 0.8]],
  jungle: [[0.84, 0.22, 0.18], [0.9, 0.5, 0.14], [0.82, 0.3, 0.66]],
  mountain: [[0.82, 0.82, 0.78], [0.42, 0.55, 0.86]],
};

export function createGrass(scene) {
  const sw = [0, 0, 0, 0], tmp = [0, 0, 0];
  const grass = createField(scene, {
    grid: touch ? 76 : 96, spacing: 0.85, geometry: tuft(), height: 0.78, isFlower: false,
    place(x, z, r, s, out, jx) {
      const dens = GRASS_DENSITY[biome(s)] || 0;
      if (!dens) return 0;
      splat(s, sw, 0);
      if (r >= dens * sw[0]) return 0;
      groundColor(s, x, z, tmp);
      // sun-dried patches and per-tuft variation
      const dry = sstep(0.25, 0.6, vnoise(x * 0.035 + 7, z * 0.035 - 3)) * 0.55 * (biome(s) === 'meadow' ? 1 : 0.4);
      const v = 0.9 + jx * 0.2;
      for (let k = 0; k < 3; k++) out[k] = (tmp[k] + (DRY[k] - tmp[k]) * dry) * v * (k === 2 ? 0.9 : 1);
      return (0.75 + r * 0.6) * (biome(s) === 'meadow' ? 1.25 : 1); // meadows grow tall
    },
  });
  const flowers = createField(scene, {
    grid: touch ? 40 : 52, spacing: 1.7, geometry: flower(), height: 0.58, isFlower: true,
    place(x, z, r, s, out) {
      const b = biome(s), dens = FLOWER_DENSITY[b] || 0;
      if (!dens) return 0;
      splat(s, sw, 0);
      // flowers grow in drifts: a low-frequency mask gathers them into patches
      const drift = sstep(0.35, 0.75, vnoise(x * 0.06 - 11, z * 0.06 + 5) * 0.5 + 0.5);
      if (r >= dens * sw[0] * (0.25 + drift * 1.5)) return 0;
      const pal = PALETTE[b], pick = pal[Math.floor(hash2(Math.floor(x / 9), Math.floor(z / 9)) * pal.length)];
      for (let k = 0; k < 3; k++) out[k] = pick[k];
      return 0.8 + r * 0.5;
    },
  });
  return {
    setLight(amb, sun, fire) { grass.setLight(amb, sun, fire); flowers.setLight(amb, sun, fire); },
    update(px, pz) { grass.update(px, pz); flowers.update(px, pz); },
  };
}
