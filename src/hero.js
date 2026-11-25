// Blocky caped explorer with walk / swim animation.
import * as THREE from 'three';

export function createHero(scene) {
  const root = new THREE.Group();
  scene.add(root);
  const Lm = (c) => new THREE.MeshLambertMaterial({ color: c });
  const M = {
    tunic: Lm(0x2e5d7e), skin: Lm(0xe4b48c), leather: Lm(0x6b4628),
    cape: Lm(0xa63a2c), hair: Lm(0x3a281a), pack: Lm(0x8a6a3e),
  };
  const box = (w, h, d, m, x, y, z, parent = root) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.castShadow = true;
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  box(0.7, 0.8, 0.42, M.tunic, 0, 1.17, 0);
  box(0.74, 0.14, 0.46, M.leather, 0, 0.82, 0);
  box(0.46, 0.46, 0.46, M.skin, 0, 1.83, 0);
  box(0.5, 0.16, 0.5, M.hair, 0, 2.1, -0.02);
  box(0.5, 0.3, 0.1, M.hair, 0, 1.95, -0.22);
  box(0.5, 0.55, 0.24, M.pack, 0, 1.25, -0.32);
  const cape = box(0.62, 1, 0.05, M.cape, 0, 1.12, -0.47);
  const limb = (x, y, w, h, m) => {
    const p = new THREE.Group();
    p.position.set(x, y, 0);
    root.add(p);
    box(w, h, w, m, 0, -h / 2, 0, p);
    return p;
  };
  const legL = limb(-0.18, 0.78, 0.26, 0.78, M.leather), legR = limb(0.18, 0.78, 0.26, 0.78, M.leather);
  const armL = limb(-0.47, 1.52, 0.2, 0.72, M.tunic), armR = limb(0.47, 1.52, 0.2, 0.72, M.tunic);


  let walkT = 0;
  return {
    root,
    /** p: player state; mag: input 0..1; run: bool */
    animate(dt, p, mag, run) {
      root.position.set(p.x, p.y, p.z);
      root.rotation.y = p.face;
      walkT += dt * (mag > 0 ? (run ? 13 : 9) : 0);
      const sw = mag > 0 ? Math.sin(walkT) * (p.swim ? 0.4 : 0.75) * Math.min(1, mag * 1.5) : 0;
      legL.rotation.x = sw; legR.rotation.x = -sw;
      armL.rotation.x = -sw * 0.8; armR.rotation.x = sw * 0.8;
      if (p.swim) {
        armL.rotation.z = -0.9 + Math.sin(walkT) * 0.3;
        armR.rotation.z = 0.9 - Math.sin(walkT) * 0.3;
      } else {
        armL.rotation.z = armR.rotation.z = 0;
      }
      cape.rotation.x = -0.1 - mag * (run ? 0.6 : 0.3) - (p.grounded ? 0 : 0.3);
    },
  };
}
