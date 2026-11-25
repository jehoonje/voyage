// Entry: renderer, player physics, camera, and the main loop.
import * as THREE from 'three';
import { clamp, mix } from './noise.js';
import { sample, biome } from './world.js';
import { ChunkManager } from './chunks.js';
import { createEnvironment } from './sky.js';
import { createCharacter, loadSpec } from './character/character.js';
import { DEFAULT_SPEC } from './character/parts.js';
import { createCreator } from './creator.js';
import { preventPageZoom } from './nozoom.js';
preventPageZoom();
import { createInput } from './input.js';
import { createProgress } from './progress.js';
import { createMap } from './map.js';
import { createGrass } from './grass.js';
import { windTime, rimLight } from './wind.js';
import { createFx } from './fx.js';
import { createCampfires } from './campfire.js';
import { createForestry } from './forestry.js';
import { createActions } from './actions.js';
import { createInventory } from './inventory.js';
import { createPhysics, SWIM_Y } from './physics.js';
import { createPost } from './post.js';

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
let post = null;
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (post) post.resize();
}
addEventListener('resize', resize);
resize();
post = createPost(renderer);
const draw = (now) => post.render(scene, camera, now / 1000, env.light.dusk, env.light.night);

const env = createEnvironment(scene);
const world = new ChunkManager(scene);
const hero = createCharacter(scene);
const savedSpec = loadSpec();
hero.apply(savedSpec || DEFAULT_SPEC).catch(() => { /* retried when the creator opens */ });
const progress = createProgress();
const grass = createGrass(scene);
const fx = createFx(scene);
const fires = createCampfires(scene, fx);
const forestry = createForestry(world);
const physics = createPhysics(world, fires);

const P = { x: 0, y: 0, z: 0, vx: 0, vz: 0, vy: 0, face: 0, grounded: true, swim: false, jumping: false, sliding: false, land: 0 };
const cam = { yaw: 0.6, pitch: 0.38, dist: 9, cur: 9 };
const PITCH_MIN = -0.95, PITCH_MAX = 1.35, DIST_MIN = 2.2, DIST_MAX = 24;

const map = createMap(progress, () => P);
const inventory = createInventory(progress);
const actions = createActions({ P, fires, fx, progress, onPickup: (t) => inventory.flash(t) });
const input = createInput({
  onJump() { if (!actions.busy) physics.jump(P); },
  onMap: () => map.toggle(),
  onLook(dx, dy) { cam.yaw -= dx * 0.006; cam.pitch = clamp(cam.pitch + dy * 0.004, PITCH_MIN, PITCH_MAX); },
  // d > 0 zooms out; multiplicative so it feels the same near and far
  onZoom(d) { cam.dist = clamp(cam.dist * Math.exp(d * 0.0015), DIST_MIN, DIST_MAX); },
});

/** a random walkable start somewhere in the first few kilometres: forest, meadow, jungle or desert, not too steep */
const SPAWN_BIOMES = new Set(['forest', 'meadow', 'jungle', 'desert']);
function findSpawn() {
  const R = 8000;
  for (let i = 0; i < 600; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, s = sample(x, z);
    if (!SPAWN_BIOMES.has(biome(s)) || s.h < 3 || s.h > 34) continue;
    const e = 2, gx = sample(x + e, z).h - sample(x - e, z).h, gz = sample(x, z + e).h - sample(x, z - e).h;
    if (Math.hypot(gx, gz) / (2 * e) > 0.45) continue; // no cliffsides
    return [x, z];
  }
  for (let r = 0; r < 4000; r += 20) for (let a = 0; a < 6.28; a += 0.4) { // fallback: nearest pleasant ground
    const x = Math.cos(a) * r, z = Math.sin(a) * r, s = sample(x, z), b = biome(s);
    if ((b === 'forest' || b === 'meadow') && s.h > 3 && s.h < 20) return [x, z];
  }
  return [0, 0];
}

let started = false, last = performance.now();

