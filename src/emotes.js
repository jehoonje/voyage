// Emotes (keys 1–4 or the Emote menu): wave, cheer and sit are KayKit clips (CC0); clap and the trophy pose
// (a big catch held overhead) are hand-made poses on the same channels as actions.js. Other players see them via net.js.
const STAND = { drop: 0, back: 0, lean: 0, twist: 0, legL: 0, legR: 0, kneeL: 0.04, kneeR: 0.04, armLX: 0, armRX: 0, armLZ: -0.06, armRZ: 0.06, elbowL: -0.2, elbowR: -0.2 };
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * each emote: a KayKit clip (once, looped, or a lead-in then a loop) or, for clap, a hand-made pose.
 * dur: how long it lasts (0 = until you move)
 */
export const EMOTES = {
  wave: { label: 'Wave', key: 'Digit1', clip: 'wave', dur: 2.1 },
  cheer: { label: 'Cheer', key: 'Digit2', clip: 'cheer', loop: true, dur: 3.3 },
  sit: { label: 'Sit', key: 'Digit3', clip: 'sitDown', then: 'sitIdle', dur: 0 },
  clap: {
    label: 'Clap', key: 'Digit4', dur: 2.2,
    pose: (t) => {
      const up = ease(t / 0.3) * ease((2.2 - t) / 0.3), c = Math.max(0, Math.sin(t * 16)) * 0.32;
      return { ...STAND, armLX: -1.3 * up, armRX: -1.3 * up, armLZ: (0.55 - c) * up, armRZ: (-0.55 + c) * up, elbowL: -1.0 * up, elbowR: -1.0 * up, headX: -0.08 * up };
    },
  },
};

/** plays emotes on a character (yours or another player's) */
export function createEmoteDriver(char) {
  let cur = null, t = 0, stage = 0;
  const api = {
    get current() { return cur; },
    play(name) {
      const e = EMOTES[name]; if (!e) return;
      cur = name; t = 0; stage = 0;
      char.play(e.clip || null, { loop: !!e.loop });
    },
    stop() {
      if (!cur) return;
      const e = EMOTES[cur]; cur = null;
      if (e.clip) char.play(null);
    },
    /** pose for this frame (hand-made emotes), else null */
    update(dt) {
      if (!cur) return null;
      t += dt;
      const e = EMOTES[cur];
      if (e.then && stage === 0 && char.clipDone) { stage = 1; char.play(e.then, { loop: true }); }
      if (e.dur && t >= e.dur) { api.stop(); return null; }
      return e.pose ? e.pose(t) : null;
    },
  };
  return api;
}

/** both hands overhead holding a fish up, bouncing a little */
export function trophyPose(t) {
  const up = ease(t / 0.4), b = Math.abs(Math.sin(t * 5.5));
  return { ...STAND, drop: -0.08 * b, kneeL: 0.04 + 0.2 * b, kneeR: 0.04 + 0.2 * b,
    armLX: -2.85 * up, armRX: -2.85 * up, armLZ: 0.12 * up, armRZ: -0.12 * up, elbowL: -0.45 * up, elbowR: -0.45 * up, lean: -0.14 * up, headX: -0.25 * up };
}

/** sitting by a fire (also used for other players sitting at one) */
export const FIRE_SIT = { ...STAND, drop: -0.76, back: -0.3, lean: -0.1, legL: -2.0, legR: -1.9, kneeL: 1.5, kneeR: 1.45, armLX: -0.9, armRX: -0.9, armLZ: 0.1, armRZ: -0.1, elbowL: -0.55, elbowR: -0.55 };

/** the player's own emotes, told to the players around */
export function createEmotes({ hero, onEmote }) {
  const d = createEmoteDriver(hero);
  return {
    get current() { return d.current; },
    play(name) { if (!EMOTES[name]) return; d.play(name); onEmote && onEmote(name); },
    stop() { if (d.current) { d.stop(); onEmote && onEmote(null); } },
    update(dt) { const had = d.current, pose = d.update(dt); if (had && !d.current) onEmote && onEmote(null); return pose; },
  };
}
