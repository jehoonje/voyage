// Sky dome (painted clouds, sun / moon, dusk band, rainbow, aurora), fog, lights and
// reflective water, driven by the day–night clock, the weather and the biome you stand in.
// time: 0 = midnight, 0.25 ≈ sunrise, 0.5 = noon, 0.75 ≈ sunset.
import * as THREE from 'three';
import { sstep, mix } from './noise.js';
import { ATMOS } from './atmos.js';

export const DAY_LENGTH = 960; // real seconds per in-game day

const col = (h) => new THREE.Color(h);
// sky: zenith and horizon for day, dusk and night (night leans violet, like a moonlit dream)
const TOP_DAY = col(0x3f7fd0), TOP_DUSK = col(0x5a4f9e), TOP_NIGHT = col(0x140f3a);
const HOR_DAY = col(0xbfdcef), HOR_DUSK = col(0xf3a98c), HOR_NIGHT = col(0x3a2c6c);
const TOP_GREY = col(0x7d8794), HOR_GREY = col(0xa9b0b6), TOP_STORM = col(0x3c434d), HOR_STORM = col(0x5d636a);
const BAND_DUSK = col(0xffb35a); // golden glow along the horizon under a low sun
const HEMI_DAY = col(0xd8ecff), HEMI_NIGHT = col(0x5a5ab0), HEMI_GREY = col(0xc4ccd4);
const GROUND_DAY = col(0x5b6440), GROUND_NIGHT = col(0x1c1830);
const SUN_DAY = col(0xfff0d0), SUN_DUSK = col(0xff9a62), MOON = col(0xb2b4ff);
const DISC_DAY = col(0xfffbf0), DISC_DUSK = col(0xffd2b0), DISC_MOON = col(0xf4f2ff);
const AMB_DAY = col(0x8c8c8c), AMB_NIGHT = col(0x2e3266); // grass ambient

// fog tints by biome (mixed into the horizon colour)
const FOG_DESERT = col(0xf0c48e), FOG_JUNGLE = col(0x9fc0a0), FOG_SNOW = col(0xdfe8f4), FOG_DUST = col(0xc8874a);

const NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+1.), f.x), f.y); }
float fbm4(vec2 p){ float s = 0., a = .5; for (int k = 0; k < 4; k++){ s += a * vn(p); p = p * 2.03 + 7.1; a *= .5; } return s / .9375; }
`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position.z = gl_Position.w * .9999; }`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uTop, uHorizon, uDisc, uDir, uHalo, uBand, uCloudLit, uCloudShade;
uniform float uDiscCos, uGlow, uTime, uCover, uRainbow, uAurora, uMoon, uFlash, uBandK, uDay;
varying vec3 vDir;
${NOISE}
vec3 spectrum(float x){ // 0..1 red → violet
  return clamp(vec3(1.5 - abs(4.*x - 1.), 1.5 - abs(4.*x - 2.), 1.5 - abs(4.*x - 3.)), 0., 1.);
}
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c = mix(uHorizon, uTop, pow(smoothstep(-.02, .65, h), .75));
  float s = dot(d, uDir);
  // golden band hugging the horizon on the sun's side at dawn / dusk
  c += uBand * uBandK * pow(max(s * .5 + .5, 0.), 3.) * (1. - smoothstep(0., .32, h)) * (1. - uCover * .6);
  c += uHalo * (pow(max(s, 0.), 6.) * .35 + pow(max(s, 0.), 60.) * .6) * uGlow * (1. - uCover * .8);
  // moon: a soft lavender glow that spreads wide
  c += uHalo * uMoon * (pow(max(s, 0.), 220.) * 1.2 + pow(max(s, 0.), 18.) * .25);
  float disc = smoothstep(uDiscCos - .0006, uDiscCos, s) * (1. - smoothstep(.55, .95, uCover));
  c = mix(c, uDisc, disc);

  // aurora: slow curtains of teal and rose over cold lands at night
  if (uAurora > .01 && h > .05) {
    float az = atan(d.z, d.x);
    float curtain = fbm4(vec2(az * 2.2 + uTime * .015, uTime * .02));
    float rays = .55 + .45 * sin(az * 70. + curtain * 9. + uTime * .2);
    float band = smoothstep(.08, .25, h) * (1. - smoothstep(.35, .75, h + curtain * .25));
    vec3 ac = mix(vec3(.2, .95, .7), vec3(.95, .45, .7), smoothstep(.2, .6, h + curtain * .2));
    c += ac * band * rays * smoothstep(.45, .7, curtain + .2) * uAurora * .55;
  }

  // rainbow: a 42° ring around the point opposite the sun, after rain
  if (uRainbow > .01) {
    float ang = acos(clamp(dot(d, -uDir), -1., 1.));
    float x = (ang - .69) / .045;
    float ring = smoothstep(0., .15, x) * (1. - smoothstep(.85, 1., x));
    c += spectrum(1. - x) * ring * uRainbow * .32 * smoothstep(-.02, .08, h);
  }

  // clouds: painted cumulus plus high streaks, lit from the sun's side
  if (h > -.02) {
    vec2 uv = d.xz / (h + .12);
    vec2 w = vec2(uTime * .006, uTime * .002);
    float n = fbm4(uv * .9 + w);
    float th = 1. - uCover;
    float dens = smoothstep(th - .05, th + .28, n + (uCover - .45) * .25);
    float lit = clamp((n - fbm4(uv * .9 + w + uDir.xz * .06)) * 6. + .55, 0., 1.);
    vec3 cc = mix(uCloudShade, uCloudLit, lit);
    cc += uHalo * pow(max(s, 0.), 8.) * .5 * (1. - dens) * uGlow; // silver lining near the sun
    float streak = smoothstep(.55, .85, fbm4(vec2(uv.x * .35, uv.y * 2.2) + w * 2. + 3.)) * (.35 + uCover * .3) * (1. - uCover * .7);
    float fadeH = smoothstep(-.02, .14, h);
    c = mix(c, mix(uCloudLit, uHalo, .25), streak * .45 * fadeH * (1. - dens));
    c = mix(c, cc, dens * fadeH * .95);
  }
  c += vec3(.75, .8, 1.) * uFlash * (.4 + .6 * smoothstep(0., .5, h));
  gl_FragColor = vec4(c, 1.);
}`;

const WATER_VERT = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vWorld;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime, uDay, uRain;
uniform vec3 uTop, uHorizon, uDir, uSunCol;
varying vec3 vWorld;
float r21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 p = vWorld.xz; float t = uTime;
  // layered ripples; stronger along one axis so highlights stretch into streaks
  vec2 g = vec2(
    sin(p.x * .9 + t * 1.3) * .5 + sin(p.x * 2.3 - p.y * 1.1 + t * 2.1) * .3 + sin((p.x + p.y) * 4.7 + t * 3.) * .14,
    cos(p.y * .8 - t * 1.1) * .2 + cos(p.y * 2.7 + p.x * 1.3 - t * 1.7) * .12 + cos((p.y - p.x) * 5.1 + t * 2.6) * .08);
  // raindrop rings
  if (uRain > .01) {
    vec2 q = p * 1.4, ci = floor(q), f = fract(q) - .5;
    float ph = fract(t * .9 + r21(ci));
    vec2 o = vec2(r21(ci + 3.1), r21(ci + 7.7)) - .5;
    float r = length(f - o * .5);
    float ring = sin((r - ph * .6) * 45.) * (1. - ph) * (1. - smoothstep(.0, .45, abs(r - ph * .6) * 3.));
    g += normalize(f - o * .5 + 1e-4) * ring * uRain * 1.8;
  }
  vec3 n = normalize(vec3(g.x * .07, 1., g.y * .07));
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 r = reflect(-v, n);
  float fres = .05 + .95 * pow(1. - max(dot(n, v), 0.), 4.);
  vec3 sky = mix(uHorizon, uTop, pow(smoothstep(0., .65, r.y), .75));
  float sd = max(dot(r, uDir), 0.);
  vec3 spec = uSunCol * (pow(sd, 500.) * 5. + pow(sd, 50.) * .35);
  // glitter: tiny sun sparks dancing on the ripples
  vec2 gq = p * 7. + vec2(t * 1.7, -t * 1.3);
  float gl = step(.975, r21(floor(gq))) * (1. - smoothstep(.05, .2, length(fract(gq) - .5))) * pow(sd, 6.) * 1.5;
  vec3 tint = mix(vec3(.02, .05, .12), vec3(.08, .42, .46), uDay);
  vec3 c = mix(tint, sky, .2 + .72 * fres) + spec + uSunCol * gl;
  // see-through when looking down so the turquoise floor shows; mirror-like at grazing angles
  gl_FragColor = vec4(c, mix(.4, .95, fres));
  #include <fog_fragment>
}`;

