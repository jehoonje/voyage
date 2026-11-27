// Realtime: see the players near you. The world is split into 512 m cells, each a broadcast channel.
// You publish to the cell you stand in and listen to the 2×2 block of cells nearest you, so anyone
// within ~256 m is always in view, and nobody far away costs anything.
//
// Messages (all small, all validated on arrival — they come from other players' browsers):
//   st   position, facing, speed and what you're doing (sitting, fishing, emote), ~4/s while moving
//   hi   name + character look (on joining a cell, every 10 s, and when someone asks "who")
//   who  "I see you but don't know your look"
//   ev   one-offs: an emote, a catch, a fire or a sign appearing, a fire going out
//
// Transports: Supabase Realtime broadcast, or (testing, ?net=local) BroadcastChannel between tabs.
import * as THREE from 'three';
import { supabase } from './supabase.js';
import { createCharacter, sanitize } from './character/character.js';
import { DEFAULT_SPEC } from './character/parts.js';
import { EMOTES, trophyPose, createEmoteDriver } from './emotes.js';
import { SPECIES } from './fishing.js';

const CELL = 512, SEND_MOVING = 0.25, SEND_IDLE = 3, HELLO_EVERY = 10, FORGET_AFTER = 15, MAX_AVATARS = 12, DELAY = 0.22;
const LOOK_KEYS = Object.keys(DEFAULT_SPEC);

const num = (v, lim = 1e6) => (typeof v === 'number' && isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);
export const cleanName = (n) => (typeof n === 'string' ? n.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16) : '') || 'Explorer';
function cleanLook(l) {
  if (!l || typeof l !== 'object') return null;
  const o = {};
  for (const k of LOOK_KEYS) if (k in l) o[k] = l[k];
  try { return sanitize(o); } catch { return null; }
}

function supabaseTransport() {
  return {
    join(name, onMsg) {
      const ch = supabase.channel(name, { config: { broadcast: { self: false, ack: false } } });
      ch.on('broadcast', { event: 'm' }, ({ payload }) => onMsg(payload));
      ch.subscribe();
      return {
        send(m) { ch.send({ type: 'broadcast', event: 'm', payload: m }).catch(() => {}); },
        leave() { supabase.removeChannel(ch); },
      };
    },
  };
}
function localTransport() {
  return {
    join(name, onMsg) {
      const bc = new BroadcastChannel('voyage-' + name);
      bc.onmessage = (e) => onMsg(e.data);
      return { send(m) { bc.postMessage(m); }, leave() { bc.close(); } };
    },
  };
}

