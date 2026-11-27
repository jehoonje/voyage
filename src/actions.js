// Timed hero actions:
//  · camp: make one (6 wood: place logs → light → sit), sit by any lit fire, relight your own cold camp
//    (2 wood); standing up leaves it burning until its time runs out; you can also put yours out
//  · signs: kneel and hammer a short sign into the ground (3 wood)
//  · chopping a tree (three swings → fall → gone, regrows later)
import { sample } from './world.js';
import { felled, poseTree, RESPAWN_MS } from './forestry.js';
import { serverNow } from './clock.js';

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const STAND = { drop: 0, back: 0, lean: 0, twist: 0, legL: 0, legR: 0, kneeL: 0.04, kneeR: 0.04, armLX: 0, armRX: 0, armLZ: -0.06, armRZ: 0.06, elbowL: -0.2, elbowR: -0.2 };
// one knee up, the other on the ground behind
const KNEEL = { ...STAND, drop: -0.45, lean: 0.4, legL: -1.4, kneeL: 1.45, legR: 0.25, kneeR: 1.3, armLX: -0.9, armRX: -0.9, elbowL: -0.4, elbowR: -0.4 };
// sitting on the ground, knees drawn up, hands out toward the fire
const SIT = { ...STAND, drop: -0.76, back: -0.3, lean: -0.1, legL: -2.0, legR: -1.9, kneeL: 1.5, kneeR: 1.45, armLX: -0.9, armRX: -0.9, armLZ: 0.1, armRZ: -0.1, elbowL: -0.55, elbowR: -0.55 };
const FIRE_DIST = 1.35, SWING = 0.85, SWINGS = 3, SIT_REACH = 3;
export const CAMP_COST = 6, RELIGHT_COST = 2, SIGN_COST = 3, BURN_MIN = 15;

