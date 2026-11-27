// Fishing from the bank (never while swimming).
//  cast → wait (the float bobs; small nibbles tease) → BITE (the float plunges: strike now) →
//  small fish come straight in; bigger or rarer ones fight: hold to reel, ease off when the line
//  gets tight or it snaps → reel in → show the catch (a big one is held overhead for everyone to see).
// What bites depends on the water (sea / river), the land around it, the shared time of day and the weather.
import * as THREE from 'three';
import F from './fishModels.js';
import { sample, biome } from './world.js';
import { partOfDay } from './clock.js';
import { trophyPose } from './emotes.js';

/**
 * model: which mesh; tint: recolour (optional); stretch: non-uniform scale; glow: emissive
 * cm: size range; where: weight by water; near: needs this terrain close by; when: parts of day; weather
 * fight: 0 = comes straight in, otherwise how hard it pulls
 */
export const SPECIES = {
  minnow: { label: 'Minnow', model: 'minnow', cm: [12, 22], xp: 10, rarity: 'Common', where: { river: 60, sea: 40 }, hint: 'Rivers and the sea, any time' },
  clown: { label: 'Clownfish', model: 'clown', cm: [9, 14], xp: 15, rarity: 'Common', where: { sea: 18 }, when: ['dawn', 'day', 'dusk'], hint: 'The sea, by day' },
  tang: { label: 'Blue tang', model: 'tang', cm: [18, 30], xp: 15, rarity: 'Common', where: { sea: 18 }, when: ['dawn', 'day', 'dusk'], hint: 'The sea, by day' },
  snapper: { label: 'Red snapper', model: 'snapper', cm: [35, 70], xp: 25, rarity: 'Uncommon', where: { sea: 14, river: 20 }, fight: 0.5, hint: 'Rivers and the sea' },
  sunfish: { label: 'Sunfish', model: 'tang', tint: [0.98, 0.78, 0.22], cm: [25, 45], xp: 30, rarity: 'Uncommon', where: { sea: 16 }, near: 'desert', when: ['day'], fight: 0.45, hint: 'Sea off a desert coast, by day' },
  piranha: { label: 'Jungle piranha', model: 'clown', tint: [0.75, 0.25, 0.2], cm: [15, 30], xp: 30, rarity: 'Uncommon', where: { river: 18 }, near: 'jungle', fight: 0.55, hint: 'Jungle rivers' },
  frostchar: { label: 'Frost char', model: 'snapper', tint: [0.93, 0.66, 0.72], cm: [30, 60], xp: 35, rarity: 'Uncommon', where: { river: 16, sea: 10 }, near: 'snow', fight: 0.55, hint: 'Cold water below snowy peaks' },
  goldcarp: { label: 'Golden carp', model: 'snapper', tint: [1, 0.76, 0.16], cm: [50, 90], xp: 80, rarity: 'Rare', where: { river: 7 }, when: ['dawn', 'dusk'], fight: 0.75, hint: 'Rivers at dawn and dusk' },
  moonfin: { label: 'Moonfin', model: 'tang', tint: [0.62, 0.78, 1], glow: 0x1d3150, cm: [40, 80], xp: 80, rarity: 'Rare', where: { river: 7, sea: 5 }, when: ['night'], fight: 0.8, hint: 'Any water, only at night' },
  stormeel: { label: 'Storm eel', model: 'minnow', tint: [0.22, 0.36, 0.3], stretch: [0.6, 0.75, 2.4], cm: [60, 120], xp: 100, rarity: 'Rare', where: { sea: 9 }, weather: ['rain', 'storm'], fight: 0.95, hint: 'The sea in rain or storm' },
};
// the body: KayKit fishing clips (CC0) — Cast, Idle, Bite, Tug, Struggling (fight), Reeling, Catch;
// the rod lies along the direction the clip's tool hand holds it
const ROD_LEN = 2.3, RELEASE_AT = 1.12, FLIGHT = 0.6;
const WAIT = [1.5, 4.5], STRIKE = 1.0;

