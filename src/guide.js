// The first minute: a short guided path for a new player, one goal at a time, each with a light
// pillar in the world and an arrow on screen pointing to it.
//   1. walk to the light   2. chop a tree   3. make a campfire   4. catch a fish at the water's edge
// Each step pays a little XP; the guide can be skipped, and once done it never shows again.
import * as THREE from 'three';
import { sample } from './world.js';

const STEPS = [
  { id: 'walk', text: 'Walk to the light', xp: 20 },
  { id: 'chop', text: 'Chop a tree for wood', xp: 20 },
  { id: 'camp', text: 'Make a campfire (Make → Make camp)', xp: 30 },
  { id: 'fish', text: 'Fish at the water’s edge', xp: 40 },
];

/** a spot on the bank you can fish from, near (x, z) */
export function findBank(x, z, maxR = 160) {
  for (let r = 6; r < maxR; r += 4) {
    for (let a = 0; a < Math.PI * 2; a += 4 / r) {
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, s = sample(px, pz);
      if (s.h < 0.2 || s.h > 1.6) continue;
      for (let b = 0; b < Math.PI * 2; b += Math.PI / 6) {
        if (sample(px + Math.sin(b) * 4.5, pz + Math.cos(b) * 4.5).h < -0.9) return { x: px, z: pz, face: b };
      }
    }
  }
  return null;
}

export function createGuide({ scene, camera, P, world, progress, onFinish }) {
  const $ = (id) => document.getElementById(id);
  const box = $('guide'), textEl = $('guideText'), stepEl = $('guideStep'), distEl = $('guideDist'), arrow = $('guideArrow');

  // a soft light pillar with a ring at its foot
  const beacon = new THREE.Group();
  const pillarMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 14, 20, 1, true).translate(0, 7, 0), pillarMat);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.7, depthWrite: false }));
  ring.position.y = 0.08;
  beacon.add(pillar, ring); beacon.visible = false; beacon.renderOrder = 950;
  scene.add(beacon);

  let step = -1, target = null, woodAt = 0, pulse = 0;
  const v = new THREE.Vector3(), fwd = new THREE.Vector3();

  function setTarget(t) {
    target = t;
    beacon.visible = !!t;
    if (t) beacon.position.set(t.x, sample(t.x, t.z).h, t.z);
  }

  function show() {
    const s = STEPS[step];
    stepEl.textContent = `${step + 1}/${STEPS.length}`;
    textEl.textContent = s.text;
    box.hidden = false;
    woodAt = progress.count('wood');
    if (s.id === 'walk') {
      // somewhere a little way off, on open ground, toward trees if we can
      let best = null;
      for (let k = 0; k < 24 && !best; k++) {
        const a = Math.random() * Math.PI * 2, d = 18 + Math.random() * 10, x = P.x + Math.sin(a) * d, z = P.z + Math.cos(a) * d;
        if (sample(x, z).h > 0.4 && !world.nearestTree(x, z, 1.5)) best = { x, z };
      }
      setTarget(best || { x: P.x + 20, z: P.z });
    } else if (s.id === 'chop') {
      const t = world.nearestTree(P.x, P.z, 80);
      setTarget(t ? { x: t.x, z: t.z, tree: true } : null);
      if (!t) textEl.textContent = 'Chop a tree for wood (find one nearby)';
    } else if (s.id === 'camp') setTarget(null);
    else if (s.id === 'fish') setTarget(findBank(P.x, P.z));
  }

  function advance() {
    const s = STEPS[step];
    progress.gain(s.xp);
    step++;
    if (step >= STEPS.length) { finish(true); return; }
    progress.toast('Nice!', STEPS[step - 1].text.replace(/ \(.*\)$/, ''), `+${s.xp} XP · next: ${STEPS[step].text.replace(/ \(.*\)$/, '')}`);
    show();
  }

  function finish(completed) {
    step = -1; box.hidden = true; setTarget(null);
    progress.setGuideDone();
    if (completed) progress.toast('You’re all set', 'Now wander anywhere', 'Every new place you reach fills in the map and gives XP');
    onFinish && onFinish();
  }

  $('guideSkip').addEventListener('click', () => { if (step >= 0) finish(false); });

  return {
    get active() { return step >= 0; },
    get target() { return target; },
    /** the guide lets you fish before Lv.3 once it gets to that step */
    get fishingOpen() { return step >= 3; },
    start() { if (progress.state.guideDone) return; step = 0; show(); },
    /** things that happen in the game: 'chopped' | 'camp' | 'caught' */
    event(e) {
      if (step < 0) return;
      const id = STEPS[step].id;
      if ((id === 'chop' && e === 'chopped') || (id === 'camp' && e === 'camp') || (id === 'fish' && e === 'caught')) advance();
    },
    update(dt) {
      if (step < 0) return;
      const id = STEPS[step].id;
      pulse += dt;
      pillarMat.opacity = 0.25 + Math.sin(pulse * 3) * 0.1;
      ring.scale.setScalar(1 + Math.sin(pulse * 3) * 0.08);
      if (id === 'walk' && target && Math.hypot(target.x - P.x, target.z - P.z) < 3) { advance(); return; }
      if (id === 'chop' && progress.count('wood') > woodAt) { advance(); return; }
      if (id === 'chop' && !target) { const t = world.nearestTree(P.x, P.z, 80); if (t) { setTarget({ x: t.x, z: t.z }); textEl.textContent = STEPS[step].text; } }
      // the arrow: where the target is, relative to where the camera looks
      if (target) {
        const dx = target.x - P.x, dz = target.z - P.z, d = Math.hypot(dx, dz);
        camera.getWorldDirection(fwd);
        const ang = Math.atan2(dx, dz) - Math.atan2(fwd.x, fwd.z);
        arrow.style.transform = `rotate(${-ang}rad)`;
        arrow.hidden = d < 3;
        distEl.textContent = d < 3 ? 'here' : `${Math.round(d)} m`;
      } else { arrow.hidden = true; distEl.textContent = ''; }
    },
  };
}