/* context button (chop / douse) and camp menu */
const ctxBtn = document.getElementById('ctxBtn'), campBtn = document.getElementById('campBtn'), campMenu = document.getElementById('campMenu');
let ctxMode = '', nearTree = null, ctxTimer = 0;
function refreshContext() {
  let mode = '', label = '';
  if (actions.sitting) { mode = 'douse'; label = '불 끄고 일어나기'; }
  else if (!actions.busy && !P.swim) {
    nearTree = world.nearestTree(P.x, P.z, 2.8);
    if (nearTree) { mode = 'chop'; label = '나무 캐기'; }
  }
  if (mode !== ctxMode) { ctxMode = mode; ctxBtn.hidden = !mode; ctxBtn.textContent = label; }
  document.body.classList.toggle('busy', actions.busy);
  if (actions.busy) setMenu(false);
}
function doContext() {
  if (ctxMode === 'douse') actions.endCamp();
  else if (ctxMode === 'chop' && nearTree) actions.startChop(nearTree);
  refreshContext();
}
function setMenu(open) { campMenu.hidden = !open; campBtn.setAttribute('aria-expanded', open); }
ctxBtn.addEventListener('click', doContext);
campBtn.addEventListener('click', () => setMenu(campMenu.hidden));
document.getElementById('pitchBtn').addEventListener('click', () => { setMenu(false); actions.startCamp(); refreshContext(); });
addEventListener('keydown', (e) => {
  if (!started) return;
  if (e.code === 'KeyE') doContext();
  if (e.code === 'KeyC' && !actions.busy) { actions.startCamp(); refreshContext(); }
});

function step(now) {
  requestAnimationFrame(step);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (creator.active) { creator.frame(dt); return; }
  if (!started) { draw(now); return; }

  // movement relative to camera
  const inp = input.read();
  const actPose = actions.update(dt, now);
  const frozen = actions.busy || hero.edging;
  let mag = frozen ? 0 : inp.mag;
  const fwdX = -Math.sin(cam.yaw), fwdZ = -Math.cos(cam.yaw), rgtX = Math.cos(cam.yaw), rgtZ = -Math.sin(cam.yaw);
  let mx = fwdX * -inp.y + rgtX * inp.x, mz = fwdZ * -inp.y + rgtZ * inp.x;
  const ml = Math.hypot(mx, mz);
  let wx = 0, wz = 0;
  if (!frozen && ml > 0.01 && mag > 0.08) {
    mx /= ml; mz /= ml;
    wx = mx * mag; wz = mz * mag;
    let d = Math.atan2(mx, mz) - P.face;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    P.face += d * Math.min(1, dt * 12);
  }
  if (actions.busy) { P.vx *= 0.8; P.vz *= 0.8; }
  const wasSwim = P.swim;
  const ph = physics.step(P, dt, wx, wz, inp.run && !actions.busy);
  if (wasSwim && !P.swim && P.grounded && P.y - SWIM_Y > 0.35) { // reached a bank: haul out
    hero.edge(P.y - SWIM_Y); P.vx *= 0.2; P.vz *= 0.2;
  }
  if (ph.impact > 11) {
    P.land = Math.min(1, (ph.impact - 9) / 10);
    fx.smoke(P.x, P.y + 0.1, P.z, 3);
  }
  if (ph.splash > 4) fx.splash(P.x, SWIM_Y + 1.1, P.z, Math.min(14, 4 + ph.splash));
  P.land = Math.max(0, P.land - dt * 3);

  // animate from actual ground speed so inertia and slopes show in the stride
  const hs = Math.hypot(P.vx, P.vz);
  hero.animate(dt, P, hs, actPose);

  // third-person camera, kept above terrain
  // trees between hero and camera dissolve (see forestry.occlude)
  const headY = P.y + 1.3;
  // below the horizon the camera stays low behind the hiker and tilts up toward the sky instead of digging into the ground
  const up = Math.max(0, -cam.pitch) / -PITCH_MIN; // 0..1 how far we're looking up
  const orbit = cam.pitch > 0 ? cam.pitch : cam.pitch * 0.25;
  const ox = Math.sin(cam.yaw) * Math.cos(orbit), oy = Math.sin(orbit), oz = Math.cos(cam.yaw) * Math.cos(orbit);
  cam.cur += (cam.dist * (1 - 0.45 * up) - cam.cur) * Math.min(1, dt * 10);
  forestry.occlude(dt, P.x, headY, P.z, P.x + ox * (cam.cur + 1), headY + oy * (cam.cur + 1), P.z + oz * (cam.cur + 1));
  const cx = P.x + ox * cam.cur, cz = P.z + oz * cam.cur;
  const cy = Math.max(headY + oy * cam.cur, Math.max(sample(cx, cz).h, 0) + 0.6);
  camera.position.set(cx, cy, cz);
  camera.lookAt(P.x, headY + Math.tan(up * 1.15) * cam.cur, P.z);
  camera.updateMatrixWorld();

  world.update(P.x, P.z);
  world.pump(2);
  world.cull(camera, P.x, P.z);
  windTime.value = now / 1000;
  rimLight.value = 0.06 + 0.3 * env.light.day;
  grass.update(P.x, P.z);
  env.update(dt, now, P.x, P.z, P.y, camera);
  fires.setNight(env.light.night);
  grass.setLight(env.light.amb, env.light.sun, fires.glow.strength > 0 ? fires.glow : null);
  updateDayNight(dt);
  fires.update(dt, now);
  fx.update(dt);
  forestry.update(now);
  if ((ctxTimer -= dt) <= 0) { ctxTimer = 0.15; refreshContext(); }
  progress.explore(P.x, P.z);
  if (map.open && mag > 0) map.request();
  draw(now);
}