function fishMesh(sp) {
  const f = F[sp.model], g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(f.p, 3));
  const col = f.c.map((v) => v / 255);
  if (sp.tint) for (let i = 0; i < col.length; i += 3) { // keep the light and shade, change the hue
    const l = 0.3 * col[i] + 0.59 * col[i + 1] + 0.11 * col[i + 2], k = 0.35 + l * 1.3;
    for (let c = 0; c < 3; c++) col[i + c] = col[i + c] * 0.2 + sp.tint[c] * k * 0.8;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(f.i);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: sp.glow || 0 }));
}

/** what kind of land is close to a fishing spot (for the near-terrain fish) */
function surroundings(x, z) {
  const near = new Set();
  for (const [dx, dz] of [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30], [60, 60], [-60, -60], [60, -60], [-60, 60]]) near.add(biome(sample(x + dx, z + dz)));
  return near;
}

export function createFishing({ scene, P, hero, progress, fx, getWeather, onPickup, onCatch, onState }) {
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.022, ROD_LEN, 6).translate(0, ROD_LEN / 2, 0), new THREE.MeshLambertMaterial({ color: 0x3a2a1c }));
  rod.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8).translate(0, 0.25, 0), new THREE.MeshLambertMaterial({ color: 0x1c1c1c })));
  const float = new THREE.Group();
  float.add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xe8352a })));
  float.add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xf4f2ea })));
  const SEG = 18, linePos = new Float32Array((SEG + 1) * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xe8e8e0, transparent: true, opacity: 0.75 }));
  line.frustumCulled = false;
  const caught = {};
  for (const [n, sp] of Object.entries(SPECIES)) { caught[n] = fishMesh(sp); caught[n].visible = false; caught[n].rotation.order = 'YXZ'; scene.add(caught[n]); }
  rod.visible = float.visible = line.visible = false;
  scene.add(rod, float, line);

  // the fight meter (tension + how far it's come in), shown above the action button
  const meter = document.getElementById('fishMeter'), tensEl = document.getElementById('fmTension'), progEl = document.getElementById('fmProgress');

  let state = 'off', t = 0, biteAt = 0, nibbles = [], spot = null, catchName = null, catchCm = 0, water = 'sea', near = new Set();
  let hold = false, pull = 0, tension = 0, snapT = 0, surge = 0, surgeT = 0, fightT = 0, big = false, pose = null, clip = null;
  const anim = (name, loop = false, rate = 1) => { if (clip !== name) { clip = name; hero.play(name, { loop, rate }); } };
  const lo = new THREE.Vector3(), hi = new THREE.Vector3(), dir = new THREE.Vector3(), tip = new THREE.Vector3(), fp = new THREE.Vector3(), from = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const setState = (s) => { state = s; t = 0; onState && onState(s); };

  function findSpot() {
    if (P.swim || !P.grounded || sample(P.x, P.z).h < -0.3) return null;
    for (const da of [0, 0.35, -0.35, 0.7, -0.7]) {
      const a = P.face + da, sx = Math.sin(a), sz = Math.cos(a);
      for (let d = 2.5; d <= 8; d += 0.5) {
        const x = P.x + sx * d, z = P.z + sz * d, s = sample(x, z);
        if (s.h < -0.7) {
          const d2 = Math.min(8, d + 1.5), s2 = sample(P.x + sx * d2, P.z + sz * d2); // a little further out if still water
          return s2.h < -0.7 ? { x: P.x + sx * d2, z: P.z + sz * d2, river: !!s2.riv } : { x, z, river: !!s.riv };
        }
      }
    }
    return null;
  }

  /** the fish that can bite here and now, with their weights */
  function candidates() {
    const when = partOfDay(), wx = getWeather ? getWeather() : 'clear';
    return Object.entries(SPECIES).filter(([, s]) => (s.where[water] || 0) > 0
      && (!s.near || near.has(s.near)) && (!s.when || s.when.includes(when)) && (!s.weather || s.weather.includes(wx)));
  }
  function pick() {
    const opts = candidates();
    let r = Math.random() * opts.reduce((a, [, s]) => a + s.where[water], 0);
    for (const [n, s] of opts) { r -= s.where[water]; if (r <= 0) return n; }
    return opts[0][0];
  }

  function newWait(scale = 1) {
    const perk = progress.perks.bite, buff = progress.buff('bite').k;
    const w = (WAIT[0] + Math.random() * (WAIT[1] - WAIT[0])) * perk * (1 - buff) * scale;
    biteAt = t + w;
    nibbles = [];
    const n = Math.floor(Math.random() * 3); // 0–2 little nibbles before the real bite
    for (let i = 0; i < n; i++) nibbles.push(t + w * (0.25 + 0.6 * Math.random()));
  }

  function end() {
    setState('off');
    rod.visible = float.visible = line.visible = false;
    for (const m of Object.values(caught)) m.visible = false;
    meter.hidden = true; hold = false; pose = null;
    clip = null; hero.play(null);
  }

  function updateRod() {
    const fw = new THREE.Vector3(Math.sin(P.face), 0, Math.cos(P.face)), tl = hero.tool;
    if (tl) { hero.hand(tl.side, lo); dir.copy(tl.dir); }
    else { // between clips: along the hands, as before
      hero.hand('R', lo); hero.hand('L', hi);
      dir.copy(hi).sub(lo).normalize().multiplyScalar(1.2).addScaledVector(UP, 0.5).addScaledVector(fw, 0.35).normalize();
    }
    if (state === 'fight') dir.addScaledVector(fw, 0.3 + tension * 0.5).normalize(); // the rod bends toward the fish
    rod.position.copy(lo).addScaledVector(dir, -0.2);
    rod.quaternion.setFromUnitVectors(UP, dir);
    tip.copy(rod.position).addScaledVector(dir, ROD_LEN);
  }

  function drawLine(slack) {
    const len = tip.distanceTo(float.position);
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      fp.copy(tip).lerp(float.position, u);
      fp.y -= Math.sin(Math.PI * u) * len * 0.12 * slack;
      linePos.set([fp.x, fp.y, fp.z], i * 3);
    }
    lineGeo.attributes.position.needsUpdate = true;
  }

  function landed() {
    const sp = SPECIES[catchName], where = biome(sample(P.x, P.z));
    const log = progress.logCatch(catchName, catchCm, where);
    const kept = progress.addItem('fish_' + catchName, 1);
    progress.gain(sp.xp);
    const note = log.first ? 'New in your field guide!' : log.record ? `New record! Your best was ${log.prev} cm` : `+${sp.xp} XP`;
    progress.toast(sp.rarity === 'Rare' ? 'Rare catch!' : 'Catch!', `${sp.label} · ${catchCm} cm`, kept ? note : 'Bag full · you let it go');
    if (kept) onPickup && onPickup(`${sp.label} +1`);
    big = sp.rarity === 'Rare' || catchCm >= sp.cm[0] + (sp.cm[1] - sp.cm[0]) * 0.8 || catchCm >= 60;
    onCatch && onCatch({ species: catchName, cm: catchCm, big });
    setState(big ? 'trophy' : 'show');
    if (big) { clip = null; hero.play(null); rod.visible = float.visible = line.visible = false; }
  }

  return {
    get active() { return state !== 'off'; },
    /** 'cast' | 'wait' | 'bite' | 'fight' | 'reel' | 'show' | 'trophy' | 'off' */
    get state() { return state; },
    /** a body pose while holding up a big catch (else null: the mocap clips drive the body) */
    get pose() { return pose; },
    canFish() { return state === 'off' && !!findSpot(); },
    /** what could bite here right now (for the field guide's "biting now" hint) */
    bitingNow() { const s = findSpot(); if (!s) return []; water = s.river ? 'river' : 'sea'; near = surroundings(s.x, s.z); return candidates().map(([n]) => n); },
    start() {
      spot = findSpot();
      if (!spot) return false;
      water = spot.river ? 'river' : 'sea';
      near = surroundings(spot.x, spot.z);
      P.face = Math.atan2(spot.x - P.x, spot.z - P.z);
      P.vx = P.vz = 0;
      setState('cast');
      rod.visible = true;
      clip = null; anim('fishCast', false, 1.15);
      return true;
    },
    /** the action button: strike on a bite; during a nibble you spook it; otherwise wind in */
    reel() {
      if (state === 'bite') {
        catchName = pick();
        const c = SPECIES[catchName];
        catchCm = Math.round(c.cm[0] + Math.pow(Math.random(), 1.6) * (c.cm[1] - c.cm[0])); // big ones are scarcer
        if (c.fight || catchCm >= 45) { // a fighter: hold to reel
          setState('fight'); pull = 0.08; tension = 0.25; snapT = 0; surge = 0; surgeT = 1 + Math.random(); fightT = 0;
          meter.hidden = false;
          anim('fishFight', true);
          if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
          return;
        }
      } else if (state === 'wait' && nibbles.some((n) => Math.abs(t - n) < 0.45)) {
        progress.toast('Fishing', 'Too early!', 'It was only nibbling · wait for the float to go under');
        newWait(0.8);
        return;
      } else if (state === 'wait' || state === 'cast') {
        catchName = null;
      } else return;
      setState('reel');
      from.copy(float.position);
      anim(catchName ? 'fishCatch' : 'fishReel', !catchName, catchName ? 2.2 : 1.5);
    },
    /** holding the button during a fight reels in */
    setHold(on) { hold = on; },
    cancel() { if (state !== 'off' && state !== 'trophy') end(); },
    update(dt) {
      if (state === 'off') return;
      t += dt;
      const now = performance.now() / 1000;
      if (state !== 'trophy') updateRod();
      if (state === 'cast') {
        if (hero.clipTime < RELEASE_AT) { float.visible = line.visible = false; }
        else {
          const u = Math.min(1, (hero.clipTime - RELEASE_AT) / (FLIGHT * 1.3));
          float.visible = line.visible = true;
          float.position.set(tip.x + (spot.x - tip.x) * u, tip.y + (0.02 - tip.y) * u + Math.sin(Math.PI * u) * 1.6, tip.z + (spot.z - tip.z) * u);
          drawLine(0.3);
          if (u >= 1) {
            fx.splash(spot.x, 0.05, spot.z, 5);
            setState('wait'); newWait();
            anim('fishIdle', true);
          }
        }
      } else if (state === 'wait' || state === 'bite') {
        let y = 0.02 + Math.sin(now * 2.1) * 0.025;
        if (state === 'wait') {
          for (const n of nibbles) { const d = t - n; if (d > 0 && d < 0.35) y -= 0.05 * Math.sin((d / 0.35) * Math.PI); }
          if (nibbles.some((n) => t - n > 0 && t - n < dt * 1.5)) fx.splash(spot.x, 0.04, spot.z, 1);
          if (nibbles.some((n) => t - n > 0 && t - n < dt * 1.5)) anim('fishTug', false, 1.6);
          else if (clip === 'fishTug' && hero.clipDone) anim('fishIdle', true);
          if (t > biteAt) {
            setState('bite'); anim('fishBite', false, 1.3);
            fx.splash(spot.x, 0.05, spot.z, 6);
            if (navigator.vibrate) navigator.vibrate(120);
          }
        }
        if (state === 'bite') {
          y -= 0.22 * Math.min(1, t * 6) * (0.7 + 0.3 * Math.sin(t * 14)); // pulled right under
          if (t > STRIKE + progress.perks.strike) {
            progress.toast('Fishing', 'It got away…', 'Strike when the float goes under');
            setState('wait'); newWait(); anim('fishIdle', true);
          }
        }
        float.position.set(spot.x, y, spot.z);
        drawLine(1);
      } else if (state === 'fight') {
        fightT += dt;
        const sp = SPECIES[catchName], power = Math.max(0.35, sp.fight || 0.4);
        if ((surgeT -= dt) <= 0) { // the fish makes a run now and then
          surge = surge > 0 ? 0 : power;
          surgeT = surge ? 0.5 + Math.random() * 0.8 : 1.2 + Math.random() * 1.8;
          if (surge) fx.splash(float.position.x, 0.05, float.position.z, 4);
        }
        anim(hold && !surge ? 'fishReel' : 'fishFight', true, hold && !surge ? 1.3 : 1);
        if (hold) { pull += dt * 0.2 * (1 - surge * 0.6); tension += dt * (0.32 + surge * 1.0); }
        else { pull -= dt * (0.03 + surge * 0.08); tension -= dt * 0.75; }
        tension = Math.max(0, Math.min(1, tension)); pull = Math.max(0, Math.min(1, pull));
        snapT = tension >= 1 ? snapT + dt : 0;
        tensEl.style.width = tension * 100 + '%';
        tensEl.classList.toggle('hot', tension > 0.8);
        progEl.style.width = pull * 100 + '%';
        meter.classList.toggle('surge', surge > 0);
        // the float drags about on the surface
        float.position.set(spot.x + Math.sin(now * 3) * 0.3 * (1 - pull), 0.02 - 0.06 * surge, spot.z + Math.cos(now * 2.3) * 0.3 * (1 - pull));
        float.position.lerp(tip, pull * 0.55);
        float.position.y = Math.min(float.position.y, 0.05);
        drawLine(0.15 * (1 - tension));
        if (snapT > 0.45) {
          progress.toast('Fishing', 'The line snapped!', 'Ease off when the line goes red');
          if (navigator.vibrate) navigator.vibrate(200);
          end(); return;
        }
        if (pull <= 0 && fightT > 5) { progress.toast('Fishing', 'It got away…', 'Hold to reel, let go when it pulls hard'); end(); return; }
        if (pull >= 1) { meter.hidden = true; setState('reel'); from.copy(float.position); anim('fishCatch', false, 2.2); }
      } else if (state === 'reel') {
        const u = Math.min(1, t / 1.4), k = u * u * (3 - 2 * u);
        float.position.copy(from).lerp(tip, k);
        float.position.y = Math.max(float.position.y, 0.02 + Math.sin(Math.PI * k) * 0.6 * k);
        drawLine(1 - k);
        if (catchName) {
          const m = caught[catchName], sp = SPECIES[catchName], len = catchCm / 100 * 1.6;
          m.visible = true;
          if (sp.stretch) m.scale.set(len * sp.stretch[0], len * sp.stretch[1], len * sp.stretch[2]); else m.scale.setScalar(len);
          m.position.copy(float.position).add(new THREE.Vector3(0, -m.scale.z * 0.5, 0));
          m.rotation.set(-Math.PI / 2, P.face, Math.sin(now * 18) * 0.5); // hanging by the mouth, thrashing
        }
        if (u >= 1) { if (catchName) landed(); else { progress.toast('Fishing', 'Nothing this time', 'Cast again when you like'); end(); } }
      } else if (state === 'show') {
        const m = caught[catchName];
        m.position.copy(tip).add(new THREE.Vector3(0, -m.scale.z * 0.55, 0));
        m.rotation.z = Math.sin(now * 12) * 0.4 * Math.max(0, 1 - t);
        float.position.copy(tip);
        drawLine(0);
        if (t > 1.4) end();
      } else if (state === 'trophy') {
        // held up overhead in both hands, lying across them
        pose = trophyPose(t);
        const m = caught[catchName];
        hero.hand('R', lo); hero.hand('L', hi);
        m.position.copy(lo).add(hi).multiplyScalar(0.5); m.position.y += 0.08;
        m.rotation.set(0, P.face + Math.PI / 2, Math.sin(now * 9) * 0.15 * Math.max(0, 1 - t / 2));
        if (t > 2.8) end();
      }
    },
  };
}
