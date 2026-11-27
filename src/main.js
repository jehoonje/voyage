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
import { createProgress, paceFor, FISH_LVL } from './progress.js';
import { store } from './store.js';
import { createAccount } from './account.js';
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
import { createFishing, SPECIES } from './fishing.js';
import { syncClock, worldTime, pinTime, serverNow } from './clock.js';
import { createEmotes, EMOTES } from './emotes.js';
import { createNet, cleanName } from './net.js';
import { createWorldDB } from './worlddb.js';
import { createSigns } from './signs.js';
import { createBots } from './bots.js';
import { COOK, buffChips } from './cooking.js';
import { CAMP_COST, RELIGHT_COST, SIGN_COST } from './actions.js';

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
const DEBUG = new URLSearchParams(location.search); // testing aid: ?at=x,z  &t=0..1 (clock)  &w=weather  &net=local (tabs see each other)
const NET_LOCAL = DEBUG.get('net') === 'local';
syncClock();
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
hero.apply(DEFAULT_SPEC).catch(() => { /* retried when the creator opens */ }); // the saved look arrives after sign-in
const progress = createProgress();
const grass = createGrass(scene);
const fx = createFx(scene);
const fires = createCampfires(scene, fx);
const forestry = createForestry(world);
const physics = createPhysics(world, fires);

const P = { x: 0, y: 0, z: 0, vx: 0, vz: 0, vy: 0, face: 0, grounded: true, swim: false, jumping: false, sliding: false, land: 0 };
const cam = { yaw: 0.6, pitch: 0.38, dist: 9, cur: 9 };
const PITCH_MIN = -0.95, PITCH_MAX = 1.35, DIST_MIN = 2.2, DIST_MAX = 24;

/* the shared world: other players nearby, lasting camps and signs, region first-finders */
const signs = createSigns(scene);
const wdb = createWorldDB({ offline: NET_LOCAL });
const net = createNet({ scene, camera, local: NET_LOCAL, onEvent: netEvent });
if (NET_LOCAL) window.__net = net; // testing aid
// bot explorers wandering about (?bots=N to change how many, 0 for none)
const bots = createBots({ scene, camera, world, count: DEBUG.has('bots') ? Math.max(0, Math.min(12, parseInt(DEBUG.get('bots'), 10) || 0)) : 5 });
if (NET_LOCAL) setTimeout(() => { window.__bots = bots.list; window.__botsApi = bots; window.__g = { fishing, fires, progress, actions, P }; }); // testing aid
let myCamps = []; // { id, x, y, z, litUntil } — your camps, for travelling between them
let placeFirst = null;
const myName = () => progress.state.name || 'Explorer';