export function createEnvironment(scene, startTime = 0.3) {
  let time = startTime;
  const horizon = new THREE.Color(), zenith = new THREE.Color();
  scene.background = horizon;
  scene.fog = new THREE.Fog(new THREE.Color(), 70, 190);

  // intensities ×π: three ≥r155 uses physical light units
  const hemi = new THREE.HemisphereLight(0xd8ecff, 0x5b6440, 0.95 * Math.PI);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d0, 0.85 * Math.PI);
  scene.add(sun, sun.target);

  // Shadow box follows the player; size trades sharpness for coverage.
  const touch = matchMedia('(pointer: coarse)').matches;
  const MAP = touch ? 1024 : 2048, EXT = touch ? 40 : 55;
  sun.castShadow = true;
  sun.shadow.mapSize.set(MAP, MAP);
  Object.assign(sun.shadow.camera, { left: -EXT, right: EXT, top: EXT, bottom: -EXT, near: 1, far: 320 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.35;
  const texel = (EXT * 2) / MAP, focus = new THREE.Vector3();
  const dir = new THREE.Vector3(), lx = new THREE.Vector3(), ly = new THREE.Vector3(), lz = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0), discDir = new THREE.Vector3();

  // sky dome
  const skyU = {
    uTop: { value: zenith }, uHorizon: { value: horizon }, uDisc: { value: new THREE.Color() },
    uDir: { value: discDir }, uHalo: { value: new THREE.Color() }, uDiscCos: { value: 0.999 }, uGlow: { value: 1 },
    uBand: { value: BAND_DUSK.clone() }, uBandK: { value: 0 }, uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() },
    uTime: { value: 0 }, uCover: { value: 0.3 }, uRainbow: { value: 0 }, uAurora: { value: 0 }, uMoon: { value: 0 }, uFlash: { value: 0 }, uDay: { value: 1 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(280, 48, 24),
    new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  dome.renderOrder = 900; // after the opaque world, so only pixels where sky shows are shaded (clouds are costly)
  dome.frustumCulled = false;
  scene.add(dome);

  // water: reflects the same sky gradient, with a sun / moon streak
  const waterU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uDay: { value: 1 }, uSunCol: { value: new THREE.Color() }, uRain: { value: 0 },
  }]);
  Object.assign(waterU, { uTop: skyU.uTop, uHorizon: skyU.uHorizon, uDir: skyU.uDir });
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700),
    new THREE.ShaderMaterial({ uniforms: waterU, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, fog: true }),
  );
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  // stars: a dome of points that follows the camera, twinkling
  const NSTAR = 900, sp = new Float32Array(NSTAR * 3), sz = new Float32Array(NSTAR);
  for (let i = 0; i < NSTAR; i++) {
    const th = Math.random() * 6.283, ph = Math.acos(Math.random() * 0.95 + 0.05);
    sp[i * 3] = Math.sin(ph) * Math.cos(th) * 260;
    sp[i * 3 + 1] = Math.cos(ph) * 260;
    sp[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 260;
    sz[i] = Math.random();
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  starGeo.setAttribute('aR', new THREE.BufferAttribute(sz, 1));
  const starU = { uOpacity: { value: 0 }, uTime: skyU.uTime, uPx: { value: 1 } };
  const starMat = new THREE.ShaderMaterial({
    uniforms: starU, transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute float aR; uniform float uTime, uPx; varying float vA;
      void main(){ vA = .45 + .55 * sin(uTime * (1.5 + aR * 3.) + aR * 40.); gl_PointSize = (1.2 + aR * aR * 2.2) * uPx;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position.z = gl_Position.w * .9998; }`,
    fragmentShader: `uniform float uOpacity; varying float vA;
      void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(vec3(.92, .94, 1.), uOpacity * vA * (1. - smoothstep(.2, .5, d))); }`,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = 901;
  scene.add(stars);

  /** lighting summary for custom shaders (grass), post grade and gameplay */
  const light = { day: 1, night: 0, dusk: 0, amb: new THREE.Color(), sun: new THREE.Color() };
  const fogTint = new THREE.Color(), tmpC = new THREE.Color();
  const NOBIO = { desert: 0, jungle: 0, snow: 0, sea: 0, forest: 0, cold: 0 };
  const NOWX = { cover: 0.3, rain: 0, snow: 0, dust: 0, fog: 0, storm: 0, flash: 0, rainbow: 0 };

  function apply(camera, bio = NOBIO, wx = NOWX) {
    const a = (time - 0.25) * Math.PI * 2;
    const el = Math.sin(a) * 0.9 + 0.18; // sun height; the offset makes days longer than nights
    const day = sstep(-0.1, 0.22, el);
    const dusk = 1 - sstep(0.04, 0.4, Math.abs(el - 0.03));
    light.day = day; light.night = 1 - day; light.dusk = dusk;
    const cover = wx.cover, grey = sstep(0.45, 0.95, cover), storm = wx.storm;

    zenith.copy(TOP_NIGHT).lerp(TOP_DAY, day).lerp(TOP_DUSK, dusk * 0.7 * (1 - grey));
    horizon.copy(HOR_NIGHT).lerp(HOR_DAY, day).lerp(HOR_DUSK, dusk * 0.85 * (1 - grey));
    // overcast and storms drain the colour out of the sky (and darken it at night too)
    tmpC.copy(TOP_GREY).lerp(TOP_STORM, storm).multiplyScalar(mix(0.18, 1, day));
    zenith.lerp(tmpC, grey * 0.85);
    tmpC.copy(HOR_GREY).lerp(HOR_STORM, storm).multiplyScalar(mix(0.22, 1, day));
    horizon.lerp(tmpC, grey * 0.8);
    // sand storms turn the whole sky to ochre haze
    tmpC.copy(FOG_DUST).multiplyScalar(mix(0.2, 1, day));
    zenith.lerp(tmpC, wx.dust * 0.6);
    horizon.lerp(tmpC, wx.dust * 0.9);

    // fog: tinted by the land (desert haze, jungle mist, snow glare) and by weather
    fogTint.copy(horizon);
    const dayish = mix(0.25, 1, day);
    fogTint.lerp(tmpC.copy(FOG_DESERT).multiplyScalar(dayish), bio.desert * 0.45);
    fogTint.lerp(tmpC.copy(FOG_JUNGLE).multiplyScalar(dayish), bio.jungle * 0.45);
    fogTint.lerp(tmpC.copy(FOG_SNOW).multiplyScalar(dayish), Math.max(bio.snow * 0.4, wx.snow * 0.5));
    fogTint.lerp(tmpC.copy(FOG_DUST).multiplyScalar(dayish), wx.dust * 0.85);
    scene.fog.color.copy(fogTint);
    // morning mist lies thick at dawn; jungles are always a little hazy
    const dawnMist = sstep(0.18, 0.24, time) * (1 - sstep(0.3, 0.37, time));
    const thick = Math.min(1, wx.fog + dawnMist * 0.55 + bio.jungle * 0.3 + wx.rain * 0.35 + wx.snow * 0.45 + wx.dust * 0.92);
    const near = mix(16, touch ? 55 : 70, day), far = mix(62, touch ? 145 : 190, day);
    scene.fog.near = mix(near, 4, thick);
    scene.fog.far = mix(far, 55, thick);

    hemi.color.copy(HEMI_NIGHT).lerp(HEMI_DAY, day).lerp(HEMI_GREY, grey * 0.6 * day);
    hemi.groundColor.copy(GROUND_NIGHT).lerp(GROUND_DAY, day);
    hemi.intensity = (mix(0.4, 0.9, day) * (1 - storm * 0.3) + wx.flash * 2.5) * Math.PI;

    // sun above the horizon, moon otherwise; both fade to zero at the horizon so the swap is invisible
    const cx = Math.cos(a), shade = (1 - sstep(0.4, 1, cover) * 0.78) * (1 - wx.dust * 0.45);
    if (el >= 0) {
      dir.set(cx, el, 0.4).normalize();
      sun.color.copy(SUN_DUSK).lerp(SUN_DAY, sstep(0.05, 0.45, el));
      sun.intensity = 0.85 * Math.PI * sstep(0, 0.15, el) * shade;
      skyU.uDisc.value.copy(DISC_DUSK).lerp(DISC_DAY, sstep(0.05, 0.45, el));
      skyU.uHalo.value.copy(SUN_DUSK).lerp(SUN_DAY, sstep(0.1, 0.6, el));
      skyU.uDiscCos.value = 0.9988; // a large, soft sun as in the reference
      skyU.uGlow.value = 0.6 + dusk * 0.9;
      skyU.uMoon.value = 0;
    } else {
      dir.set(-cx, -el, -0.4).normalize();
      sun.color.copy(MOON);
      sun.intensity = 0.36 * Math.PI * sstep(0, 0.15, -el) * shade;
      skyU.uDisc.value.copy(DISC_MOON);
      skyU.uHalo.value.copy(MOON).multiplyScalar(0.5);
      skyU.uDiscCos.value = 0.9982; // a big moon
      skyU.uGlow.value = 0.3;
      skyU.uMoon.value = sstep(0, 0.12, -el) * (1 - grey);
    }
    discDir.copy(dir);
    if (discDir.y < 0.02) { discDir.y = 0.02; discDir.normalize(); }
    lz.copy(dir).negate();
    lx.crossVectors(UP, lz).normalize();
    ly.crossVectors(lz, lx);

    skyU.uBandK.value = dusk * 0.9;
    skyU.uCover.value = cover;
    skyU.uDay.value = day;
    // cloud colours: white tops and blue-grey bellies by day, peach at dusk, slate by night
    skyU.uCloudLit.value.setRGB(1, 0.99, 0.97).lerp(tmpC.setRGB(1, 0.74, 0.62), dusk * 0.8).multiplyScalar(mix(0.2, 1, day) * (1 - storm * 0.45));
    skyU.uCloudShade.value.setRGB(0.64, 0.68, 0.78).lerp(tmpC.setRGB(0.62, 0.45, 0.6), dusk * 0.6).multiplyScalar(mix(0.13, 1, day) * (1 - storm * 0.55) * (1 - grey * 0.25));
    skyU.uRainbow.value = wx.rainbow * day * (el > 0.05 && el < 0.6 ? 1 : 0);
    skyU.uAurora.value = (1 - day) * bio.cold * (1 - grey);
    skyU.uFlash.value = wx.flash;

    waterU.uDay.value = day;
    waterU.uRain.value = wx.rain;
    waterU.uSunCol.value.copy(skyU.uDisc.value).multiplyScalar((el >= 0 ? sstep(-0.02, 0.1, el) : 0.6 * sstep(0, 0.15, -el)) * shade);

    light.amb.copy(AMB_NIGHT).lerp(AMB_DAY, day);
    light.sun.copy(sun.color).multiplyScalar((sun.intensity / Math.PI) * 0.53);

    const nightVis = (1 - sstep(-0.05, 0.25, el)) * (1 - sstep(0.4, 0.8, cover));
    starU.uOpacity.value = nightVis;
    stars.visible = nightVis > 0.01;
    if (camera) { stars.position.copy(camera.position); dome.position.copy(camera.position); }
  }
  apply(null);

  return {
    sun,
    light,
    get time() { return time; },
    set time(t) { time = ((t % 1) + 1) % 1; apply(null); },
    /** in-game clock, e.g. "오전 9:40" */
    clock() {
      const mins = Math.floor(time * 24 * 60), h = Math.floor(mins / 60) % 24, m = mins % 60;
      return (h < 12 ? '오전 ' : '오후 ') + (h % 12 || 12) + ':' + String(m).padStart(2, '0');
    },
    /** bio: biome weights around the player; wx: weather state (weather.js) */
    update(dt, now, px, pz, py, camera, bio, wx) {
      time = (time + dt / DAY_LENGTH) % 1;
      skyU.uTime.value = now / 1000;
      starU.uPx.value = Math.min(devicePixelRatio, 1.75);
      apply(camera, bio, wx);
      waterU.uTime.value = now / 1000;
      focus.set(px, py, pz);
      const u = focus.dot(lx), v = focus.dot(ly);
      focus.addScaledVector(lx, Math.round(u / texel) * texel - u).addScaledVector(ly, Math.round(v / texel) * texel - v);
      sun.target.position.copy(focus);
      sun.position.copy(focus).addScaledVector(dir, 150);
      water.position.set(Math.round(px / 50) * 50, Math.sin(now * 0.001) * 0.06, Math.round(pz / 50) * 50);
      ATMOS.wet.value = wx ? wx.wet : 0;
      ATMOS.snow.value = wx ? wx.snowCover : 0;
    },
  };
}
