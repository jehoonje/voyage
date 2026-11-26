// Fishing from the bank (never while swimming): cast, wait for a bite, reel in.
// Bites come quickly and the strike window is generous, so most casts land a fish.
// A rod is drawn along the hiker's hands, a line sags to a red-and-white float,
// and the catch dangles from the line as it comes in.
import * as THREE from 'three';
import F from './fishModels.js';
import { sample } from './world.js';

/** what bites where (weights), how long it is (cm) and what it's worth */
export const CATCH = {
  minnow: { label: 'Minnow', cm: [12, 22], xp: 10, sea: 45, river: 65 },
  clown: { label: 'Clownfish', cm: [9, 14], xp: 15, sea: 17, river: 0 },
  tang: { label: 'Blue tang', cm: [18, 30], xp: 15, sea: 18, river: 0 },
  snapper: { label: 'Red snapper', cm: [35, 70], xp: 20, sea: 20, river: 35 },
};
const ROD_LEN = 2.3, BITE_WAIT = [1.5, 4.5], STRIKE_WINDOW = 3.2, RELEASE_AT = 1.85, FLIGHT = 0.6;

function fishMesh(name) {
  const f = F[name], g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(f.p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(f.c.map((v) => v / 255), 3));
  g.setIndex(f.i);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

export function createFishing({ scene, P, hero, progress, fx, onPickup }) {
  // rod: a thin tapering pole; float: red over white; line: a sagging curve between them
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.022, ROD_LEN, 6).translate(0, ROD_LEN / 2, 0), new THREE.MeshLambertMaterial({ color: 0x3a2a1c }));
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8).translate(0, 0.25, 0), new THREE.MeshLambertMaterial({ color: 0x1c1c1c }));
  rod.add(grip);
  const float = new THREE.Group();
  float.add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xe8352a })));
  float.add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xf4f2ea })));
  const SEG = 18, linePos = new Float32Array((SEG + 1) * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xe8e8e0, transparent: true, opacity: 0.75 }));
  line.frustumCulled = false;
  const caught = {};
  for (const n of Object.keys(CATCH)) { caught[n] = fishMesh(n); caught[n].visible = false; caught[n].rotation.order = 'YXZ'; scene.add(caught[n]); }
  rod.visible = float.visible = line.visible = false;
  scene.add(rod, float, line);

  let state = 'off', t = 0, bite = 0, spot = null, catchName = null, catchCm = 0, sea = true;
  const lo = new THREE.Vector3(), hi = new THREE.Vector3(), dir = new THREE.Vector3(), tip = new THREE.Vector3(), fp = new THREE.Vector3(), from = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  /** a spot of open water 3–8 m in front (or a little to either side), or null */
  function findSpot() {
    if (P.swim || !P.grounded || sample(P.x, P.z).h < -0.3) return null;
    for (const da of [0, 0.35, -0.35, 0.7, -0.7]) {
      const a = P.face + da, sx = Math.sin(a), sz = Math.cos(a);
      for (let d = 2.5; d <= 8; d += 0.5) {
        const x = P.x + sx * d, z = P.z + sz * d, s = sample(x, z);
        if (s.h < -0.7) {
          const d2 = Math.min(8, d + 1.5), s2 = sample(P.x + sx * d2, P.z + sz * d2); // a little further out if still water
          return s2.h < -0.7 ? { x: P.x + sx * d2, z: P.z + sz * d2, a, sea: !s2.riv } : { x, z, a, sea: !s.riv };
        }
      }
    }
    return null;
  }

  function pick() {
    const key = sea ? 'sea' : 'river', opts = Object.entries(CATCH).filter(([, c]) => c[key] > 0);
    let r = Math.random() * opts.reduce((a, [, c]) => a + c[key], 0);
    for (const [n, c] of opts) { r -= c[key]; if (r <= 0) return n; }
    return opts[0][0];
  }

  function end() {
    state = 'off';
    rod.visible = float.visible = line.visible = false;
    for (const m of Object.values(caught)) m.visible = false;
    hero.play(null);
  }

  function updateRod() {
    hero.hand('R', lo); hero.hand('L', hi); // lower and upper hand on the grip
    const fw = new THREE.Vector3(Math.sin(P.face), 0, Math.cos(P.face));
    dir.copy(hi).sub(lo).normalize().multiplyScalar(1.2).addScaledVector(UP, 0.5).addScaledVector(fw, 0.35).normalize();
    rod.position.copy(lo).addScaledVector(dir, -0.25);
    rod.quaternion.setFromUnitVectors(UP, dir);
    tip.copy(rod.position).addScaledVector(dir, ROD_LEN);
  }

  function drawLine(slack) {
    const len = tip.distanceTo(float.position);
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      fp.copy(tip).lerp(float.position, u);
      fp.y -= Math.sin(Math.PI * u) * len * 0.12 * slack;
      linePos.set([fp.x, fp.y, fp.z], i * 3);
    }
    lineGeo.attributes.position.needsUpdate = true;
  }

  return {
    get active() { return state !== 'off'; },
    /** 'cast' | 'wait' | 'bite' | 'reel' | 'show' | 'off' */
    get state() { return state; },
    /** is there water to fish in front of the player right now */
    canFish() { return state === 'off' && !!findSpot(); },
    start() {
      spot = findSpot();
      if (!spot) return false;
      sea = spot.sea;
      P.face = Math.atan2(spot.x - P.x, spot.z - P.z);
      P.vx = P.vz = 0;
      state = 'cast'; t = 0;
      rod.visible = true;
      hero.play('fishCast', { rate: 1.3 });
      return true;
    },
    /** the action button while fishing: strike on a bite, otherwise wind in */
    reel() {
      if (state === 'bite') {
        catchName = pick();
        const c = CATCH[catchName];
        catchCm = Math.round(c.cm[0] + Math.random() * (c.cm[1] - c.cm[0]));
      } else if (state === 'wait' || state === 'cast') {
        catchName = null;
      } else return;
      state = 'reel'; t = 0;
      from.copy(float.position);
      hero.play('fishReel', { rate: 2.2 });
    },
    /** walking away pulls the line in */
    cancel() { if (state !== 'off') end(); },
    update(dt) {
      if (state === 'off') return;
      t += dt;
      updateRod();
      const now = performance.now() / 1000;
      if (state === 'cast') {
        // the float leaves the rod tip on the forward swing and arcs out to the spot
        if (hero.clipTime < RELEASE_AT) { float.visible = line.visible = false; }
        else {
          const u = Math.min(1, (hero.clipTime - RELEASE_AT) / (FLIGHT * 1.3));
          float.visible = line.visible = true;
          float.position.set(tip.x + (spot.x - tip.x) * u, tip.y + (0.02 - tip.y) * u + Math.sin(Math.PI * u) * 1.6, tip.z + (spot.z - tip.z) * u);
          drawLine(0.3);
          if (u >= 1) {
            fx.splash(spot.x, 0.05, spot.z, 5);
            state = 'wait'; t = 0; bite = BITE_WAIT[0] + Math.random() * (BITE_WAIT[1] - BITE_WAIT[0]);
            hero.play('fishIdle', { loop: true });
          }
        }
      } else if (state === 'wait' || state === 'bite') {
        let y = 0.02 + Math.sin(now * 2.1) * 0.025;
        if (state === 'wait' && t > bite) {
          state = 'bite'; t = 0;
          progress.toast('Fishing', 'Bite!', 'Tap Reel in');
          fx.splash(float.position.x, 0.05, float.position.z, 4);
          if (navigator.vibrate) navigator.vibrate(90);
        }
        if (state === 'bite') {
          y -= 0.13 * Math.max(0, Math.sin(t * 9)); // the float bobs under, again and again
          if (t > STRIKE_WINDOW) { // missed: it got away, but another will come
            progress.toast('Fishing', 'It got away…', 'Wait for the next bite');
            state = 'wait'; t = 0; bite = BITE_WAIT[0] + Math.random() * (BITE_WAIT[1] - BITE_WAIT[0]);
          }
        }
        float.position.set(spot.x, y, spot.z);
        drawLine(1);
      } else if (state === 'reel') {
        // the float (and the fish, if there is one) is pulled in to the rod tip
        const u = Math.min(1, t / 1.6), k = u * u * (3 - 2 * u);
        float.position.copy(from).lerp(tip, k);
        float.position.y = Math.max(float.position.y, 0.02 + Math.sin(Math.PI * k) * 0.6 * k);
        drawLine(1 - k);
        if (catchName) {
          const m = caught[catchName], len = CATCH[catchName].cm[1] / 100 * 1.6;
          m.visible = true;
          m.scale.setScalar(len);
          m.position.copy(float.position).add(new THREE.Vector3(0, -len * 0.5, 0));
          m.rotation.set(-Math.PI / 2, P.face, Math.sin(now * 18) * 0.5); // hanging by the mouth, thrashing
        }
        if (u >= 1) {
          if (catchName) {
            const c = CATCH[catchName];
            progress.addItem('fish_' + catchName, 1);
            progress.gain(c.xp);
            progress.toast('Catch!', `${c.label} · ${catchCm} cm`, `+${c.xp} XP`);
            onPickup && onPickup(`${c.label} +1`);
            state = 'show'; t = 0;
          } else {
            progress.toast('Fishing', 'Nothing this time', 'Cast again when you like');
            end();
          }
        }
      } else if (state === 'show') {
        const m = caught[catchName];
        m.position.copy(tip).add(new THREE.Vector3(0, -m.scale.x * 0.55, 0));
        m.rotation.z = Math.sin(now * 12) * 0.4 * Math.max(0, 1 - t);
        float.position.copy(tip);
        drawLine(0);
        if (t > 1.4) end();
      }
    },
  };
}