const map = createMap(progress, () => P, {
  getCamps: () => myCamps.map((c) => ({ ...c, lit: c.litUntil > serverNow() })),
  getSigns: () => signs.list,
  placeNote: () => (placeFirst ? 'this region was first found by ' + placeFirst : ''),
  onTravel: travelTo,
});
const inventory = createInventory(progress, {
  canCook: () => actions.sitting && actions.fire && fires.isLit(actions.fire),
  onCook: cook,
  bitingNow: () => fishing.bitingNow(),
});
const actions = createActions({ P, fires, fx, progress, onPickup: (t) => inventory.flash(t), onCamp: campChanged, onSign: signPlaced });
const fishing = createFishing({
  scene, P, hero, progress, fx, getWeather: () => weather.state, onPickup: (t) => inventory.flash(t),
  onCatch: ({ species, cm, big }) => net.event('catch', { sp: species, cm, big }),
});
const emotes = createEmotes({ onEmote: (k) => net.event('emote', { k }) });
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
let ctxMode = '', nearTree = null, nearSign = null, nearFire = null, ctxTimer = 0;
function refreshContext() {
  let mode = '', label = '';
  if (actions.sitting) { mode = 'stand'; label = 'Stand up'; }
  else if (fishing.active) {
    mode = 'reel';
    label = { bite: 'Strike!', fight: 'Hold to reel', trophy: 'Nice catch!', show: 'Nice catch!' }[fishing.state] || 'Reel in';
  } else if (!actions.busy && !P.swim) {
    nearTree = world.nearestTree(P.x, P.z, 2.8);
    nearSign = signs.nearest(P.x, P.z, 2);
    if (fishing.canFish()) { // facing open water from the bank (turn away to chop)
      if (progress.state.lvl >= FISH_LVL) { mode = 'fish'; label = 'Fish'; }
      else { mode = 'fishLocked'; label = `Fish · Lv.${FISH_LVL}`; }
    }
    else if ((nearFire = fires.nearest(P.x, P.z, 2.6, true)) && nearFire.mine) { mode = 'douseNear'; label = 'Put out fire'; }
    else if (nearTree) { mode = 'chop'; label = 'Chop tree'; }
    else if (nearSign && nearSign.mine) { mode = 'unsign'; label = 'Take down my sign'; }
  }
  const lbl = mode + label;
  if (lbl !== ctxMode) { ctxMode = lbl; ctxBtn.hidden = !mode; ctxBtn.textContent = label; ctxBtn.dataset.mode = mode; }
  ctxBtn.classList.toggle('bite', fishing.state === 'bite');
  document.body.classList.toggle('fight', fishing.state === 'fight');
  const busy = actions.busy && !actions.sitting; // sitting by a fire you can still open the camp menu
  document.body.classList.toggle('busy', busy);
  if (busy) { setMenu(false); setEmoteMenu(false); }
}
function doContext() {
  const mode = ctxBtn.dataset.mode;
  if (mode === 'stand') actions.endCamp();
  else if (mode === 'douseNear' && nearFire) actions.douseNear(nearFire);
  else if (mode === 'chop' && nearTree) actions.startChop(nearTree);
  else if (mode === 'unsign' && nearSign) takeDownSign(nearSign);
  else if (mode === 'fish') fishing.start();
  else if (mode === 'fishLocked') progress.toast('Fishing', `Unlocks at Lv.${FISH_LVL}`, `You are Lv.${progress.state.lvl} · explore to level up`);
  else if (mode === 'reel') fishing.reel();
  refreshContext();
}
/* the Camp menu: what you can make or do here (it changes when you sit by a fire) */
function menuItems() {
  const wood = progress.count('wood'), items = [];
  if (actions.sitting) {
    const f = actions.fire, fish = Object.keys(SPECIES).some((id) => progress.count('fish_' + id) > 0);
    items.push(['cook', 'Cook a fish', fish ? 'Eat it for a speed (and bite) boost' : 'No fish in your bag', !fish || !fires.isLit(f)]);
    const away = myCamps.filter((c) => Math.hypot(c.x - f.x, c.z - f.z) > 20);
    items.push(['travel', 'Travel to a camp', away.length ? `${away.length} other camp${away.length > 1 ? 's' : ''} of yours` : 'Make camps elsewhere to travel between them', !away.length]);
    if (f && f.mine && fires.isLit(f)) items.push(['douse', 'Put out the fire', 'It stays as your camp']);
    items.push(['stand', 'Stand up', 'Leave it burning']);
  } else {
    const opt = actions.campOption();
    if (opt.kind === 'sit') items.push(['camp', 'Sit by the fire', `${opt.fire.mine ? 'Your' : (opt.fire.ownerName || 'Someone') + "'s"} campfire`]);
    else if (opt.kind === 'relight') items.push(['camp', 'Relight your camp', `${RELIGHT_COST} wood · you have ${wood}`, wood < RELIGHT_COST]);
    else if (opt.kind === 'theirs') items.push(['camp', `${opt.fire.ownerName || 'Someone'}'s old camp`, 'Make your own a few steps away', true]);
    else items.push(['camp', 'Make camp', `${CAMP_COST} wood · you have ${wood}`, wood < CAMP_COST]);
    const signed = wdb.canWrite || NET_LOCAL;
    items.push(['sign', 'Put up a sign', signed ? `${SIGN_COST} wood · everyone can read it` : 'Sign in to leave signs for others', !signed || wood < SIGN_COST]);
  }
  return items;
}
function setMenu(open) {
  if (open) {
    campMenu.innerHTML = menuItems().map(([k, b, sm, off]) => `<button class="mi" data-k="${k}"${off ? ' disabled' : ''}><b>${b}</b><small>${sm}</small></button>`).join('');
    setEmoteMenu(false);
  }
  campMenu.hidden = !open; campBtn.setAttribute('aria-expanded', open);
}
campMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-k]'); if (!b || b.disabled) return;
  setMenu(false);
  const k = b.dataset.k;
  if (k === 'camp') { emotes.stop(); actions.startCamp(); }
  else if (k === 'sign') openSignDialog();
  else if (k === 'cook') inventory.open('bag');
  else if (k === 'travel') map.openTravel();
  else if (k === 'douse') actions.douseCamp();
  else if (k === 'stand') actions.endCamp();
  refreshContext();
});
ctxBtn.addEventListener('click', doContext);
campBtn.addEventListener('click', () => setMenu(campMenu.hidden));

