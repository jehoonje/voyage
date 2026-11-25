// Entry: renderer, player physics, camera, and the main loop.
import * as THREE from 'three';
import { clamp, mix } from './noise.js';
import { sample, biome } from './world.js';
import { ChunkManager } from './chunks.js';
import { createEnvironment } from './sky.js';
import { createHero } from './hero.js';
import { createInput } from './input.js';
import { createProgress } from './progress.js';
import { createMap } from './map.js';
import { createGrass } from './grass.js';
import { windTime } from './wind.js';

// Keep the authored (non-linear) colours looking as designed.
THREE.ColorManagement.enabled = false;

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio < 2 });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 320);
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const env = createEnvironment(scene);
const world = new ChunkManager(scene);
const hero = createHero(scene);
const progress = createProgress();
const grass = createGrass(scene);

const SWIM_DEPTH = -1.15, SWIM_Y = -1.1;
const P = { x: 0, y: 0, z: 0, vy: 0, face: 0, grounded: true, swim: false };
const cam = { yaw: 0.6, pitch: 0.38, dist: 9 };

const map = createMap(progress, () => P);
const input = createInput({
  onJump() { if (P.grounded && !P.swim) { P.vy = 9.5; P.grounded = false; } },
  onMap: () => map.toggle(),
  onLook(dx, dy) { cam.yaw -= dx * 0.006; cam.pitch = clamp(cam.pitch + dy * 0.004, 0.05, 1.25); },
  onZoom(d) { cam.dist = clamp(cam.dist + d * 0.01, 4, 18); },
});

function findSpawn() {
  for (let r = 0; r < 4000; r += 20) for (let a = 0; a < 6.28; a += 0.4) {
    const x = Math.cos(a) * r, z = Math.sin(a) * r, s = sample(x, z), b = biome(s);
    if ((b === 'forest' || b === 'meadow') && s.h > 3 && s.h < 20) return [x, z];
  }
  return [0, 0];
}

let started = false, last = performance.now();

function step(now) {
  requestAnimationFrame(step);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!started) { renderer.render(scene, camera); return; }

  // movement relative to camera
  const inp = input.read();
  let mag = inp.mag;
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
  let mx = fx * -inp.y + rx * inp.x, mz = fz * -inp.y + rz * inp.x;
  const ml = Math.hypot(mx, mz);
  P.swim = sample(P.x, P.z).h < SWIM_DEPTH;
  const speed = (inp.run ? 15 : 7.5) * (P.swim ? 0.55 : 1);
  if (ml > 0.01 && mag > 0.08) {
    mx /= ml; mz /= ml;
    P.x += mx * speed * mag * dt;
    P.z += mz * speed * mag * dt;
    let d = Math.atan2(mx, mz) - P.face;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    P.face += d * Math.min(1, dt * 12);
  } else mag = 0;

  // vertical
  const ground = sample(P.x, P.z).h, floor = ground < SWIM_DEPTH ? SWIM_Y : ground;
  P.vy -= 26 * dt;
  P.y += P.vy * dt;
  if (P.y <= floor) { P.y = floor; P.vy = 0; P.grounded = true; }
  else if (P.y - floor > 0.25 && !P.swim) P.grounded = false;
  if (P.swim) { P.y = mix(P.y, SWIM_Y, Math.min(1, dt * 6)); P.vy = 0; P.grounded = true; }

  hero.animate(dt, P, mag, inp.run);

  // third-person camera, kept above terrain
  const cd = cam.dist * Math.cos(cam.pitch);
  const cx = P.x + Math.sin(cam.yaw) * cd, cz = P.z + Math.cos(cam.yaw) * cd;
  const cy = Math.max(P.y + 1.6 + cam.dist * Math.sin(cam.pitch), Math.max(sample(cx, cz).h, 0) + 1.2);
  camera.position.set(cx, cy, cz);
  camera.lookAt(P.x, P.y + 1.6, P.z);
  camera.updateMatrixWorld();

  world.update(P.x, P.z);
  world.pump(2);
  world.cull(camera, P.x, P.z);
  windTime.value = now / 1000;
  grass.update(P.x, P.z);
  env.update(dt, now, P.x, P.z, P.y);
  progress.explore(P.x, P.z);
  if (map.open && mag > 0) map.request();
  renderer.render(scene, camera);
}

function begin(cont) {
  const pos = cont ? progress.load() : null;
  if (pos) { P.x = pos.x; P.z = pos.z; }
  else { [P.x, P.z] = findSpawn(); progress.reset(); }
  P.y = Math.max(sample(P.x, P.z).h, SWIM_Y);
  world.update(P.x, P.z, true);
  document.getElementById('start').hidden = true;
  started = true;
}

const contBtn = document.getElementById('goCont');
contBtn.hidden = !progress.hasSave();
document.getElementById('goNew').addEventListener('click', () => begin(false));
contBtn.addEventListener('click', () => begin(true));

setInterval(() => started && progress.save(P.x, P.z), 5000);
addEventListener('pagehide', () => started && progress.save(P.x, P.z));

// scenery behind the start card
{
  const [x, z] = findSpawn(), h = sample(x, z).h;
  world.update(x, z, true);
  camera.position.set(x + 30, h + 28, z + 40);
  camera.lookAt(x, h + 4, z);
}
requestAnimationFrame(step);
