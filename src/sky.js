// Sky, fog, sun/moon, stars, water and clouds, driven by a day–night clock.
// time: 0 = midnight, 0.25 ≈ sunrise, 0.5 = noon, 0.75 ≈ sunset.
import * as THREE from 'three';
import { sstep, mix } from './noise.js';

export const DAY_LENGTH = 960; // real seconds per in-game day

const col = (h) => new THREE.Color(h);
const SKY_DAY = col(0xa9d4ee), SKY_DUSK = col(0xe9a27a), SKY_NIGHT = col(0x0b1426);
const HEMI_DAY = col(0xd8ecff), HEMI_NIGHT = col(0x4a5c92);
const GROUND_DAY = col(0x5b6440), GROUND_NIGHT = col(0x161b24);
const SUN_DAY = col(0xfff0d0), SUN_DUSK = col(0xffa060), MOON = col(0x9fb4ff);
const CLOUD_EM_DAY = col(0x8a95a0), CLOUD_EM_NIGHT = col(0x0a0e18), CLOUD_DUSK = col(0xffc9a8);
const AMB_DAY = col(0x8c8c8c), AMB_NIGHT = col(0x263456); // grass ambient

export function createEnvironment(scene, startTime = 0.3) {
  let time = startTime;
  const skyCol = new THREE.Color();
  scene.background = skyCol;
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
  const UP = new THREE.Vector3(0, 1, 0), moonDir = new THREE.Vector3();

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700),
    new THREE.MeshPhongMaterial({ color: 0x2f7fb6, transparent: true, opacity: 0.78, shininess: 90, specular: 0x99ccee }),
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
  scene.add(stars);
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(7, 24),
    new THREE.MeshBasicMaterial({ color: 0xf4f1e4, fog: false, transparent: true, depthWrite: false }),
  );
  scene.add(moon);

  /** lighting summary for custom shaders (grass) and gameplay */
  const light = { day: 1, night: 0, amb: new THREE.Color(), sun: new THREE.Color() };

  function apply(camera) {
    const a = (time - 0.25) * Math.PI * 2;
    const el = Math.sin(a) * 0.9 + 0.18; // sun height; the offset makes days longer than nights
    const day = sstep(-0.1, 0.22, el);
    const dusk = 1 - sstep(0.04, 0.32, Math.abs(el - 0.02));
    light.day = day; light.night = 1 - day;

    skyCol.copy(SKY_NIGHT).lerp(SKY_DAY, day).lerp(SKY_DUSK, dusk * 0.55);
    scene.fog.color.copy(skyCol);
    scene.fog.near = mix(16, 70, day); // night narrows the view
    scene.fog.far = mix(62, 190, day);

    hemi.color.copy(HEMI_NIGHT).lerp(HEMI_DAY, day);
    hemi.groundColor.copy(GROUND_NIGHT).lerp(GROUND_DAY, day);
    hemi.intensity = mix(0.32, 0.95, day) * Math.PI;

    // sun above the horizon, moon otherwise; both fade to zero at the horizon so the swap is invisible
    const cx = Math.cos(a);
    if (el >= 0) {
      dir.set(cx, el, 0.4).normalize();
      sun.color.copy(SUN_DUSK).lerp(SUN_DAY, sstep(0.05, 0.4, el));
      sun.intensity = 0.85 * Math.PI * sstep(0, 0.15, el);
    } else {
      dir.set(-cx, -el, -0.4).normalize();
      sun.color.copy(MOON);
      sun.intensity = 0.3 * Math.PI * sstep(0, 0.15, -el);
    }
    lz.copy(dir).negate();
    lx.crossVectors(UP, lz).normalize();
    ly.crossVectors(lz, lx);

    light.amb.copy(AMB_NIGHT).lerp(AMB_DAY, day);
    light.sun.copy(sun.color).multiplyScalar((sun.intensity / Math.PI) * 0.53);

    cloudMat.emissive.copy(CLOUD_EM_NIGHT).lerp(CLOUD_EM_DAY, day).lerp(CLOUD_DUSK, dusk * 0.4);
    cloudMat.color.setScalar(mix(0.25, 1, day));

    const nightVis = 1 - sstep(-0.05, 0.25, el);
    starMat.opacity = nightVis;
    stars.visible = nightVis > 0.01;
    moon.visible = el < 0.05;
    if (camera) {
      stars.position.copy(camera.position);
      moonDir.set(-cx, Math.max(-el, 0.08) + 0.15, -0.4).normalize();
      moon.position.copy(camera.position).addScaledVector(moonDir, 240);
      moon.lookAt(camera.position);
      moon.material.opacity = sstep(0.05, -0.15, el);
    }
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
