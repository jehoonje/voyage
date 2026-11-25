// Small pooled effects: wood chips and smoke puffs.
import * as THREE from 'three';

export function createFx(scene) {
  const chipGeo = new THREE.BoxGeometry(0.12, 0.05, 0.08);
  const chipMat = new THREE.MeshLambertMaterial({ color: 0xc8955a });
  const chips = Array.from({ length: 28 }, () => {
    const m = new THREE.Mesh(chipGeo, chipMat);
    m.visible = false;
    scene.add(m);
    return { m, life: 0, vx: 0, vy: 0, vz: 0, floor: 0 };
  });

  const puffGeo = new THREE.IcosahedronGeometry(0.3, 0);
  const puffs = Array.from({ length: 24 }, () => {
    const mat = new THREE.MeshLambertMaterial({ color: 0x9a9690, transparent: true, opacity: 0, depthWrite: false });
    const m = new THREE.Mesh(puffGeo, mat);
    m.visible = false;
    scene.add(m);
    return { m, life: 0, max: 1, delay: 0, vx: 0, vz: 0 };
  });

  return {
    chips(x, y, z, n = 7, floor = y - 1) {
      let k = 0;
      for (const c of chips) {
        if (c.life > 0) continue;
        const a = Math.random() * 6.283, s = 1.5 + Math.random() * 2;
        Object.assign(c, { life: 0.9, vx: Math.cos(a) * s, vy: 2 + Math.random() * 2.5, vz: Math.sin(a) * s, floor });
        c.m.position.set(x, y, z);
        c.m.visible = true;
        if (++k >= n) break;
      }
    },
    smoke(x, y, z, n = 8) {
      let k = 0;
      for (const p of puffs) {
        if (p.life > 0 || p.delay > 0) continue;
        Object.assign(p, { delay: k * 0.18, life: 0, max: 3 + Math.random() * 1.5, vx: (Math.random() - 0.5) * 0.3, vz: (Math.random() - 0.5) * 0.3 });
        p.m.position.set(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4);
        if (++k >= n) break;
      }
    },
    update(dt) {
      for (const c of chips) {
        if (c.life <= 0) continue;
        c.life -= dt;
        c.vy -= 14 * dt;
        const p = c.m.position;
        p.x += c.vx * dt; p.y = Math.max(c.floor, p.y + c.vy * dt); p.z += c.vz * dt;
        c.m.rotation.x += dt * 9; c.m.rotation.z += dt * 7;
        if (c.life <= 0) c.m.visible = false;
      }
      for (const p of puffs) {
        if (p.delay > 0) {
          p.delay -= dt;
          if (p.delay <= 0) { p.life = p.max; p.m.visible = true; }
          continue;
        }
        if (p.life <= 0) continue;
        p.life -= dt;
        const age = 1 - p.life / p.max;
        p.m.position.x += p.vx * dt; p.m.position.z += p.vz * dt; p.m.position.y += (0.9 - age * 0.4) * dt;
        p.m.scale.setScalar(0.6 + age * 2.2);
        p.m.material.opacity = 0.55 * Math.sin(Math.PI * Math.min(1, age * 1.4 + 0.05)) * (1 - age);
        if (p.life <= 0) p.m.visible = false;
      }
    },
  };
}