function begin(cont) {
  const pos = cont ? progress.load() : null;
  if (pos) { P.x = pos.x; P.z = pos.z; }
  else { [P.x, P.z] = findSpawn(); progress.reset(); }
  let t = 0.3;
  if (pos) { try { t = parseFloat(localStorage.getItem(TIME_KEY)) || 0.3; } catch { /* storage unavailable */ } }
  env.time = t;
  P.y = Math.max(sample(P.x, P.z).h, SWIM_Y);
  P.vx = P.vz = P.vy = 0;
  world.update(P.x, P.z, true);
  document.getElementById('start').hidden = true;
  started = true;
}

/* day / night announcements and clock */
const clockEl = document.getElementById('clock');
let wasNight = null, clockT = 0;
function updateDayNight(dt) {
  if ((clockT -= dt) <= 0) { clockT = 0.5; clockEl.textContent = env.clock(); }
  const isNight = wasNight ? env.light.night > 0.4 : env.light.night > 0.6; // hysteresis
  if (wasNight !== null && isNight !== wasNight) {
    if (isNight) progress.toast('밤', '어둠이 내려앉았어요', '모닥불을 피우면 주변이 밝아져요');
    else progress.toast('아침', '날이 밝았어요', '다시 멀리까지 보여요');
  }
  wasNight = isNight;
}
const TIME_KEY = 'mjdr-time';

const contBtn = document.getElementById('goCont'), editBtn = document.getElementById('goEdit'), startEl = document.getElementById('start');
contBtn.hidden = editBtn.hidden = !progress.hasSave();
let pendingCont = false;
const creator = createCreator({ renderer, hero, onDone: () => { resize(); begin(pendingCont); } });
function openCreator(cont) {
  pendingCont = cont;
  startEl.hidden = true;
  creator.open(hero.spec || loadSpec() || DEFAULT_SPEC);
}
document.getElementById('goNew').addEventListener('click', () => openCreator(false));
editBtn.addEventListener('click', () => openCreator(true));
contBtn.addEventListener('click', async () => {
  if (!loadSpec()) { openCreator(true); return; } // saved before characters existed
  if (!hero.ready) {
    contBtn.disabled = true; contBtn.textContent = '캐릭터 준비 중…';
    while (!hero.ready) await new Promise((r) => setTimeout(r, 100));
    contBtn.disabled = false; contBtn.textContent = '이어서 탐험';
  }
  begin(true);
});

function saveAll() {
  if (!started) return;
  progress.save(P.x, P.z);
  try { localStorage.setItem(TIME_KEY, String(env.time)); } catch { /* storage unavailable */ }
}
setInterval(saveAll, 5000);
addEventListener('pagehide', saveAll);

// scenery behind the start card
{
  const [x, z] = findSpawn(), h = sample(x, z).h;
  world.update(x, z, true);
  camera.position.set(x + 30, h + 28, z + 40);
  camera.lookAt(x, h + 4, z);
  env.update(0, 0, x, z, h, camera);
}
requestAnimationFrame(step);
