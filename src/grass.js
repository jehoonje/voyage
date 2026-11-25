// Swaying grass field that follows the player.
// A fixed G×G grid of tufts wraps around the player (toroidal): when the player
// moves, only tufts that fall off one edge are re-placed on the opposite edge.
// Wind, gusts, distance fade and "push away from the player" all run on the GPU.
import * as THREE from 'three';
import { hash2 } from './noise.js';
import { sample, biome, groundColor, splat } from './world.js';
import { windTime } from './wind.js';

const touch = matchMedia('(pointer: coarse)').matches;
const G = touch ? 76 : 96; // tufts per side
const S = 0.85; // spacing in metres
const RADIUS = (G * S) / 2;
const BLADE_H = 0.75;

function tuftGeometry() {
  const pos = [], idx = [];
  const blades = [[0, 0.75, 0.02], [2.1, 0.6, -0.04], [4.2, 0.68, 0.05]];
  for (const [ang, h, lean] of blades) {
    const c = Math.cos(ang), s = Math.sin(ang), b = pos.length / 3;
    const pt = (x, y, z) => pos.push(x * c - z * s, y, x * s + z * c);
    const w = 0.09;
    pt(-w, 0, 0); pt(w, 0, 0);
    pt(-w * 0.6, h * 0.55, lean * 0.5); pt(w * 0.6, h * 0.55, lean * 0.5);
    pt(0, h, lean);
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2, b + 2, b + 3, b + 4);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
attribute vec4 aOff;   // world xyz, scale (0 = hidden)
attribute vec3 aCol;
uniform float uTime; uniform vec3 uPlayer; uniform float uRadius;
varying vec3 vCol; varying vec3 vWorld;
void main(){
  float h = clamp(position.y / ${BLADE_H.toFixed(2)}, 0., 1.);
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
  vCol = aCol * (.7 + 1.0 * h) + vec3(.08, .07, 0.) * hh + vec3(.06) * gust * hh;
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
varying vec3 vCol; varying vec3 vWorld;
uniform vec3 uAmb; uniform vec3 uSun; uniform vec4 uFire;
void main(){
  vec3 lit = uAmb + uSun * getShadowMask();
  float fd = distance(vWorld, uFire.xyz);
  lit += vec3(1., .55, .25) * uFire.w / (1. + fd * fd * .3);
  gl_FragColor = vec4(vCol * lit, 1.);
  #include <fog_fragment>
}`;

const DENSITY = { meadow: 0.95, forest: 0.7, jungle: 0.85, mountain: 0.35 };

export function createGrass(scene) {
  const N = G * G;
  const geo = tuftGeometry();
  const off = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const col = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aOff', off);
  geo.setAttribute('aCol', col);
  geo.instanceCount = N;

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, THREE.UniformsLib.lights, {
    uPlayer: { value: new THREE.Vector3() }, uRadius: { value: RADIUS },
    uAmb: { value: new THREE.Color(0x8c8c8c) }, uSun: { value: new THREE.Color(0x737373) }, uFire: { value: new THREE.Vector4(0, -999, 0, 0) },
  }]);
  uniforms.uTime = windTime; // shared reference, not a copy
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: true, lights: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const cellX = new Int32Array(N).fill(1 << 30), cellZ = new Int32Array(N).fill(1 << 30);
  const tmp = [0, 0, 0], sw = [0, 0, 0, 0];

  function place(i, cx, cz) {
    const jx = hash2(cx * 7 + 3, cz * 13 - 5), jz = hash2(cx * 17 - 1, cz * 5 + 11), r = hash2(cx + 101, cz - 57);
    const x = (cx + jx) * S, z = (cz + jz) * S, s = sample(x, z);
    let scale = 0;
    if (s.h > 0.6) {
      const dens = DENSITY[biome(s)] || 0;
      if (dens) {
        splat(s, sw, 0);
        if (r < dens * sw[0]) scale = 0.75 + r * 0.6;
      }
    }
    off.array[i * 4] = x; off.array[i * 4 + 1] = s.h - 0.05; off.array[i * 4 + 2] = z; off.array[i * 4 + 3] = scale;
    if (scale) {
      groundColor(s, x, z, tmp);
      const v = 0.9 + jx * 0.2;
      col.array[i * 3] = tmp[0] * v; col.array[i * 3 + 1] = tmp[1] * v; col.array[i * 3 + 2] = tmp[2] * v * 0.9;
    }
  }

  return {
    /** ambient + direct light colours, and the brightest campfire (x,y,z,strength) */
    setLight(amb, sun, fire) {
      uniforms.uAmb.value.copy(amb);
      uniforms.uSun.value.copy(sun);
      if (fire) uniforms.uFire.value.set(fire.x, fire.y + 0.5, fire.z, fire.strength);
      else uniforms.uFire.value.w = 0;
    },
    update(px, pz) {
      uniforms.uPlayer.value.set(px, 0, pz);
      const fx = px / S, fz = pz / S;
      let changed = false;
      for (let i = 0; i < N; i++) {
        const gx = i % G, gz = (i / G) | 0;
        const cx = gx + G * Math.round((fx - gx) / G), cz = gz + G * Math.round((fz - gz) / G);
        if (cx !== cellX[i] || cz !== cellZ[i]) {
          cellX[i] = cx; cellZ[i] = cz;
          place(i, cx, cz);
          changed = true;
        }
      }
      if (changed) { off.needsUpdate = true; col.needsUpdate = true; }
    },
  };
}
