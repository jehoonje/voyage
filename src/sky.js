// Sky dome, fog, sun/moon, stars, reflective water and clouds, driven by a day–night clock.
// time: 0 = midnight, 0.25 ≈ sunrise, 0.5 = noon, 0.75 ≈ sunset.
import * as THREE from 'three';
import { sstep, mix } from './noise.js';

export const DAY_LENGTH = 960; // real seconds per in-game day

const col = (h) => new THREE.Color(h);
// sky: zenith and horizon for day, dusk and night
const TOP_DAY = col(0x5d97d0), TOP_DUSK = col(0x6a5aa6), TOP_NIGHT = col(0x050a1a);
const HOR_DAY = col(0xc4dcec), HOR_DUSK = col(0xf0a4a2), HOR_NIGHT = col(0x121c34);
const HEMI_DAY = col(0xd8ecff), HEMI_NIGHT = col(0x4a5c92);
const GROUND_DAY = col(0x5b6440), GROUND_NIGHT = col(0x161b24);
const SUN_DAY = col(0xfff0d0), SUN_DUSK = col(0xff9a70), MOON = col(0x9fb4ff);
const DISC_DAY = col(0xfffbf0), DISC_DUSK = col(0xffd0c0), DISC_MOON = col(0xeef0ff);
const CLOUD_EM_DAY = col(0x8a95a0), CLOUD_EM_NIGHT = col(0x0a0e18), CLOUD_DUSK = col(0xffb2a8);
const AMB_DAY = col(0x8c8c8c), AMB_NIGHT = col(0x263456); // grass ambient

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position.z = gl_Position.w * .9999; }`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uTop, uHorizon, uDisc, uDir, uHalo;
uniform float uDiscCos, uGlow;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c = mix(uHorizon, uTop, pow(smoothstep(-.02, .65, h), .75));
  float s = dot(d, uDir);
  c += uHalo * (pow(max(s, 0.), 6.) * .35 + pow(max(s, 0.), 60.) * .6) * uGlow;
  c = mix(c, uDisc, smoothstep(uDiscCos - .0006, uDiscCos, s));
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
uniform float uTime, uDay;
uniform vec3 uTop, uHorizon, uDir, uSunCol;
varying vec3 vWorld;
void main(){
  vec2 p = vWorld.xz; float t = uTime;
  // layered ripples; stronger along one axis so highlights stretch into streaks
  vec2 g = vec2(
    sin(p.x * .9 + t * 1.3) * .5 + sin(p.x * 2.3 - p.y * 1.1 + t * 2.1) * .3 + sin((p.x + p.y) * 4.7 + t * 3.) * .14,
    cos(p.y * .8 - t * 1.1) * .2 + cos(p.y * 2.7 + p.x * 1.3 - t * 1.7) * .12 + cos((p.y - p.x) * 5.1 + t * 2.6) * .08);
  vec3 n = normalize(vec3(g.x * .07, 1., g.y * .07));
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 r = reflect(-v, n);
  float fres = .05 + .95 * pow(1. - max(dot(n, v), 0.), 4.);
  vec3 sky = mix(uHorizon, uTop, pow(smoothstep(0., .65, r.y), .75));
  float sd = max(dot(r, uDir), 0.);
  vec3 spec = uSunCol * (pow(sd, 500.) * 5. + pow(sd, 50.) * .35);
  vec3 deep = mix(vec3(.02, .06, .1), vec3(.07, .22, .28), uDay);
  vec3 c = mix(deep, sky, .25 + .7 * fres) + spec;
  gl_FragColor = vec4(c, mix(.72, .96, fres));
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
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(280, 32, 16),
    new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  scene.add(dome);

  // water: reflects the same sky gradient, with a sun / moon streak
  const waterU = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uDay: { value: 1 }, uSunCol: { value: new THREE.Color() },
  }]);
  Object.assign(waterU, { uTop: skyU.uTop, uHorizon: skyU.uHorizon, uDir: skyU.uDir });
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700),
    new THREE.ShaderMaterial({ uniforms: waterU, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, fog: true }),
  );
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  const clouds = [];
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8a95a0, transparent: true, opacity: 0.92 });
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(6 + Math.random() * 6, 0), cloudMat);
      m.position.set(k * 8 - 12, Math.random() * 3, Math.random() * 8 - 4);
      m.scale.y = 0.5;
      g.add(m);
    }
    g.position.set(Math.random() * 500 - 250, 95 + Math.random() * 30, Math.random() * 500 - 250);
    clouds.push(g);
    scene.add(g);
  }

  // stars: a dome of points that follows the camera
  const NSTAR = 700, sp = new Float32Array(NSTAR * 3);
  for (let i = 0; i < NSTAR; i++) {
    const th = Math.random() * 6.283, ph = Math.acos(Math.random() * 0.95 + 0.05);
    sp[i * 3] = Math.sin(ph) * Math.cos(th) * 260;
    sp[i * 3 + 1] = Math.cos(ph) * 260;
    sp[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 260;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xe8eeff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  scene.add(stars);

  /** lighting summary for custom shaders (grass), post grade and gameplay */
  const light = { day: 1, night: 0, dusk: 0, amb: new THREE.Color(), sun: new THREE.Color() };

  function apply(camera) {
    const a = (time - 0.25) * Math.PI * 2;
    const el = Math.sin(a) * 0.9 + 0.18; // sun height; the offset makes days longer than nights
    const day = sstep(-0.1, 0.22, el);
    const dusk = 1 - sstep(0.04, 0.4, Math.abs(el - 0.03));
    light.day = day; light.night = 1 - day; light.dusk = dusk;

    zenith.copy(TOP_NIGHT).lerp(TOP_DAY, day).lerp(TOP_DUSK, dusk * 0.7);
    horizon.copy(HOR_NIGHT).lerp(HOR_DAY, day).lerp(HOR_DUSK, dusk * 0.85);
    scene.fog.color.copy(horizon);
    scene.fog.near = mix(16, touch ? 55 : 70, day); // night narrows the view
    scene.fog.far = mix(62, touch ? 145 : 190, day);

    hemi.color.copy(HEMI_NIGHT).lerp(HEMI_DAY, day);
    hemi.groundColor.copy(GROUND_NIGHT).lerp(GROUND_DAY, day);
    hemi.intensity = mix(0.32, 0.9, day) * Math.PI;

    // sun above the horizon, moon otherwise; both fade to zero at the horizon so the swap is invisible
    const cx = Math.cos(a);
    if (el >= 0) {
      dir.set(cx, el, 0.4).normalize();
      sun.color.copy(SUN_DUSK).lerp(SUN_DAY, sstep(0.05, 0.45, el));
      sun.intensity = 0.85 * Math.PI * sstep(0, 0.15, el);
      skyU.uDisc.value.copy(DISC_DUSK).lerp(DISC_DAY, sstep(0.05, 0.45, el));
      skyU.uHalo.value.copy(SUN_DUSK).lerp(SUN_DAY, sstep(0.1, 0.6, el));
      skyU.uDiscCos.value = 0.9988; // a large, soft sun as in the reference
      skyU.uGlow.value = 0.6 + dusk * 0.9;
    } else {
      dir.set(-cx, -el, -0.4).normalize();
      sun.color.copy(MOON);
      sun.intensity = 0.3 * Math.PI * sstep(0, 0.15, -el);
      skyU.uDisc.value.copy(DISC_MOON);
      skyU.uHalo.value.copy(MOON).multiplyScalar(0.35);
      skyU.uDiscCos.value = 0.9995;
      skyU.uGlow.value = 0.5;
    }
    discDir.copy(dir);
    if (discDir.y < 0.02) { discDir.y = 0.02; discDir.normalize(); }
    lz.copy(dir).negate();
    lx.crossVectors(UP, lz).normalize();
    ly.crossVectors(lz, lx);

    waterU.uDay.value = day;
    waterU.uSunCol.value.copy(skyU.uDisc.value).multiplyScalar(el >= 0 ? sstep(-0.02, 0.1, el) : 0.6 * sstep(0, 0.15, -el));

    light.amb.copy(AMB_NIGHT).lerp(AMB_DAY, day);
    light.sun.copy(sun.color).multiplyScalar((sun.intensity / Math.PI) * 0.53);

    cloudMat.emissive.copy(CLOUD_EM_NIGHT).lerp(CLOUD_EM_DAY, day).lerp(CLOUD_DUSK, dusk * 0.5);
    cloudMat.color.setScalar(mix(0.25, 1, day));

    const nightVis = 1 - sstep(-0.05, 0.25, el);
    starMat.opacity = nightVis;
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
    update(dt, now, px, pz, py, camera) {
      time = (time + dt / DAY_LENGTH) % 1;
      apply(camera);
      waterU.uTime.value = now / 1000;
      focus.set(px, py, pz);
      const u = focus.dot(lx), v = focus.dot(ly);
      focus.addScaledVector(lx, Math.round(u / texel) * texel - u).addScaledVector(ly, Math.round(v / texel) * texel - v);
      sun.target.position.copy(focus);
      sun.position.copy(focus).addScaledVector(dir, 150);
      water.position.set(Math.round(px / 50) * 50, Math.sin(now * 0.001) * 0.06, Math.round(pz / 50) * 50);
      for (const c of clouds) {
        c.position.x += dt * 2;
        if (c.position.x - px > 260) c.position.x -= 520;
        if (px - c.position.x > 260) c.position.x += 520;
        if (c.position.z - pz > 260) c.position.z -= 520;
        if (pz - c.position.z > 260) c.position.z += 520;
      }
    },
  };
}
