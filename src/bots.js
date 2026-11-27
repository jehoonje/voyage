// Bot explorers: a handful of computer-run hikers that wander the land around you, so the world
// never feels empty. Each has a random look and name (tagged BOT), and a simple routine: walk
// somewhere (now and then at a run), look around, stop for an emote, sit down for a rest, and turn
// to wave when you come close or wave at them. They stay on land and step around trees.
// Bots are local to each player (nobody else sees yours), and they're not counted as players nearby.
import * as THREE from 'three';
import { sample } from './world.js';
import { createCharacter, sanitize } from './character/character.js';
import { SKIN_TONES, HAIR_COLORS, IRIS_COLORS, GEAR_COLORS, EYES, HAIR, HATS, TOPS, BOTTOMS, SHOES } from './character/parts.js';
import { EMOTES } from './emotes.js';
import { WALK, RUN } from './physics.js';

const NAMES = ['Mina', 'Theo', 'Juno', 'Haru', 'Sol', 'Ari', 'Noa', 'Kai', 'Yuna', 'Leo', 'Rin', 'Eli', 'Dami', 'Sora', 'Ivy', 'Bao', 'Lumi', 'Oto', 'Remy', 'Nami'];
const SPAWN = [12, 50], KEEP = 260, SHOW = 110, GREET = 7;

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const keys = (o) => Object.keys(o);
const chance = (p) => Math.random() < p;

/** a random, coherent outfit */
function randomLook() {
  const top = pick(keys(TOPS)), bottom = pick(keys(BOTTOMS)), shoes = pick(keys(SHOES)), hat = pick(keys(HATS));
  const acc = {};
  const bag = pick(['daypack', 'bigpack', 'campack', 'sling', null]);
  if (bag) acc[bag] = { c: bag === 'campack' ? 0xffffff : pick(GEAR_COLORS), c2: 0x1c1e20 };
  if (chance(0.35)) acc.phones = { c: pick([0x1c1c1e, 0xe8e4da, 0x2c4e78]) };
  if (chance(0.2)) acc[pick(['socks', 'longsocks'])] = { c: pick(GEAR_COLORS) };
  if (chance(0.15)) acc.gloves = { c: pick(GEAR_COLORS) };
  return sanitize({
    skin: pick(SKIN_TONES), eyes: pick(keys(EYES)), iris: pick(IRIS_COLORS), freckles: chance(0.25),
    hair: pick(keys(HAIR)), hairColor: pick(HAIR_COLORS),
    hat, hatColor: HATS[hat].tex ? 0xffffff : pick(GEAR_COLORS),
    top, topColor: chance(0.5) ? TOPS[top].c : pick(GEAR_COLORS), topAccent: TOPS[top].accent,
    bottom, bottomColor: BOTTOMS[bottom].tex ? 0xffffff : chance(0.5) ? BOTTOMS[bottom].c : pick(GEAR_COLORS),
    shoes, shoesColor: SHOES[shoes].c, soleColor: SHOES[shoes].sole,
    acc,
  });
}

/** solid, not too steep ground a bot can stand on */
function walkable(x, z) {
  const h = sample(x, z).h;
  if (h < 0.25) return false; // water and wet sand
  const dx = sample(x + 1, z).h - h, dz = sample(x, z + 1).h - h;
  return Math.hypot(dx, dz) < 0.7;
}