export function createActions({ P, fires, fx, progress, onPickup, onCamp, onSign }) {
  let kind = null, phase = '', t = 0, fire = null, tree = null, swings = 0, hit = false, wobT = 9;
  let dir = [0, 1], th = 0, om = 0, bounced = false, settled = 0;
  const pose = { ...STAND, axe: false };
  const set = (base, over) => Object.assign(pose, base, { axe: false }, over);

  /** what the Camp action would do here: 'sit' | 'relight' | 'theirs' | 'make' */
  function campOption() {
    const f = fires.nearest(P.x, P.z, SIT_REACH);
    if (!f) return { kind: 'make' };
    if (fires.isLit(f)) return { kind: 'sit', fire: f };
    return { kind: f.mine ? 'relight' : 'theirs', fire: f };
  }

  /** move to a seat by the fire, facing it */
  function seat(f) {
    let dx = P.x - f.x, dz = P.z - f.z; const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    P.x = f.x + dx * FIRE_DIST; P.z = f.z + dz * FIRE_DIST;
    P.face = Math.atan2(-dx, -dz); P.vx = P.vz = 0;
  }

  function pay(n, what) {
    const have = progress.count('wood');
    if (!progress.takeItem('wood', n)) { progress.toast(what, 'Not enough wood', `${have} / ${n} · chop trees to gather more`); return false; }
    onPickup && onPickup(`Wood −${n}`);
    return true;
  }

  function startCamp() {
    if (kind) return false;
    if (P.swim || !P.grounded) { progress.toast('Camp', "Can't light a fire here", 'Try on solid ground'); return false; }
    const opt = campOption();
    if (opt.kind === 'sit') { fire = opt.fire; seat(fire); kind = 'camp'; phase = 'sit'; t = 0; return true; }
    if (opt.kind === 'theirs') { progress.toast('Camp', `${opt.fire.ownerName || 'Someone'}'s old camp`, 'Make your own a few steps away'); return false; }
    if (opt.kind === 'relight') {
      if (!pay(RELIGHT_COST, 'Camp')) return false;
      fire = opt.fire; seat(fire); kind = 'camp'; phase = 'ignite'; t = 0; fire.relit = true;
      return true;
    }
    const x = P.x + Math.sin(P.face) * FIRE_DIST, z = P.z + Math.cos(P.face) * FIRE_DIST, h = sample(x, z).h;
    if (h < 0.2) { progress.toast('Camp', "Can't light a fire here", 'Move a little away from the water'); return false; }
    if (!pay(CAMP_COST, 'Camp')) return false;
    fire = fires.spawn(x, h, z, { mine: true, ownerName: progress.state.name });
    kind = 'camp'; phase = 'place'; t = 0;
    return true;
  }

  /** stand up and leave the fire burning */
  function endCamp() { if (kind === 'camp' && phase === 'sit') { phase = 'rise'; t = 0; } }
  /** put your own fire out, then stand */
  function douseCamp() { if (kind === 'camp' && phase === 'sit' && fire && fire.mine) { phase = 'douse'; t = 0; } }

  let signText = '';
  function startSign(text) {
    if (kind) return false;
    if (P.swim || !P.grounded) { progress.toast('Sign', "Can't put a sign here", 'Try on solid ground'); return false; }
    const x = P.x + Math.sin(P.face) * 1.1, z = P.z + Math.cos(P.face) * 1.1;
    if (sample(x, z).h < 0.1) { progress.toast('Sign', "Can't put a sign here", 'Move away from the water'); return false; }
    if (!pay(SIGN_COST, 'Sign')) return false;
    signText = text; kind = 'sign'; phase = 'hammer'; t = 0;
    return true;
  }
  function signStep() {
    const r = Math.abs(Math.sin(t * 9));
    set(KNEEL, { armRX: -1.6 + r * 0.9, armLX: -0.9, elbowR: -0.6 });
    if (t > 1.6) {
      const x = P.x + Math.sin(P.face) * 1.1, z = P.z + Math.cos(P.face) * 1.1;
      onSign && onSign({ x, y: sample(x, z).h, z, face: P.face + Math.PI, text: signText });
      fx.chips(x, sample(x, z).h + 0.1, z, 4, sample(x, z).h);
      kind = null; return null;
    }
    return pose;
  }

  function startChop(tr) {
    if (kind || !tr || tr.hidden) return;
    const dx = tr.x - P.x, dz = tr.z - P.z, l = Math.hypot(dx, dz) || 1;
    dir = [dx / l, dz / l];
    P.face = Math.atan2(dx, dz);
    tree = tr; tree.busy = true;
    kind = 'chop'; phase = 'swing'; t = 0; swings = 0; hit = false; wobT = 9;
  }

  function campStep(dt) {
    if (phase === 'place') {
      fires.setLogs(fire, ease((t - 0.5) / 0.8));
      const r = Math.sin(t * 5) * 0.25;
      set(KNEEL, { armLX: -1.05 + r, armRX: -1.05 - r });
      if (t > 1.6) { phase = 'ignite'; t = 0; }
    } else if (phase === 'ignite') {
      const r = Math.sin(t * 24) * 0.16;
      set(KNEEL, { armLX: -1.2 + r, armRX: -1.2 - r, armLZ: 0.25, armRZ: -0.25 });
      if (t > 0.4 && t < 1.6) fires.strike(fire);
      if (fire.relit && t > 1.1 && fire.state === 'cold') fires.relight(fire, serverNow() + BURN_MIN * 60000);
      fires.setLevel(fire, ease((t - 1.1) / 1.4));
      if (t > 2.7) {
        phase = 'sit'; t = 0;
        fire.litUntil = serverNow() + BURN_MIN * 60000;
        progress.toast('Camp', fire.relit ? 'Fire relit' : 'Campfire lit', `Burns ${BURN_MIN} min · cook fish, rest, or travel to your other camps`);
        if (!fire.relit) progress.gain(10);
        onCamp && onCamp(fire, fire.relit ? 'relit' : 'made');
        fire.relit = false;
      }
    } else if (phase === 'sit') {
      const w = Math.sin(t * 1.6) * 0.1;
      set(SIT, { armLX: -0.95 + w, armRX: -0.95 - w });
    } else if (phase === 'douse') {
      set(KNEEL, { armLX: -1.25 + Math.abs(Math.sin(t * 9)) * 0.45, armRX: -1.25 + Math.abs(Math.cos(t * 9)) * 0.45 });
      if (t > 0.35 && fire.state !== 'dousing' && fire.state !== 'cold') { fires.douse(fire); onCamp && onCamp(fire, 'doused'); }
      if (t > 1.9) { phase = 'rise'; t = 0; }
    } else if (phase === 'rise') {
      set(STAND);
      if (t > 0.7) { kind = null; fire = null; return null; }
    }
    return pose;
  }

  function chopStep(dt, now) {
    wobT += dt;
    if (phase === 'swing') {
      const tt = t - swings * SWING;
      let a, tw;
      if (tt < 0.45) { a = -0.3 - 2.4 * ease(tt / 0.45); tw = 0.35 * ease(tt / 0.45); }
      else if (tt < 0.6) { a = -2.7 + 1.45 * ease((tt - 0.45) / 0.15); tw = 0.35 * (1 - ease((tt - 0.45) / 0.15)); }
      else { a = -1.25 + 0.85 * ease((tt - 0.6) / 0.25); tw = 0; }
      set(STAND, { armRX: a, armLX: a + 0.15, armLZ: 0.35, armRZ: -0.1, elbowL: -0.35, elbowR: -0.15, twist: tw, lean: tt > 0.45 && tt < 0.75 ? 0.22 : 0.05, legL: -0.3, kneeL: 0.25, legR: 0.25, kneeR: 0.2, axe: true });
      if (tt >= 0.56 && !hit) {
        hit = true; wobT = 0;
        fx.chips(tree.x - dir[0] * 0.4, tree.y + 0.9, tree.z - dir[1] * 0.4, 7, tree.y + 0.05);
      }
      poseTree(tree, 0.07 * Math.exp(-wobT * 5) * Math.sin(wobT * 28), dir[0], dir[1]);
      if (tt >= SWING) {
        swings++; hit = false;
        if (swings >= SWINGS) { phase = 'fall'; t = 0; th = 0.08; om = 0.2; bounced = false; settled = 0; }
      }
    } else if (phase === 'fall') {
      set(STAND, { armRX: -0.45, armLX: -0.3, axe: true });
      // rod pivoting on its base: θ'' = 3g/(2L)·sin θ
      const L = 7 * tree.sc;
      if (!settled) {
        om += ((3 * 9.8) / (2 * L)) * Math.sin(th) * dt;
        th += om * dt;
        if (th >= 1.45) {
          th = 1.45;
          if (!bounced && om > 0.6) { om = -om * 0.22; bounced = true; } else { om = 0; settled = t; }
        }
      }
      poseTree(tree, th, dir[0], dir[1]);
      if (th >= 1.45 && !hit) {
        hit = true;
        const reach = 3.5 * tree.sc;
        fx.chips(tree.x + dir[0] * reach, tree.y + 0.3, tree.z + dir[1] * reach, 8, tree.y);
        fx.smoke(tree.x + dir[0] * reach, tree.y + 0.1, tree.z + dir[1] * reach, 4);
      }
      if (settled && t > settled + 0.4) {
        poseTree(tree, 0, 0, 1, 0);
        tree.hidden = true; tree.busy = false;
        felled.set(tree.key, now + RESPAWN_MS);
        const got = 1 + Math.floor(Math.random() * progress.perks.woodMax); // 1–3 pieces (1–4 once you've found a forest)
        progress.addItem('wood', got);
        onPickup && onPickup(`Wood +${got}`);
        progress.gain(5);
        kind = null; tree = null;
        return null;
      }
    }
    return pose;
  }

  return {
    get busy() { return !!kind; },
    get sitting() { return kind === 'camp' && phase === 'sit'; },
    /** the fire you're sitting at (or building) */
    get fire() { return kind === 'camp' ? fire : null; },
    campOption, startCamp, endCamp, douseCamp, startChop, startSign,
    /** leave a fire without the stand-up animation (travelling away) */
    leave() { kind = null; fire = null; },
    /** advance; returns the pose to show, or null for free movement */
    update(dt, now) {
      if (!kind) return null;
      t += dt;
      return kind === 'camp' ? campStep(dt) : kind === 'sign' ? signStep() : chopStep(dt, now);
    },
  };
}