/* emotes */
const emoteBtn = document.getElementById('emoteBtn'), emoteMenu = document.getElementById('emoteMenu');
function setEmoteMenu(open) { emoteMenu.hidden = !open; emoteBtn.setAttribute('aria-expanded', open); if (open) campMenu.hidden = true; }
emoteBtn.addEventListener('click', () => setEmoteMenu(emoteMenu.hidden));
function emote(name) {
  setEmoteMenu(false);
  if (actions.busy || fishing.active || P.swim || !P.grounded) return;
  P.vx = P.vz = 0;
  emotes.play(name);
  bots.react(name, P);
}
emoteMenu.addEventListener('click', (e) => { const b = e.target.closest('[data-emote]'); if (b) emote(b.dataset.emote); });

/* the fight: hold the action button (or E) to reel */
const holdOn = () => { if (fishing.state === 'fight') fishing.setHold(true); };
const holdOff = () => fishing.setHold(false);
ctxBtn.addEventListener('pointerdown', holdOn);
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) ctxBtn.addEventListener(ev, holdOff);

/* signs */
const signDlg = document.getElementById('signDlg'), signText = document.getElementById('signText');
function openSignDialog() { signDlg.hidden = false; signText.value = ''; setTimeout(() => signText.focus(), 50); }
document.getElementById('signCancel').addEventListener('click', () => { signDlg.hidden = true; });
signDlg.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = signText.value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
  if (!text) return;
  signDlg.hidden = true;
  actions.startSign(text);
});
async function signPlaced(s) {
  const id = NET_LOCAL ? 'local-' + Math.random().toString(36).slice(2) : await wdb.putSign({ ...s, name: myName() });
  if (!id) { progress.addItem('wood', SIGN_COST); progress.toast('Sign', "Couldn't put the sign up", 'Your wood is back in the bag'); return; }
  signs.add({ id, ...s, ownerName: myName(), mine: true });
  net.event('sign', { id, x: s.x, z: s.z, f: s.face, tx: s.text });
  progress.toast('Sign', 'Sign put up', 'Everyone who passes by can read it');
}
function takeDownSign(sg) {
  wdb.removeSign(sg.id);
  signs.remove(sg.id);
  net.event('signGone', { id: sg.id });
  progress.toast('Sign', 'Sign taken down', '');
}