export function createBots({ scene, camera, world, count = 5 }) {
  const bots = [], labels = document.getElementById('names'), tmpV = new THREE.Vector3();
  let started = false;

  function place(b, px, pz) {
    for (let k = 0; k < 30; k++) {
      const a = Math.random() * Math.PI * 2, r = SPAWN[0] + Math.random() * (SPAWN[1] - SPAWN[0]);
      const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
      if (!walkable(x, z) || world.nearestTree(x, z, 1.2)) continue;
      b.P.x = x; b.P.z = z; b.P.y = sample(x, z).h; b.P.face = Math.random() * Math.PI * 2;
      b.state = 'idle'; b.t = 1 + Math.random() * 3; b.speed = 0;
      return true;
    }
    return false;
  }

  function make(px, pz) {
    const char = createCharacter(scene);
    char.root.visible = false;
    char.apply(randomLook()).catch(() => {});
    const name = pick(NAMES.filter((n) => !bots.some((b) => b.name === n)));
    const label = document.createElement('div');
    label.className = 'name bot'; label.hidden = true;
    label.innerHTML = '<span></span><i>BOT</i>';
    label.firstChild.textContent = name;
    labels.appendChild(label);
    const b = { char, name, label, P: { x: 0, y: 0, z: 0, face: 0, grounded: true, swim: false, land: 0, vy: 0 },
      state: 'idle', t: 0, tx: 0, tz: 0, speed: 0, run: false, emote: null, emoteT: 0, greeted: -99, sitFor: 0 };
    place(b, px, pz);
    bots.push(b);
  }

  /** pick what to do next */
  function next(b) {
    const r = Math.random();
    b.emote = null;
    if (r < 0.55) { // walk somewhere
      for (let k = 0; k < 12; k++) {
        const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * 35;
        const x = b.P.x + Math.cos(a) * d, z = b.P.z + Math.sin(a) * d;
        if (walkable(x, z)) { b.state = 'walk'; b.tx = x; b.tz = z; b.run = d > 25 && chance(0.3); b.t = 25; return; }
      }
      b.state = 'idle'; b.t = 2;
    } else if (r < 0.8) { b.state = 'idle'; b.t = 2 + Math.random() * 5; }
    else if (r < 0.92) { emote(b, pick(['wave', 'cheer', 'clap'])); }
    else { emote(b, 'sit'); b.sitFor = 8 + Math.random() * 14; }
  }

  function emote(b, k) { b.state = 'emote'; b.emote = k; b.emoteT = 0; b.t = EMOTES[k].dur || b.sitFor || 10; }

  function turnTo(b, x, z, dt, rate = 5) {
    const want = Math.atan2(x - b.P.x, z - b.P.z);
    let d = want - b.P.face; d = Math.atan2(Math.sin(d), Math.cos(d));
    b.P.face += d * Math.min(1, dt * rate);
    return Math.abs(d);
  }

  return {
    get list() { return bots; },
    start(P) {
      if (started) return;
      started = true;
      for (let i = 0; i < count; i++) make(P.x, P.z);
    },
    /** you waved: bots close by wave back */
    react(name, P) {
      if (name !== 'wave' && name !== 'cheer') return;
      for (const b of bots) {
        const d = Math.hypot(b.P.x - P.x, b.P.z - P.z);
        if (d < 14 && b.state !== 'emote') { b.state = 'greet'; b.t = 0.4 + Math.random() * 0.5; b.reply = name; }
      }
    },
    update(dt, P) {
      if (!started) return;
      const w = innerWidth, h = innerHeight;
      for (const b of bots) {
        const dp = Math.hypot(b.P.x - P.x, b.P.z - P.z);
        if (dp > KEEP) { place(b, P.x, P.z); continue; } // left far behind: wander back in from somewhere else
        b.t -= dt;
        let pose = null, speed = 0;
        // you came close: turn and wave (once in a while, not every time)
        if (dp < GREET && b.state !== 'emote' && b.state !== 'greet' && performance.now() / 1000 - b.greeted > 40) {
          b.greeted = performance.now() / 1000; b.state = 'greet'; b.t = 0.5; b.reply = 'wave';
        }
        if (b.state === 'walk') {
          const dx = b.tx - b.P.x, dz = b.tz - b.P.z, dist = Math.hypot(dx, dz);
          const off = turnTo(b, b.tx, b.tz, dt);
          speed = (b.run ? RUN : WALK) * (off > 0.8 ? 0.3 : 1) * 0.9;
          const nx = b.P.x + Math.sin(b.P.face) * speed * dt, nz = b.P.z + Math.cos(b.P.face) * speed * dt;
          const ax = b.P.x + Math.sin(b.P.face) * 1.2, az = b.P.z + Math.cos(b.P.face) * 1.2;
          if (!walkable(ax, az) || world.nearestTree(ax, az, 0.7)) { b.state = 'idle'; b.t = 0.5 + Math.random(); speed = 0; } // water, a cliff or a tree ahead
          else { b.P.x = nx; b.P.z = nz; }
          if (dist < 1.2 || b.t <= 0) next(b);
        } else if (b.state === 'greet') {
          turnTo(b, P.x, P.z, dt, 6);
          if (b.t <= 0) emote(b, b.reply || 'wave');
        } else if (b.state === 'emote') {
          b.emoteT += dt;
          pose = EMOTES[b.emote].pose(b.emoteT);
          if (b.t <= 0) next(b);
        } else if (b.t <= 0) next(b);
        b.speed += (speed - b.speed) * Math.min(1, dt * 8);
        b.P.y = sample(b.P.x, b.P.z).h;

        // draw nearby bots only
        const vis = dp < SHOW && b.char.ready;
        b.char.root.visible = vis;
        if (!vis) { b.label.hidden = true; continue; }
        b.char.animate(dt, b.P, b.speed, pose);
        tmpV.set(b.P.x, b.P.y + 2.05, b.P.z).project(camera);
        if (tmpV.z > 1 || dp > 60) { b.label.hidden = true; continue; }
        b.label.hidden = false;
        b.label.style.transform = `translate(${((tmpV.x + 1) / 2) * w}px, ${((1 - tmpV.y) / 2) * h}px) translate(-50%, -100%)`;
        b.label.style.opacity = String(Math.max(0.35, 1 - dp / 60));
      }
    },
  };
}
