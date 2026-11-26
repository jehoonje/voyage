// Weather: drifts between clear, fair, cloudy, rain, storm and fog every few minutes.
// What falls depends on where you stand: snow in the cold, sand storms in the desert.
// Rain streaks, snowflakes and dust are GPU-animated particles in a box around the camera.
import * as THREE from 'three';
import { sstep, mix } from './noise.js';

/** each state's targets; rain doubles as snow / dust depending on the land */
const STATES = {
  clear: { cover: 0.12, rain: 0, storm: 0, fog: 0 },
  fair: { cover: 0.38, rain: 0, storm: 0, fog: 0 },
  cloudy: { cover: 0.72, rain: 0, storm: 0, fog: 0.05 },
  rain: { cover: 0.9, rain: 0.75, storm: 0.25, fog: 0.15 },
  storm: { cover: 1, rain: 1, storm: 1, fog: 0.25 },
  fog: { cover: 0.55, rain: 0, storm: 0, fog: 0.85 },
};
export const WEATHER_NAMES = { clear: 'Clear', fair: 'Fair', cloudy: 'Cloudy', rain: 'Rain', storm: 'Storm', fog: 'Fog' };
const NEXT = { // [state, weight] — mostly fine days, rain comes and goes
  clear: [['clear', 2], ['fair', 4], ['cloudy', 1], ['fog', 0.6]],
  fair: [['clear', 3], ['fair', 1], ['cloudy', 3], ['fog', 0.5]],
  cloudy: [['fair', 2], ['cloudy', 1], ['rain', 3], ['fog', 1]],
  rain: [['cloudy', 2], ['fair', 1.5], ['rain', 1], ['storm', 1.2]],
  storm: [['rain', 3], ['cloudy', 1]],
  fog: [['clear', 1.5], ['fair', 2], ['cloudy', 1]],
};

const N_RAIN = 1400, N_FLAKE = 1600, BOX = new THREE.Vector3(36, 22, 36);

const PRECIP_VERT = /* glsl */ `
attribute vec4 aSeed; attribute float aEnd;
uniform vec3 uCam, uBox, uFall, uWind; uniform float uTime, uAmount, uLen, uSize, uSway;
varying float vA;
void main(){
  vec3 p = aSeed.xyz * uBox + (uFall + uWind) * uTime * (.8 + aSeed.w * .4);
  p.x += sin(uTime * 1.3 + aSeed.w * 30.) * uSway; p.z += cos(uTime * 1.1 + aSeed.w * 17.) * uSway;
  p = mod(p - uCam + uBox * .5, uBox) - uBox * .5 + uCam;
  p -= normalize(uFall + uWind) * uLen * aEnd; // streak tail
  vA = step(aSeed.w, uAmount);
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize / max(1., -mv.z) * vA;
  vA *= 1. - smoothstep(10., 18., length(p - uCam));
}`;
const LINE_FRAG = /* glsl */ `uniform vec3 uColor; uniform float uOpacity; varying float vA;
void main(){ if (vA < .01) discard; gl_FragColor = vec4(uColor, uOpacity * vA); }`;
const POINT_FRAG = /* glsl */ `uniform vec3 uColor; uniform float uOpacity; varying float vA;
void main(){ float d = length(gl_PointCoord - .5); if (vA < .01 || d > .5) discard; gl_FragColor = vec4(uColor, uOpacity * vA * (1. - smoothstep(.15, .5, d))); }`;

function seeds(n, perItem) {
  const s = new Float32Array(n * perItem * 4), e = new Float32Array(n * perItem);
  for (let i = 0; i < n; i++) {
    const v = [Math.random(), Math.random(), Math.random(), Math.random()];
    for (let k = 0; k < perItem; k++) { s.set(v, (i * perItem + k) * 4); e[i * perItem + k] = k; }
  }
  return [s, e];
}
function precipMaterial(frag, extra = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCam: { value: new THREE.Vector3() }, uBox: { value: BOX }, uFall: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector3() },
      uTime: { value: 0 }, uAmount: { value: 0 }, uLen: { value: 0 }, uSize: { value: 0 }, uSway: { value: 0 },
      uColor: { value: new THREE.Color() }, uOpacity: { value: 1 }, ...extra,
    },
    vertexShader: PRECIP_VERT, fragmentShader: frag, transparent: true, depthWrite: false,
  });
}