/* camps: tell the world when one is made, relit or put out */
async function campChanged(f, what) {
  if (what === 'made') {
    f.id = NET_LOCAL || !wdb.canWrite ? 'local-' + Math.random().toString(36).slice(2) : await wdb.makeFire({ x: f.x, y: f.y, z: f.z, name: myName(), litUntil: f.litUntil });
    if (!f.id) f.id = 'local-' + Math.random().toString(36).slice(2);
    myCamps.unshift({ id: f.id, x: f.x, y: f.y, z: f.z, litUntil: f.litUntil });
    if (myCamps.length > 5) myCamps.length = 5; // the oldest camp is let go
  } else {
    wdb.setLit(f.id, f.litUntil);
    const c = myCamps.find((m) => m.id === f.id); if (c) c.litUntil = f.litUntil;
  }
  if (what === 'made' || what === 'relit') bots.onFire(f, P, (q) => fires.isLit(q));
  if (what === 'doused') net.event('fireOut', { id: f.id });
  else net.event('fire', { id: f.id, x: f.x, z: f.z, lu: f.litUntil });
}
function cook(species) {
  const sp = SPECIES[species];
  if (!sp || !actions.sitting || !fires.isLit(actions.fire)) { progress.toast('Cooking', 'You need a lit campfire', 'Sit by one first'); return; }
  if (!progress.takeItem('fish_' + species, 1)) return;
  const c = COOK[sp.rarity];
  progress.addBuff('speed', c.speed, c.secs);
  if (c.bite) progress.addBuff('bite', c.bite, c.secs);
  const f = actions.fire; fx.smoke(f.x, f.y + 0.6, f.z, 5);
  progress.toast('Cooked', `Grilled ${sp.label}`, c.text[0].toUpperCase() + c.text.slice(1));
  inventory.flash(`${sp.label} −1`);
  inventory.refresh();
}
/* travel between your camps (from one you're sitting at) */
function travelTo(c) {
  if (!actions.sitting) return;
  const fade = document.getElementById('fade');
  fade.classList.add('on');
  setTimeout(() => {
    actions.leave();
    let f = fires.nearest(c.x, c.z, 3);
    if (!f) f = fires.spawn(c.x, sample(c.x, c.z).h, c.z, { id: c.id, mine: true, ownerName: myName(), litUntil: c.litUntil }, true);
    P.x = c.x + 1.6; P.z = c.z + 0.4; P.y = Math.max(sample(P.x, P.z).h, SWIM_Y); P.vx = P.vz = P.vy = 0;
    P.face = Math.atan2(c.x - P.x, c.z - P.z);
    world.update(P.x, P.z, true); updateBio(0, P.x, P.z, true);
    wdb.nearby(P.x, P.z, true).then(loadNearby);
    setTimeout(() => fade.classList.remove('on'), 250);
    progress.toast('Travel', 'You arrive at your camp', fires.isLit(f) ? 'The fire is still burning' : 'Relight it from the Camp menu');
  }, 480);
}
/* what other players do: fires, signs, catches */
function netEvent(m) {
  const near = (x, z) => Number.isFinite(x) && Number.isFinite(z) && Math.hypot(x - P.x, z - P.z) < 900;
  if (typeof m.id === 'string' && m.id.length > 64) return;
  if (m.type === 'fire' && typeof m.id === 'string' && near(m.x, m.z)) {
    const f = fires.list.find((q) => q.id === m.id), lu = Math.min(Number(m.lu) || 0, serverNow() + 3600e3);
    if (!f) fires.spawn(m.x, sample(m.x, m.z).h, m.z, { id: m.id, ownerName: m.by, mine: false, litUntil: lu }, true);
    else if (lu > serverNow() && !fires.isLit(f)) fires.relight(f, lu);
  } else if (m.type === 'fireOut') {
    const f = fires.list.find((q) => q.id === m.id); if (f && !f.mine) fires.douse(f);
  } else if (m.type === 'sign' && typeof m.id === 'string' && near(m.x, m.z) && typeof m.tx === 'string') {
    const text = m.tx.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40);
    if (text) signs.add({ id: m.id, x: m.x, y: sample(m.x, m.z).h, z: m.z, face: Number(m.f) || 0, text, ownerName: m.by, mine: false });
  } else if (m.type === 'signGone') signs.remove(m.id);
  else if (m.type === 'catch' && m.big) progress.toast('Nearby', `${m.name} landed a ${SPECIES[m.species].label}!`, `${m.cm} cm`);
}
function loadNearby(r) {
  if (!r) return;
  for (const c of r.fires) {
    if (fires.list.some((f) => f.id === c.id)) continue;
    fires.spawn(c.x, c.y, c.z, c, true);
  }
  for (const sg of r.signs) signs.add(sg);
  for (const f of [...fires.list]) if (f !== actions.fire && Math.hypot(f.x - P.x, f.z - P.z) > 900) fires.remove(f);
  signs.prune(P.x, P.z, 900);
}
/* region first-finders */
progress.onRegion((rk, nm) => {
  placeFirst = null;
  const el = document.getElementById('placeFirst'); el.hidden = true;
  wdb.claimFirst(rk, myName()).then((r) => {
    if (!r) return;
    if (r.first && !r.again) { progress.toast('First discovery!', nm, 'No one found this place before you · +50 XP'); progress.gain(50); }
    placeFirst = r.first ? 'you' : r.name;
    el.textContent = 'First found by ' + placeFirst; el.hidden = false;
  });
});

addEventListener('keydown', (e) => {
  if (!started || e.target.tagName === 'INPUT') return;
  if (e.code === 'KeyE' && !e.repeat) { if (fishing.state === 'fight') holdOn(); else doContext(); }
  if (e.code === 'KeyC' && !fishing.active && (!actions.busy || actions.sitting)) setMenu(campMenu.hidden);
  for (const [k, em] of Object.entries(EMOTES)) if (e.code === em.key) emote(k);
});
addEventListener('keyup', (e) => { if (e.code === 'KeyE') holdOff(); });

