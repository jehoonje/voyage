// Blocky caped explorer. The rig is posed through a small set of numbers
// (drop, lean, legs, arms…) that blend toward either locomotion or an action pose.
import * as THREE from 'three';

const HIP = 0.8;
export const POSE_KEYS = ['drop', 'back', 'lean', 'twist', 'legL', 'legR', 'armLX', 'armRX', 'armLZ', 'armRZ'];

export function createHero(scene) {
  const root = new THREE.Group();
  scene.add(root);
  const pelvis = new THREE.Group(); // lowered for kneeling / sitting
  root.add(pelvis);
  const upper = new THREE.Group(); // bends at the hip
  upper.position.y = HIP;
  pelvis.add(upper);

  const Lm = (c) => new THREE.MeshLambertMaterial({ color: c });
  const M = {
    tunic: Lm(0x2e5d7e), skin: Lm(0xe4b48c), leather: Lm(0x6b4628),
    cape: Lm(0xa63a2c), hair: Lm(0x3a281a), pack: Lm(0x8a6a3e),
    wood: Lm(0x8a5a32), steel: Lm(0xb9c0c6),
  };
  const box = (w, h, d, m, x, y, z, parent) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.castShadow = true;
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const u = (y) => y - HIP; // world-height → upper-body local
  box(0.7, 0.8, 0.42, M.tunic, 0, u(1.17), 0, upper);
  box(0.74, 0.14, 0.46, M.leather, 0, u(0.82), 0, upper);
  box(0.46, 0.46, 0.46, M.skin, 0, u(1.83), 0, upper);
  box(0.5, 0.16, 0.5, M.hair, 0, u(2.1), -0.02, upper);
  box(0.5, 0.3, 0.1, M.hair, 0, u(1.95), -0.22, upper);
  box(0.5, 0.55, 0.24, M.pack, 0, u(1.25), -0.32, upper);
  const cape = box(0.62, 1, 0.05, M.cape, 0, u(1.12), -0.47, upper);

  const limb = (parent, x, y, w, h, m) => {
    const p = new THREE.Group();
    p.position.set(x, y, 0);
    parent.add(p);
    box(w, h, w, m, 0, -h / 2, 0, p);
    return p;
  };
  const legL = limb(pelvis, -0.18, 0.78, 0.26, 0.78, M.leather);
  const legR = limb(pelvis, 0.18, 0.78, 0.26, 0.78, M.leather);
  const armL = limb(upper, -0.47, u(1.52), 0.2, 0.72, M.tunic);
  const armR = limb(upper, 0.47, u(1.52), 0.2, 0.72, M.tunic);

  // axe in the right hand: handle runs along the hand's +z, blade toward −y
  const axe = new THREE.Group();
  axe.position.set(0, -0.68, 0);
  box(0.06, 0.06, 0.78, M.wood, 0, 0, 0.3, axe);
  box(0.04, 0.26, 0.16, M.steel, 0, -0.1, 0.62, axe);
  armR.add(axe);
  axe.visible = false;

  const cur = Object.fromEntries(POSE_KEYS.map((k) => [k, 0]));
  const tg = { ...cur };
  let walkT = 0;

  return {
    root,
    /** target: action pose or null for locomotion */
    animate(dt, p, mag, run, target) {
      let rate;
      if (target) {
        for (const k of POSE_KEYS) tg[k] = target[k] || 0;
        rate = 9;
      } else {
        walkT += dt * (mag > 0 ? (run ? 13 : 9) : 0);
        const sw = mag > 0 ? Math.sin(walkT) * (p.swim ? 0.4 : 0.75) * Math.min(1, mag * 1.5) : 0;
        Object.assign(tg, {
          drop: 0, back: 0, lean: run && mag ? 0.12 : 0, twist: 0,
          legL: sw, legR: -sw, armLX: -sw * 0.8, armRX: sw * 0.8,
          armLZ: p.swim ? -0.9 + Math.sin(walkT) * 0.3 : 0,
          armRZ: p.swim ? 0.9 - Math.sin(walkT) * 0.3 : 0,
        });
        const lk = p.land || 0; // landing squash, 0..1
        tg.drop = -0.3 * lk; tg.lean += 0.25 * lk; tg.legL -= 0.5 * lk; tg.legR -= 0.5 * lk;
        tg.armLZ -= 0.4 * lk; tg.armRZ += 0.4 * lk;
        rate = 25;
      }
      const a = Math.min(1, dt * rate);
      for (const k of POSE_KEYS) cur[k] += (tg[k] - cur[k]) * a;

      root.position.set(p.x, p.y, p.z);
      root.rotation.y = p.face;
      pelvis.position.set(0, cur.drop, cur.back);
      upper.rotation.set(cur.lean, cur.twist, 0);
      legL.rotation.x = cur.legL; legR.rotation.x = cur.legR;
      armL.rotation.set(cur.armLX, 0, cur.armLZ);
      armR.rotation.set(cur.armRX, 0, cur.armRZ);
      cape.rotation.x = -0.1 - mag * (run ? 0.6 : 0.3) - (p.grounded ? 0 : 0.3) - cur.lean * 0.6;
      axe.visible = !!(target && target.axe);
    },
  };
}