export function createWeather(scene, { force = null } = {}) {
  // rain: line streaks
  const rainGeo = new THREE.BufferGeometry();
  const [rs, re] = seeds(N_RAIN, 2);
  rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_RAIN * 2 * 3), 3));
  rainGeo.setAttribute('aSeed', new THREE.BufferAttribute(rs, 4));
  rainGeo.setAttribute('aEnd', new THREE.BufferAttribute(re, 1));
  const rainMat = precipMaterial(LINE_FRAG);
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  scene.add(rain);
  // snow and dust: soft points
  const flakeGeo = new THREE.BufferGeometry();
  const [fs, fe] = seeds(N_FLAKE, 1);
  flakeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_FLAKE * 3), 3));
  flakeGeo.setAttribute('aSeed', new THREE.BufferAttribute(fs, 4));
  flakeGeo.setAttribute('aEnd', new THREE.BufferAttribute(fe, 1));
  const flakeMat = precipMaterial(POINT_FRAG);
  const flakes = new THREE.Points(flakeGeo, flakeMat);
  flakes.frustumCulled = false;
  scene.add(flakes);

  let state = force && STATES[force] ? force : 'fair', timer = force ? 1e9 : 90 + Math.random() * 120;
  if (force === 'rainbow') timer = 1e9; // testing: a fair sky with a rainbow
  const cur = { ...STATES[state] };
  const out = { name: state, cover: cur.cover, rain: 0, snow: 0, dust: 0, fog: 0, storm: 0, flash: 0, rainbow: 0, wet: 0, snowCover: 0 };
  let flashT = 0, boltT = 4, rainbowT = force === 'rainbow' ? 1e9 : 0, wasRaining = false, t = 0;
  const listeners = [];

  function pick() {
    const opts = NEXT[state], total = opts.reduce((a, o) => a + o[1], 0);
    let r = Math.random() * total;
    for (const [s, w] of opts) { r -= w; if (r <= 0) return s; }
    return opts[0][0];
  }

  return {
    get state() { return state; },
    /** called with the new state name when the weather turns */
    onChange(f) { listeners.push(f); },
    /** bio: biome weights at the player; light: env.light (day / night) */
    update(dt, camera, bio, light) {
      t += dt;
      if ((timer -= dt) <= 0) {
        const next = pick();
        timer = 150 + Math.random() * 210;
        if (next !== state) { state = next; for (const f of listeners) f(state); }
      }
      const tg = STATES[state], k = Math.min(1, dt / 18); // ~20 s to change over
      for (const key in tg) cur[key] += (tg[key] - cur[key]) * k;

      // what falls: snow where it's cold, sand where it's dry, rain elsewhere
      const cold = bio.cold, dry = bio.desert * (1 - cold);
      const fall = cur.rain;
      out.cover = cur.cover * (1 - dry * 0.55);
      out.storm = cur.storm * (1 - dry * 0.6);
      out.rain = fall * (1 - cold) * (1 - dry);
      out.snow = fall * cold + (state === 'cloudy' ? 0.25 * cold : 0);
      out.dust = fall * dry;
      out.fog = cur.fog * (1 - dry * 0.7);
      out.wet += ((out.rain > 0.2 ? 1 : 0) - out.wet) * dt * (out.rain > 0.2 ? 0.05 : 0.008);
      out.snowCover += ((out.snow > 0.2 ? 1 : 0) - out.snowCover) * dt * (out.snow > 0.2 ? 0.02 : 0.006);
      out.name = state;

      // a rainbow lingers for a minute or two after rain moves off
      const raining = out.rain > 0.35;
      if (wasRaining && !raining) rainbowT = 110;
      wasRaining = raining;
      rainbowT = Math.max(0, rainbowT - dt);
      out.rainbow = sstep(0, 25, rainbowT) * (1 - sstep(0.75, 0.95, out.cover)) * (1 - out.rain);

      // lightning in storms
      flashT = Math.max(0, flashT - dt);
      if (out.storm > 0.6 && out.rain > 0.5 && (boltT -= dt) <= 0) {
        flashT = 0.35; boltT = 3 + Math.random() * 9;
      }
      out.flash = flashT > 0 ? (flashT > 0.25 ? 1 : flashT > 0.18 ? 0.2 : flashT > 0.1 ? 0.8 : flashT * 3) : 0;

      // particles follow the camera
      const night = light.night;
      const ru = rainMat.uniforms;
      ru.uCam.value.copy(camera.position); ru.uTime.value = t;
      if (out.dust > out.rain) { // sand: long low streaks racing sideways
        ru.uFall.value.set(0, -1.5, 0); ru.uWind.value.set(17, 0, 6);
        ru.uLen.value = 1.6; ru.uAmount.value = out.dust;
        ru.uColor.value.setRGB(0.9, 0.66, 0.42).multiplyScalar(mix(1, 0.3, night));
        ru.uOpacity.value = 0.5;
      } else {
        ru.uFall.value.set(0, -24, 0); ru.uWind.value.set(3 + out.storm * 5, 0, 1.5);
        ru.uLen.value = 0.9; ru.uAmount.value = Math.min(1, out.rain * 1.1);
        ru.uColor.value.setRGB(0.75, 0.8, 0.88).multiplyScalar(mix(1, 0.35, night));
        ru.uOpacity.value = 0.45;
      }
      rain.visible = ru.uAmount.value > 0.02;

      const fu = flakeMat.uniforms, isDust = out.dust > out.snow;
      fu.uCam.value.copy(camera.position); fu.uTime.value = t;
      if (isDust) { // sand blows sideways, low and fast
        fu.uFall.value.set(0, -0.8, 0); fu.uWind.value.set(11, 0, 4); fu.uSway.value = 0.6;
        fu.uSize.value = 70 * Math.min(devicePixelRatio, 1.75); fu.uAmount.value = out.dust;
        fu.uColor.value.setRGB(0.88, 0.64, 0.4).multiplyScalar(mix(1, 0.3, night)); fu.uOpacity.value = 0.45;
      } else {
        fu.uFall.value.set(0, -1.6, 0); fu.uWind.value.set(0.8 + out.storm * 3, 0, 0.4); fu.uSway.value = 0.5;
        fu.uSize.value = 42 * Math.min(devicePixelRatio, 1.75); fu.uAmount.value = out.snow;
        fu.uColor.value.setRGB(1, 1, 1).multiplyScalar(mix(1, 0.55, night)); fu.uOpacity.value = 0.9;
      }
      flakes.visible = fu.uAmount.value > 0.02;
      return out;
    },
  };
}