function step(now) {
  requestAnimationFrame(step);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (creator.active) { creator.frame(dt); return; }
  if (!started) { draw(now); return; }

  // movement relative to camera
  const inp = input.read();
  const actPose = actions.update(dt, now);
  if (inp.mag > 0.15 && emotes.current) emotes.stop(); // walking off ends an emote
  const emotePose = emotes.update(dt);
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
  const perks = progress.perks;
  P.pace = paceFor(progress.state.lvl) * (1 + progress.buff('speed').k);
  P.runPace = perks.run; P.swimPace = perks.swim;
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
  hero.animate(dt, P, hs, actPose || fishing.pose || emotePose);
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
  env.follow(worldTime()); // one shared clock for every player
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
  net.update(dt, { x: P.x, y: P.y, z: P.z, face: P.face, speed: hs, swim: P.swim, grounded: P.grounded, sitting: actions.sitting, fishing: fishing.active && fishing.state !== 'trophy' });
  bots.update(dt, P);
  socialTick(dt);
  draw(now);
}

let socialT = 0, hudT = 0;
const onlineEl = document.getElementById('online'), buffsEl = document.getElementById('buffs');
function socialTick(dt) {
  if ((socialT -= dt) <= 0) { socialT = 3; wdb.nearby(P.x, P.z).then(loadNearby); }
  if ((hudT -= dt) <= 0) {
    hudT = 0.5;
    buffsEl.innerHTML = buffChips(progress).map((t) => `<span>${t}</span>`).join('');
    const n = net.count;
    onlineEl.hidden = n === 0; onlineEl.textContent = n === 1 ? '1 explorer nearby' : `${n} explorers nearby`;
  }
}

function begin(cont) {
  const pos = cont ? progress.load() : null;
  if (pos) { P.x = pos.x; P.z = pos.z; }
  else { [P.x, P.z] = findSpawn(); progress.reset(); }
  // your public name: from the creator, else what you had, else a random one
  const typed = cleanName(document.getElementById('crName').value);
  if (document.getElementById('crName').value.trim()) progress.setName(typed);
  else if (!progress.state.name) progress.setName('Explorer ' + (1000 + Math.floor(Math.random() * 9000)));
  net.setMe({ id: store.uid || 'g-' + Math.random().toString(36).slice(2, 12), name: myName(), look: hero.spec });
  net.start();
  bots.start(P);
  myCamps = [];
  wdb.myCamps().then((list) => { if (list.length) myCamps = list; });
  wdb.nearby(P.x, P.z, true).then(loadNearby);
  if (!cont && DEBUG.has('at')) { const [x, z] = DEBUG.get('at').split(',').map(Number); if (isFinite(x) && isFinite(z)) { P.x = x; P.z = z; } }
  if (DEBUG.has('t')) pinTime(parseFloat(DEBUG.get('t')) || 0);
  if (DEBUG.has('lvl')) progress.state.lvl = Math.max(1, parseInt(DEBUG.get('lvl'), 10) || 1); // testing aid
  if (DEBUG.has('wood')) progress.addItem('wood', parseInt(DEBUG.get('wood'), 10) || 0);
  const t = worldTime();
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

const contBtn = document.getElementById('goCont'), editBtn = document.getElementById('goEdit'), startEl = document.getElementById('start');
// sign in (or play as a guest) first; then the buttons reflect that player's save
createAccount({
  onReady({ imported }) {
    contBtn.hidden = editBtn.hidden = !progress.hasSave();
    const spec = loadSpec();
    if (spec) hero.apply(spec).catch(() => { /* retried when the creator opens */ });
    if (imported) progress.toast('Welcome back', 'Your progress is now saved to your account', 'Play on any device');
  },
});
let pendingCont = false;
const creator = createCreator({ renderer, hero, onDone: () => { resize(); begin(pendingCont); } });
function openCreator(cont) {
  pendingCont = cont;
  document.getElementById('crName').value = (store.get('mjdr-save') || {}).name || '';
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
}
setInterval(saveAll, 5000);
addEventListener('pagehide', () => { saveAll(); store.flush(); });
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { saveAll(); store.flush(); } });

// scenery behind the start card
{
  const [x, z] = findSpawn(), h = sample(x, z).h;
  world.update(x, z, true);
  camera.position.set(x + 30, h + 28, z + 40);
  camera.lookAt(x, h + 4, z);
  env.update(0, 0, x, z, h, camera);
}
requestAnimationFrame(step);