export function createNet({ scene, camera, local = false, onEvent }) {
  const transport = local ? localTransport() : supabaseTransport();
  const me = { id: null, name: 'Explorer', look: null };
  const joined = new Map(); // cell key → channel
  const peers = new Map();
  // timers run on the wall clock (not frame time, which is capped when frames are slow)
  let home = null, sendAt = 0, helloAt = 0, lastSig = '', whoT = 0, enabled = false;
  const labels = document.getElementById('names');

  const cellOf = (x, z) => [Math.floor(x / CELL), Math.floor(z / CELL)];
  function wanted(x, z) {
    const [i, j] = cellOf(x, z), fx = x / CELL - i, fz = z / CELL - j;
    const di = fx < 0.5 ? -1 : 1, dj = fz < 0.5 ? -1 : 1;
    return [[i, j], [i + di, j], [i, j + dj], [i + di, j + dj]].map(([a, b]) => a + ':' + b);
  }
  function send(m) { if (home && joined.has(home)) joined.get(home).send({ ...m, i: me.id }); }
  const hello = () => send({ t: 'hi', n: me.name, l: me.look });

  function updateCells(x, z) {
    const want = new Set(wanted(x, z));
    for (const [k, ch] of joined) if (!want.has(k)) { ch.leave(); joined.delete(k); }
    let fresh = false;
    for (const k of want) if (!joined.has(k)) { joined.set(k, transport.join('cell:' + k, receive)); fresh = true; }
    const [i, j] = cellOf(x, z), h = i + ':' + j;
    if (h !== home || fresh) { home = h; setTimeout(hello, 400); } // say hello once the channels are up
  }

  function peer(id) {
    let p = peers.get(id);
    if (!p) {
      p = { id, name: 'Explorer', look: null, char: null, em: null, want: '', buf: [], heard: 0, trophy: 0, label: null, P: { x: 0, y: 0, z: 0, face: 0, grounded: true, swim: false, land: 0, vy: 0 } };
      p.label = document.createElement('div'); p.label.className = 'name'; p.label.textContent = p.name; p.label.hidden = true; labels.appendChild(p.label);
      peers.set(id, p);
    }
    return p;
  }
  function drop(p) {
    if (p.char) p.char.dispose();
    p.label.remove();
    peers.delete(p.id);
  }

  function receive(m) {
    if (!m || typeof m.i !== 'string' || m.i === me.id || m.i.length > 64) return;
    const p = peer(m.i), now = performance.now() / 1000;
    p.heard = now;
    if (m.t === 'st') {
      const s = { at: now, x: num(m.x), y: num(m.y, 2000), z: num(m.z), f: num(m.f, 10), v: Math.min(12, Math.abs(num(m.v))), sw: !!m.sw, si: !!m.si, fi: !!m.fi, g: m.g !== false };
      p.buf.push(s); if (p.buf.length > 12) p.buf.shift();
      if (!p.look && now - whoT > 2) { whoT = now; send({ t: 'who' }); }
    } else if (m.t === 'hi') {
      p.name = cleanName(m.n); p.label.textContent = p.name;
      const look = cleanLook(m.l);
      if (look && JSON.stringify(look) !== JSON.stringify(p.look)) {
        p.look = look;
        if (!p.char) { p.char = createCharacter(scene); p.char.root.visible = false; p.em = createEmoteDriver(p.char); }
        p.char.apply(look).catch(() => {});
      }
    } else if (m.t === 'who') {
      helloAt = Math.min(helloAt, now + 0.3); // answer soon (several askers share one reply)
    } else if (m.t === 'ev') {
      const e = m.e;
      if (e === 'emote' && EMOTES[m.k]) { if (p.em) { p.em.play(m.k); p.want = 'emote'; } }
      else if (e === 'emote' && m.k === null) { if (p.em) p.em.stop(); }
      else if (e === 'catch' && SPECIES[m.sp]) {
        const cm = Math.round(Math.max(1, Math.min(200, num(m.cm))));
        if (m.big) p.trophy = 0.001;
        p.say = `${SPECIES[m.sp].label} · ${cm} cm${m.big ? '!' : ''}`; p.sayT = 4;
        onEvent && onEvent({ type: 'catch', name: p.name, species: m.sp, cm, big: !!m.big, near: true });
      } else if (e === 'fire' || e === 'fireOut' || e === 'sign' || e === 'signGone') {
        onEvent && onEvent({ ...m, type: e, by: p.name });
      }
    }
  }

  const tmpV = new THREE.Vector3();
  /** interpolated state of a peer at render time */
  function sampleAt(p, t) {
    const b = p.buf;
    if (!b.length) return null;
    if (t <= b[0].at) return b[0];
    for (let k = b.length - 1; k > 0; k--) {
      const a = b[k - 1], c = b[k];
      if (t >= a.at && t <= c.at) {
        const u = (t - a.at) / Math.max(1e-3, c.at - a.at);
        let df = c.f - a.f; df = Math.atan2(Math.sin(df), Math.cos(df));
        return { ...c, x: a.x + (c.x - a.x) * u, y: a.y + (c.y - a.y) * u, z: a.z + (c.z - a.z) * u, f: a.f + df * u, v: a.v + (c.v - a.v) * u };
      }
    }
    // past the newest: hold it (a little dead reckoning would overshoot when they stop)
    return b[b.length - 1];
  }

  return {
    get count() { let n = 0; for (const p of peers.values()) if (p.char && p.char.root.visible) n++; return n; },
    get peers() { return peers; },
    /** testing aid */
    debug() { return [...peers.values()].map((p) => ({ id: p.id, name: p.name, look: !!p.look, char: !!p.char, ready: p.char ? p.char.ready : false, buf: p.buf.length, vis: p.char ? p.char.root.visible : false })); },
    /** who you are to others; call again when your name or look changes */
    setMe({ id, name, look }) {
      if (id) me.id = id;
      if (name) me.name = cleanName(name);
      if (look) me.look = look;
      if (enabled) hello();
    },
    start() { enabled = true; },
    stop() { enabled = false; for (const ch of joined.values()) ch.leave(); joined.clear(); home = null; for (const p of [...peers.values()]) drop(p); },
    /** a one-off event to the players around you */
    event(e, data = {}) { if (enabled) send({ t: 'ev', e, ...data }); },
    /** s: { x, y, z, face, speed, swim, grounded, sitting, fishing } */
    update(dt, s) {
      if (!enabled || !me.id) return;
      updateCells(s.x, s.z);
      // send my state: often while it changes, now and then while still
      const wall = performance.now() / 1000;
      const sig = `${s.x.toFixed(1)},${s.z.toFixed(1)},${s.face.toFixed(2)},${s.swim},${s.sitting},${s.fishing}`;
      if ((sig !== lastSig && wall >= sendAt) || wall >= sendAt + SEND_IDLE) {
        lastSig = sig; sendAt = wall + SEND_MOVING;
        send({ t: 'st', x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2), f: +s.face.toFixed(3), v: +s.speed.toFixed(2), sw: s.swim, si: s.sitting, fi: s.fishing, g: s.grounded });
      }
      if (wall >= helloAt) { helloAt = wall + HELLO_EVERY; hello(); }

      // draw the players around me
      const now = performance.now() / 1000, rt = now - DELAY;
      const near = [...peers.values()].filter((p) => p.char && p.buf.length)
        .map((p) => { const q = p.buf[p.buf.length - 1]; return [p, (q.x - s.x) ** 2 + (q.z - s.z) ** 2]; })
        .sort((a, b) => a[1] - b[1]);
      const shown = new Set(near.slice(0, MAX_AVATARS).map(([p]) => p));
      const w = innerWidth, h = innerHeight;
      for (const p of [...peers.values()]) {
        if (now - p.heard > FORGET_AFTER) { drop(p); continue; }
        const vis = shown.has(p) && p.char.ready;
        if (p.char) p.char.root.visible = vis;
        if (!vis) { p.label.hidden = true; continue; }
        const q = sampleAt(p, rt);
        Object.assign(p.P, { x: q.x, y: q.y, z: q.z, face: q.f, swim: q.sw, grounded: q.g });
        // what the body is doing: a trophy, an emote, sitting by a fire, fishing, or walking about
        let pose = null, want;
        if (q.v >= 0.3) p.em.stop();
        if (p.trophy > 0) { p.trophy += dt; pose = trophyPose(p.trophy); want = '-'; if (p.trophy > 2.8) p.trophy = 0; }
        else if (p.em.current) { pose = p.em.update(dt); want = 'emote'; }
        else want = q.si ? 'sitIdle' : q.fi ? 'fishIdle' : '-';
        if (want !== p.want) { p.want = want; if (want !== 'emote') p.char.play(want === '-' ? null : want, { loop: true }); }
        p.char.animate(dt, p.P, q.v, pose);
        // name tag (and what they just caught) above the head
        tmpV.set(q.x, q.y + 2.05, q.z).project(camera);
        const dist = Math.sqrt((q.x - s.x) ** 2 + (q.z - s.z) ** 2);
        if (tmpV.z > 1 || dist > 70) { p.label.hidden = true; }
        else {
          p.label.hidden = false;
          if (p.sayT > 0) { p.sayT -= dt; p.label.textContent = `${p.name} · ${p.say}`; p.label.classList.add('say'); }
          else if (p.label.classList.contains('say')) { p.label.textContent = p.name; p.label.classList.remove('say'); }
          p.label.style.transform = `translate(${((tmpV.x + 1) / 2) * w}px, ${((1 - tmpV.y) / 2) * h}px) translate(-50%, -100%)`;
          p.label.style.opacity = String(Math.max(0.35, 1 - dist / 70));
        }
      }
    },
  };
}
