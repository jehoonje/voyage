// Campfires: stones + log teepee, flickering flames with a warm light and sparks.
// Doused fires char, leave ash, linger, then fade away.
import * as THREE from 'three';

const ASH_LINGER = 40, ASH_FADE = 20; // seconds
const CHAR = new THREE.Color(0x2a2420);

function facet(g) { g = g.toNonIndexed(); g.computeVertexNormals(); return g; }

export function createCampfires(scene, fx) {
  // one light that always exists, so adding a fire never recompiles shaders
  const light = new THREE.PointLight(0xff8a3a, 0, 16, 1.5);
  scene.add(light);

  const logGeo = facet(new THREE.CylinderGeometry(0.07, 0.09, 0.9, 6));
  const stoneGeo = new THREE.DodecahedronGeometry(0.14, 0);
  const flameGeo = new THREE.ConeGeometry(0.27, 1.15, 7).translate(0, 0.55, 0);
  const ashGeo = new THREE.CircleGeometry(0.62, 18).rotateX(-Math.PI / 2);
  // outer flame is a normal translucent orange so it keeps its colour; inner layers add glow
  const flameMats = [[0xff5a12, 0.85, THREE.NormalBlending], [0xff9a22, 0.55, THREE.AdditiveBlending], [0xffd870, 0.6, THREE.AdditiveBlending]]
    .map(([c, o, b]) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: b, depthWrite: false }));
  const FLAME = [[1, 0, 0], [0.75, 0.06, 0.04], [0.45, -0.03, -0.02]];

  // sparks
  const NS = 48;
  const sPos = new Float32Array(NS * 3), sVel = new Float32Array(NS * 3), sLife = new Float32Array(NS);
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
  const sparks = new THREE.Points(sGeo, new THREE.PointsMaterial({
    color: 0xffb050, size: 0.07, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  for (let i = 0; i < NS; i++) sPos[i * 3 + 1] = -9999;
  function emit(f, speed = 1) {
    for (let i = 0; i < NS; i++) {
      if (sLife[i] > 0) continue;
      sLife[i] = 0.6 + Math.random() * 0.8;
      sPos[i * 3] = f.x + (Math.random() - 0.5) * 0.3;
      sPos[i * 3 + 1] = f.y + 0.25;
      sPos[i * 3 + 2] = f.z + (Math.random() - 0.5) * 0.3;
      sVel[i * 3] = (Math.random() - 0.5) * 0.6 * speed;
      sVel[i * 3 + 1] = (1.2 + Math.random() * 1.5) * speed;
      sVel[i * 3 + 2] = (Math.random() - 0.5) * 0.6 * speed;
      return;
    }
  }

  const fires = [];
  let night = 0;
  const glow = { x: 0, y: 0, z: 0, strength: 0 };

  function spawn(x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const logMat = new THREE.MeshLambertMaterial({ color: 0x7a5532, transparent: true });
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x8d8a85, transparent: true });
    const ashMat = new THREE.MeshLambertMaterial({ color: 0x4d4945, transparent: true, opacity: 0, depthWrite: false });

    const logs = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = k * Math.PI / 2 + 0.4;
      const m = new THREE.Mesh(logGeo, logMat);
      m.position.set(0, 0.34, 0.17);
      m.rotation.x = -0.42;
      m.castShadow = true;
      pivot.add(m);
      logs.add(pivot);
    }
    const stones = new THREE.Group();
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * 6.283, m = new THREE.Mesh(stoneGeo, stoneMat);
      m.position.set(Math.cos(a) * 0.55, 0.06, Math.sin(a) * 0.55);
      m.rotation.set(k, k * 2, 0);
      m.scale.set(1 + (k % 3) * 0.2, 0.7, 1);
      stones.add(m);
    }
    const ash = new THREE.Mesh(ashGeo, ashMat);
    ash.position.y = 0.025;
    const flames = FLAME.map(([s, ox, oz], i) => {
      const m = new THREE.Mesh(flameGeo, flameMats[i]);
      m.position.set(ox, 0.05, oz);
      m.userData.s = s;
      m.visible = false;
      return m;
    });
    g.add(logs, stones, ash, ...flames);
    logs.scale.setScalar(0.001);
    stones.scale.setScalar(0.001);
    scene.add(g);

    const f = { g, logs, stones, flames, logMat, stoneMat, ashMat, x, y, z, level: 0, target: 0, state: 'build', age: 0 };
    fires.push(f);
    return f;
  }

  function remove(f) {
    scene.remove(f.g);
    f.logMat.dispose(); f.stoneMat.dispose(); f.ashMat.dispose();
    fires.splice(fires.indexOf(f), 1);
  }

  return {
    spawn,
    glow,
    colliders() { return fires.filter((f) => f.state !== 'ash').map((f) => ({ x: f.x, z: f.z, r: 0.6, top: f.y + 0.45 })); },
    /** 0 = day, 1 = night: at night the fire lights a wider area */
    setNight(n) { night = n; },
    /** 0..1: logs and stones appear */
    setLogs(f, k) {
      f.logs.scale.setScalar(Math.max(k, 0.001));
      f.stones.scale.setScalar(Math.max(Math.min(1, k * 1.4), 0.001));
    },
    setLevel(f, k) { f.target = k; if (k > 0) f.state = 'burning'; },
    /** a few sparks while striking */
    strike(f) { if (Math.random() < 0.5) emit(f, 0.5); },
    douse(f) {
      if (f.state === 'dousing' || f.state === 'ash') return;
      f.state = 'dousing'; f.target = 0; f.age = 0;
      fx.smoke(f.x, f.y + 0.3, f.z, 10);
    },
    update(dt, now) {
      let lit = null, emitRate = 0;
      const flick = 0.85 + 0.12 * Math.sin(now * 0.017) + 0.08 * Math.sin(now * 0.041);
      for (const f of [...fires]) {
        f.level += (f.target - f.level) * Math.min(1, dt * (f.state === 'dousing' ? 2.5 : 1.8));
        f.flames.forEach((m, i) => {
          const s = m.userData.s * f.level;
          m.visible = s > 0.02;
          const w = 0.9 + 0.12 * Math.sin(now * 0.02 + i * 2.1);
          m.scale.set(s * w, s * (flick + 0.18 * Math.sin(now * 0.013 + i)), s * w);
          m.rotation.y += dt * (1 + i);
        });
        if (f.state === 'dousing') {
          f.age += dt;
          const k = Math.min(1, f.age / 1.5);
          f.logMat.color.setHex(0x7a5532).lerp(CHAR, k);
          f.ashMat.opacity = 0.9 * k;
          if (f.age > 2) { f.state = 'ash'; f.age = 0; }
        } else if (f.state === 'ash') {
          f.age += dt;
          if (f.age > ASH_LINGER) {
            const o = 1 - (f.age - ASH_LINGER) / ASH_FADE;
            if (o <= 0) { remove(f); continue; }
            f.logMat.opacity = f.stoneMat.opacity = o;
            f.ashMat.opacity = 0.9 * o;
          }
        }
        if (f.level > 0.05 && (!lit || f.level > lit.level)) lit = f;
      }
      if (lit) {
        light.position.set(lit.x, lit.y + 0.8, lit.z);
        light.intensity = lit.level * flick * (7 + 6 * night);
        light.distance = 14 + 8 * night;
        Object.assign(glow, { x: lit.x, y: lit.y, z: lit.z, strength: lit.level * flick * (0.25 + 0.45 * night) });
        emitRate = lit.level > 0.4 ? 14 * lit.level : 0;
        if (Math.random() < emitRate * dt) emit(lit);
      } else { light.intensity = 0; glow.strength = 0; }

      for (let i = 0; i < NS; i++) {
        if (sLife[i] <= 0) continue;
        sLife[i] -= dt;
        sPos[i * 3] += sVel[i * 3] * dt + Math.sin(now * 0.005 + i) * 0.004;
        sPos[i * 3 + 1] += sVel[i * 3 + 1] * dt;
        sPos[i * 3 + 2] += sVel[i * 3 + 2] * dt;
        if (sLife[i] <= 0) sPos[i * 3 + 1] = -9999;
      }
      sGeo.attributes.position.needsUpdate = true;
    },
  };
}
