// Modern backpacker: realistic proportions (~1.8 m), knees and elbows,
// windbreaker, trekking trousers, boots, beanie and a loaded pack.
// Posed through a small set of numbers that blend toward locomotion or an action pose.
import * as THREE from 'three';

const HIP = 0.93, THIGH = 0.45, SHIN = 0.44, SHOULDER = 0.55, UPPER_ARM = 0.29, FOREARM = 0.27;
export const POSE_KEYS = ['drop', 'back', 'lean', 'twist', 'legL', 'legR', 'kneeL', 'kneeR',
  'armLX', 'armRX', 'armLZ', 'armRZ', 'elbowL', 'elbowR'];

/** fine woven-fabric noise, multiplies with each material's colour */
function fabricTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d'), img = ctx.createImageData(64, 64);
  for (let i = 0; i < 64 * 64; i++) {
    const x = i % 64, y = (i / 64) | 0;
    const weave = ((x + y) % 4 < 2 ? 6 : -6) + ((x * 7 + y * 13) % 11) - 5;
    const v = 225 + weave + (Math.random() - 0.5) * 22;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

export function createHero(scene) {
  const fabric = fabricTexture();
  const L = (c, tex = true) => new THREE.MeshLambertMaterial({ color: c, map: tex ? fabric : null });
  const M = {
    jacket: L(0xc4612c), jacketDark: L(0x8f4320), pants: L(0x3a3f45), boot: L(0x5a3c24, false), sole: L(0x26221f, false),
    skin: L(0xd6a27e, false), hair: L(0x3a2a1e, false), beanie: L(0x2e4a3f), pack: L(0x2f5866), packDark: L(0x1f3a44),
    strap: L(0x1f2426), mat: L(0x8a9e55), bottle: L(0x9cc6d6, false), wood: L(0x8a5a32, false), steel: L(0xb9c0c6, false),
  };
  const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const group = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  /** a limb segment hanging down from its pivot */
  const seg = (r0, r1, len, mat, parent) => {
    const g = new THREE.CylinderGeometry(r0, r1, len, 10, 1).translate(0, -len / 2, 0);
    mesh(g, mat, parent);
    mesh(new THREE.SphereGeometry(Math.max(r0, r1) * 1.02, 10, 8), mat, parent); // rounded joint
  };

  const root = new THREE.Group();
  scene.add(root);
  const pelvis = group(root);
  const upper = group(pelvis, 0, HIP, 0);

  // hips and trousers seat
  mesh(new THREE.SphereGeometry(1, 14, 10).scale(0.19, 0.13, 0.13), M.pants, upper, 0, 0.02, 0);

  // torso: a lathed jacket, flattened front-to-back
  const prof = [[0.16, 0], [0.18, 0.12], [0.205, 0.3], [0.21, 0.44], [0.17, 0.53], [0.07, 0.58], [0.0, 0.585]].map(([r, y]) => new THREE.Vector2(r, y));
  mesh(new THREE.LatheGeometry(prof, 16).scale(1, 1, 0.66), M.jacket, upper, 0, 0.04, 0);
  mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 16).scale(1, 1, 0.68), M.jacketDark, upper, 0, 0.05, 0); // hem
  mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.08, 12), M.jacketDark, upper, 0, 0.6, 0); // collar
  mesh(new THREE.BoxGeometry(0.012, 0.42, 0.01), M.jacketDark, upper, 0, 0.32, 0.142); // zip

  // head
  const neck = group(upper, 0, 0.6, 0);
  mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.1, 10), M.skin, neck, 0, 0.04, 0);
  const head = group(neck, 0, 0.18, 0.01);
  mesh(new THREE.SphereGeometry(0.105, 16, 12).scale(1, 1.15, 1.05), M.skin, head);
  mesh(new THREE.SphereGeometry(0.03, 8, 6).scale(1, 1, 0.6), M.skin, head, -0.1, 0, 0); // ears
  mesh(new THREE.SphereGeometry(0.03, 8, 6).scale(1, 1, 0.6), M.skin, head, 0.1, 0, 0);
  mesh(new THREE.BoxGeometry(0.03, 0.04, 0.04), M.skin, head, 0, -0.01, 0.11); // nose
  mesh(new THREE.SphereGeometry(0.108, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(1, 1.15, 1.07), M.hair, head, 0, -0.005, -0.006);
  mesh(new THREE.SphereGeometry(0.113, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.48).scale(1, 1.2, 1.08), M.beanie, head, 0, 0.02, -0.004);
  mesh(new THREE.TorusGeometry(0.104, 0.018, 6, 18).rotateX(Math.PI / 2).scale(1, 1, 1.06), M.beanie, head, 0, 0.045, -0.004); // cuff

  // backpack: main bag, lid, rolled mat, side bottle, straps and hip belt
  const pack = group(upper, 0, 0.3, -0.2);
  mesh(new THREE.CapsuleGeometry(0.15, 0.4, 6, 12).scale(1.25, 1, 0.75), M.pack, pack, 0, 0.06, -0.06);
  mesh(new THREE.CapsuleGeometry(0.12, 0.12, 4, 10).rotateZ(Math.PI / 2).scale(1.3, 0.75, 0.85), M.packDark, pack, 0, 0.42, -0.05);
  mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.46, 12).rotateZ(Math.PI / 2), M.mat, pack, 0, -0.27, -0.06);
  mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), M.bottle, pack, 0.22, -0.05, -0.04);
  mesh(new THREE.BoxGeometry(0.16, 0.05, 0.12), M.packDark, pack, 0, 0.12, -0.2); // front pocket strap
  for (const sx of [-1, 1]) {
    mesh(new THREE.BoxGeometry(0.055, 0.5, 0.02).rotateX(0.12), M.strap, upper, sx * 0.1, 0.33, 0.14);
    mesh(new THREE.BoxGeometry(0.055, 0.02, 0.32), M.strap, upper, sx * 0.1, 0.56, 0.0);
  }
  mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 20).rotateX(Math.PI / 2).scale(1, 1, 0.7), M.strap, upper, 0, 0.08, -0.01); // hip belt

  // arms: shoulder → elbow → hand
  const arm = (sx) => {
    const sh = group(upper, sx * 0.235, SHOULDER, 0);
    seg(0.058, 0.05, UPPER_ARM, M.jacket, sh);
    const el = group(sh, 0, -UPPER_ARM, 0);
    seg(0.05, 0.044, FOREARM, M.jacket, el);
    mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.04, 10), M.jacketDark, el, 0, -FOREARM + 0.02, 0); // cuff
    mesh(new THREE.SphereGeometry(1, 10, 8).scale(0.04, 0.06, 0.028), M.skin, el, 0, -FOREARM - 0.06, 0.005);
    return { sh, el };
  };
  const aL = arm(-1), aR = arm(1);

  // axe in the right hand: handle along the hand's +z, blade toward −y
  const axe = group(aR.el, 0, -FOREARM - 0.06, 0);
  mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.75, 8).rotateX(Math.PI / 2), M.wood, axe, 0, 0, 0.28);
  mesh(new THREE.BoxGeometry(0.025, 0.2, 0.13), M.steel, axe, 0, -0.07, 0.6);
  axe.visible = false;

  // legs: hip → knee → boot
  const leg = (sx) => {
    const hp = group(pelvis, sx * 0.1, HIP, 0);
    seg(0.085, 0.065, THIGH, M.pants, hp);
    const kn = group(hp, 0, -THIGH, 0);
    seg(0.064, 0.05, SHIN - 0.08, M.pants, kn);
    mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.12, 10), M.boot, kn, 0, -SHIN + 0.05, 0); // boot shaft
    mesh(new THREE.CapsuleGeometry(0.05, 0.14, 4, 10).rotateX(Math.PI / 2).scale(1.05, 0.8, 1), M.boot, kn, 0, -SHIN - 0.01, 0.05);
    mesh(new THREE.BoxGeometry(0.1, 0.025, 0.27), M.sole, kn, 0, -SHIN - 0.045, 0.05);
    return { hp, kn };
  };
  const lL = leg(-1), lR = leg(1);

  const cur = Object.fromEntries(POSE_KEYS.map((k) => [k, 0]));
  const tg = { ...cur };
  let walkT = 0, breathT = 0;

  return {
    root,
    /** target: action pose or null for locomotion */
    animate(dt, p, mag, run, target) {
      let rate;
      breathT += dt;
      if (target) {
        for (const k of POSE_KEYS) tg[k] = target[k] || 0;
        rate = 9;
      } else {
        walkT += dt * (mag > 0 ? (run ? 11 : 8) : 0);
        const amp = (p.swim ? 0.45 : run ? 0.85 : 0.6) * Math.min(1, mag * 1.5);
        const sw = mag > 0 ? Math.sin(walkT) * amp : 0;
        // knees fold while the leg swings forward, straighten as it plants
        const knee = (ph) => (mag > 0 ? (0.1 + (run ? 1.3 : 0.75) * Math.max(0, Math.sin(ph - 0.9))) * Math.min(1, mag * 1.5) : 0.04);
        Object.assign(tg, {
          drop: mag > 0 ? -Math.abs(Math.cos(walkT)) * (run ? 0.05 : 0.025) : -0.005 * Math.sin(breathT * 1.8),
          back: 0, lean: run && mag ? 0.18 : mag ? 0.05 : 0, twist: sw * 0.12,
          legL: sw, legR: -sw, kneeL: knee(walkT + Math.PI), kneeR: knee(walkT),
          armLX: -sw * 0.9, armRX: sw * 0.9, elbowL: run ? -1.2 : -0.25, elbowR: run ? -1.2 : -0.25,
          armLZ: p.swim ? -0.9 + Math.sin(walkT) * 0.3 : -0.06,
          armRZ: p.swim ? 0.9 - Math.sin(walkT) * 0.3 : 0.06,
        });
        const lk = p.land || 0; // landing squash, 0..1
        tg.drop -= 0.22 * lk; tg.lean += 0.25 * lk; tg.legL -= 0.6 * lk; tg.legR -= 0.6 * lk;
        tg.kneeL += 1.1 * lk; tg.kneeR += 1.1 * lk; tg.armLZ -= 0.4 * lk; tg.armRZ += 0.4 * lk;
        if (!p.grounded && !p.swim) { tg.kneeL += 0.6; tg.kneeR += 0.3; tg.legL -= 0.3; }
        rate = 22;
      }
      const a = Math.min(1, dt * rate);
      for (const k of POSE_KEYS) cur[k] += (tg[k] - cur[k]) * a;

      root.position.set(p.x, p.y, p.z);
      root.rotation.y = p.face;
      pelvis.position.set(0, cur.drop, cur.back);
      upper.rotation.set(cur.lean, cur.twist, 0);
      head.rotation.set(-cur.lean * 0.5, -cur.twist * 0.6, 0); // keep the gaze level
      lL.hp.rotation.x = cur.legL; lR.hp.rotation.x = cur.legR;
      lL.kn.rotation.x = cur.kneeL; lR.kn.rotation.x = cur.kneeR;
      aL.sh.rotation.set(cur.armLX, 0, cur.armLZ); aR.sh.rotation.set(cur.armRX, 0, cur.armRZ);
      aL.el.rotation.x = cur.elbowL; aR.el.rotation.x = cur.elbowR;
      pack.rotation.x = -cur.lean * 0.15 + Math.sin(walkT * 2) * 0.02 * mag;
      axe.visible = !!(target && target.axe);
    },
  };
}
