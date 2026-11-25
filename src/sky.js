// Sky colour, fog, lights, water surface and drifting clouds.
import * as THREE from 'three';

export function createEnvironment(scene) {
  const sky = new THREE.Color(0xa9d4ee);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 70, 190);

  // intensities ×π: three ≥r155 uses physical light units
  scene.add(new THREE.HemisphereLight(0xd8ecff, 0x5b6440, 0.95 * Math.PI));
  const sun = new THREE.DirectionalLight(0xfff0d0, 0.85 * Math.PI);
  sun.position.set(0.5, 1, 0.3);
  scene.add(sun);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700),
    new THREE.MeshPhongMaterial({ color: 0x2f7fb6, transparent: true, opacity: 0.78, shininess: 90, specular: 0x99ccee }),
  );
  water.rotation.x = -Math.PI / 2;
  scene.add(water);

  const clouds = [];
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8a95a0, transparent: true, opacity: 0.92 });
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(6 + Math.random() * 6, 0), cloudMat);
      m.position.set(k * 8 - 12, Math.random() * 3, Math.random() * 8 - 4);
      m.scale.y = 0.5;
      g.add(m);
    }
    g.position.set(Math.random() * 500 - 250, 95 + Math.random() * 30, Math.random() * 500 - 250);
    clouds.push(g);
    scene.add(g);
  }

  return {
    update(dt, now, px, pz) {
      water.position.set(Math.round(px / 50) * 50, Math.sin(now * 0.001) * 0.06, Math.round(pz / 50) * 50);
      for (const c of clouds) {
        c.position.x += dt * 2;
        if (c.position.x - px > 260) c.position.x -= 520;
        if (px - c.position.x > 260) c.position.x += 520;
        if (c.position.z - pz > 260) c.position.z -= 520;
        if (pz - c.position.z > 260) c.position.z += 520;
      }
    },
  };
}
