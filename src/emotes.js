// Emotes (keys 1–4 or the Emote menu): wave, cheer, sit, clap. Plus the trophy pose for a big catch.
// Poses use the same channels as actions.js; other players see them through net.js.
const STAND = { drop: 0, back: 0, lean: 0, twist: 0, legL: 0, legR: 0, kneeL: 0.04, kneeR: 0.04, armLX: 0, armRX: 0, armLZ: -0.06, armRZ: 0.06, elbowL: -0.2, elbowR: -0.2 };
const SIT_FLOOR = { ...STAND, drop: -0.76, back: -0.3, lean: -0.05, legL: -1.75, legR: -1.6, kneeL: 1.75, kneeR: 1.65, armLX: -0.55, armRX: -0.55, armLZ: 0.2, armRZ: -0.2, elbowL: -0.85, elbowR: -0.85 };
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** each emote: how long it lasts (0 = until you move) and its pose at time t */
export const EMOTES = {
  wave: {
    label: 'Wave', key: 'Digit1', dur: 2.4,
    pose: (t) => {
      const up = ease(t / 0.35) * ease((2.4 - t) / 0.35);
      return { ...STAND, armRX: -2.75 * up, armRZ: (0.25 + Math.sin(t * 10) * 0.38) * up, elbowR: -0.35 * up, headY: 0.15 * up, lean: -0.04 * up };
    },
  },
  cheer: {
    label: 'Cheer', key: 'Digit2', dur: 2.2,
    pose: (t) => {
      const up = ease(t / 0.25) * ease((2.2 - t) / 0.3), b = Math.abs(Math.sin(t * 7));
      return { ...STAND, drop: -0.14 * b * up, kneeL: 0.04 + 0.35 * b * up, kneeR: 0.04 + 0.35 * b * up, legL: -0.15 * b * up, legR: -0.15 * b * up,
        armLX: (-2.6 + Math.sin(t * 14) * 0.2) * up, armRX: (-2.6 - Math.sin(t * 14) * 0.2) * up, armLZ: -0.5 * up, armRZ: 0.5 * up,
        elbowL: -0.25 * up, elbowR: -0.25 * up, lean: -0.12 * up, headX: -0.2 * up };
    },
  },
  sit: {
    label: 'Sit', key: 'Digit3', dur: 0,
    pose: (t) => {
      const k = ease(t / 0.7), breath = Math.sin(t * 1.4) * 0.03;
      const o = {};
      for (const c in SIT_FLOOR) o[c] = STAND[c] + (SIT_FLOOR[c] - STAND[c]) * k;
      o.lean += breath; return o;
    },
  },
  clap: {
    label: 'Clap', key: 'Digit4', dur: 2.2,
    pose: (t) => {
      const up = ease(t / 0.3) * ease((2.2 - t) / 0.3), c = Math.max(0, Math.sin(t * 16)) * 0.32;
      return { ...STAND, armLX: -1.3 * up, armRX: -1.3 * up, armLZ: (0.55 - c) * up, armRZ: (-0.55 + c) * up, elbowL: -1.0 * up, elbowR: -1.0 * up, headX: -0.08 * up };
    },
  },
};

/** both hands overhead holding a fish up, bouncing a little */
export function trophyPose(t) {
  const up = ease(t / 0.4), b = Math.abs(Math.sin(t * 5.5));
  return { ...STAND, drop: -0.08 * b, kneeL: 0.04 + 0.2 * b, kneeR: 0.04 + 0.2 * b,
    armLX: -3.05 * up, armRX: -3.05 * up, armLZ: 0.16 * up, armRZ: -0.16 * up, elbowL: -0.05 * up, elbowR: -0.05 * up, lean: -0.06 * up, headX: -0.3 * up };
}

/** sitting by a fire (also used for other players sitting at one) */
export const FIRE_SIT = { ...STAND, drop: -0.76, back: -0.3, lean: -0.1, legL: -2.0, legR: -1.9, kneeL: 1.5, kneeR: 1.45, armLX: -0.9, armRX: -0.9, armLZ: 0.1, armRZ: -0.1, elbowL: -0.55, elbowR: -0.55 };

/** the player's own emote state */
export function createEmotes({ onEmote }) {
  let cur = null, t = 0;
  return {
    get current() { return cur; },
    play(name) {
      if (!EMOTES[name]) return;
      cur = name; t = 0;
      onEmote && onEmote(name);
    },
    stop() { if (cur) { cur = null; onEmote && onEmote(null); } },
    /** pose for this frame, or null */
    update(dt) {
      if (!cur) return null;
      t += dt;
      const e = EMOTES[cur];
      if (e.dur && t >= e.dur) { cur = null; return null; }
      return e.pose(t);
    },
  };
}
