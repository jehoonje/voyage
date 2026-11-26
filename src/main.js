// Entry: renderer, player physics, camera, and the main loop.
import * as THREE from 'three';
import { clamp, mix } from './noise.js';
import { sample, biome, weights } from './world.js';
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
import { createWeather } from './weather.js';
import { createAmbience } from './ambience.js';
import { createFish } from './fish.js';
import { createFishing } from './fishing.js';

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
const DEBUG = new URLSearchParams(location.search); // testing aid: ?at=x,z  &t=0..1 (clock)  &w=weather
const weather = createWeather(scene, { force: DEBUG.get('w') });
const ambience = createAmbience(scene);
const fish = createFish(scene);

/* what surrounds the player, averaged over a small ring and eased over time */
const bio = { desert: 0, jungle: 0, forest: 0, meadow: 0, sea: 0, snow: 0, cold: 0 };
const bioT = { ...bio };
let bioTimer = 0;
const RING = [[0, 0], [14, 0], [-14, 0], [0, 14], [0, -14], [24, 24], [-24, -24], [24, -24], [-24, 24]];
function updateBio(dt, x, z, snap = false) {
  if ((bioTimer -= dt) <= 0 || snap) {
    bioTimer = 0.4;
    for (const k in bioT) bioT[k] = 0;
    for (const [ox, oz] of RING) {
      const s = sample(x + ox, z + oz), b = biome(s), [d, w, f] = weights(s), land = s.h > 0 ? 1 : 0;
      bioT.desert += (b === 'desert' ? 1 : d * land * 0.5);
      bioT.jungle += b === 'jungle' ? 1 : 0;
      bioT.forest += b === 'forest' ? 1 : 0;
      bioT.meadow += b === 'meadow' ? 1 : 0;
      bioT.sea += b === 'sea' ? 1 : 0;
      bioT.snow += b === 'snow' ? 1 : 0;
      bioT.cold += Math.max(b === 'snow' ? 1 : 0, Math.min(1, Math.max(0, (s.h - 42) / 12)) * (1 - d));
    }
    for (const k in bioT) bioT[k] /= RING.length;
  }
  const k = snap ? 1 : Math.min(1, dt * 0.6);
  for (const kk in bio) bio[kk] += (bioT[kk] - bio[kk]) * k;
}
weather.onChange((st) => {
  if (!started) return;
  const what = bio.cold > 0.5 ? { rain: ['Snow', 'Snow is starting to fall'], storm: ['Blizzard', 'A fierce blizzard sweeps in'] }
    : bio.desert > 0.5 ? { rain: ['Sandstorm', 'The sand is starting to blow'], storm: ['Dust storm', "Sand so thick you can't see ahead"] }
    : { rain: ['Rain', 'Rain is starting to fall'], storm: ['Storm', 'Thunder rolls in'] };
  const msg = what[st] || (st === 'fog' ? ['Fog', 'A thick fog settles in'] : st === 'clear' ? ['Clear', 'The sky has cleared'] : null);
  if (msg) progress.toast('Weather', msg[0], msg[1]);
});
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
const fishing = createFishing({ scene, P, hero, progress, fx, onPickup: (t) => inventory.flash(t) });
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
  if (actions.sitting) { mode = 'douse'; label = 'Put out fire and stand'; }
  else if (fishing.active) { mode = 'reel'; label = fishing.state === 'bite' ? 'Reel in!' : 'Reel in'; }
  else if (!actions.busy && !P.swim) {
    nearTree = world.nearestTree(P.x, P.z, 2.8);
    if (fishing.canFish()) { mode = 'fish'; label = 'Fish'; } // facing open water from the bank (turn away to chop)
    else if (nearTree) { mode = 'chop'; label = 'Chop tree'; }
  }
  const lbl = mode + label;
  if (lbl !== ctxMode) { ctxMode = lbl; ctxBtn.hidden = !mode; ctxBtn.textContent = label; ctxBtn.dataset.mode = mode; }
  ctxBtn.classList.toggle('bite', fishing.state === 'bite');
  document.body.classList.toggle('busy', actions.busy);
  if (actions.busy) setMenu(false);
}
function doContext() {
  const mode = ctxBtn.dataset.mode;
  if (mode === 'douse') actions.endCamp();
  else if (mode === 'chop' && nearTree) actions.startChop(nearTree);
  else if (mode === 'fish') fishing.start();
  else if (mode === 'reel') fishing.reel();
  refreshContext();
}
function setMenu(open) { campMenu.hidden = !open; campBtn.setAttribute('aria-expanded', open); }
ctxBtn.addEventListener('click', doContext);
campBtn.addEventListener('click', () => setMenu(campMenu.hidden));
document.getElementById('pitchBtn').addEventListener('click', () => { setMenu(false); actions.startCamp(); refreshContext(); });
addEventListener('keydown', (e) => {
  if (!started) return;
  if (e.code === 'KeyE') doContext();
  if (e.code === 'KeyC' && !actions.busy && !fishing.active) { actions.startCamp(); refreshContext(); }
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
  if (fishing.active && inp.mag > 0.35 && fishing.state !== 'show') fishing.cancel(); // walking off reels the line in
  const frozen = actions.busy || hero.edging || fishing.active;
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
  fishing.update(dt);

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
  updateBio(dt, P.x, P.z);
  const sky = weather.update(dt, camera, bio, env.light);
  env.update(dt, now, P.x, P.z, P.y, camera, bio, sky);
  ambience.update(dt, now, camera, P.x, P.y, P.z, bio, env.light, sky, env.sun);
  fish.update(dt, P);
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
  if (!cont && DEBUG.has('at')) { const [x, z] = DEBUG.get('at').split(',').map(Number); if (isFinite(x) && isFinite(z)) { P.x = x; P.z = z; } }
  let t = 0.3;
  if (pos) { try { t = parseFloat(localStorage.getItem(TIME_KEY)) || 0.3; } catch { /* storage unavailable */ } }
  if (DEBUG.has('t')) t = parseFloat(DEBUG.get('t')) || t;
  if (DEBUG.has('cam')) { const [pt, ds, yw] = DEBUG.get('cam').split(',').map(Number); if (isFinite(pt)) cam.pitch = pt; if (isFinite(ds)) cam.dist = ds; if (isFinite(yw)) cam.yaw = yw; }
  env.time = t;
  P.y = Math.max(sample(P.x, P.z).h, SWIM_Y);
  P.vx = P.vz = P.vy = 0;
  world.update(P.x, P.z, true);
  updateBio(0, P.x, P.z, true); // know the land at once (no rain falling on a desert for the first seconds)
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
    if (isNight) progress.toast('Night', 'Darkness has fallen', 'A campfire will light your surroundings');
    else progress.toast('Morning', 'Day has broken', 'You can see far again');
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
    contBtn.disabled = true; contBtn.textContent = 'Preparing character…';
    while (!hero.ready) await new Promise((r) => setTimeout(r, 100));
    contBtn.disabled = false; contBtn.textContent = 'Continue';
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
