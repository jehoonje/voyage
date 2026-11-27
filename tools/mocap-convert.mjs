// Mixamo FBX (in place, without skin) and KayKit Character Animations (CC0, Rig_Medium .glb)
// → compact clips for our 16-bone hiker. Forward travel is removed either way.
// Usage: node tools/mocap-convert.mjs <mixamo dir> <kaykit Rig_Medium gltf dir> > src/character/mocap.js
//   mixamo dir holds Walking, Running, Swimming, SwimEdge .fbx; kaykit dir holds Rig_Medium_*.glb
// Limbs are retargeted by segment direction (so Mixamo's T-pose and our arms-down rest don't matter),
// the trunk and head by world rotation relative to Mixamo's rest.
// FBX files exported "with skin" embed textures; the loader reaches for browser APIs to unpack them
globalThis.window = globalThis.window || { URL: { createObjectURL: () => '', revokeObjectURL() {} } };
globalThis.self = globalThis.self || globalThis;
globalThis.document = globalThis.document || { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, style: {}, set src(v) {} }) };
import fs from 'fs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BONES, BONE } from '../src/character/rig.js';

const FPS = 30, HIP_Y = 0.42; // our rest hip height (model metres)
const STRIDE = 1.4; // cartoon stride: leg swing angles (front/back) are opened up by this much
const V = (a) => new THREE.Vector3(...a);
const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
/** take out part of a world rotation's forward pitch (and side roll): our big head and pack exaggerate the lean */
function level(q, pitchAmt, rollAmt = 0) {
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const pitch = Math.atan2(up.z, up.y), roll = Math.atan2(-up.x, up.y);
  return new THREE.Quaternion().setFromAxisAngle(Z, -roll * rollAmt)
    .multiply(new THREE.Quaternion().setFromAxisAngle(X, -pitch * pitchAmt)).multiply(q);
}
const arc = (a, b) => new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());

// KayKit bone names → the Mixamo names the rest of this converter uses
const KK = { upperarm: 'Arm', lowerarm: 'ForeArm', wrist: 'Hand', upperleg: 'UpLeg', lowerleg: 'Leg', foot: 'Foot', toes: 'ToeBase', handslot: 'Slot' };
const KK_TRUNK = { hips: 'Hips', chest: 'Spine2', head: 'Head' };
// parsed fresh for every clip: the rest pose is read before playing, and a reused scene keeps the last clip's pose
async function loadGlb(file) {
  const buf = fs.readFileSync(file);
  return new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
}
async function load(file, clipName) {
  if (file.endsWith('.glb')) {
    const g = await loadGlb(file), obj = g.scene;
    obj.scale.setScalar(100); // metres → centimetres, like Mixamo
    const bone = {};
    obj.traverse((o) => {
      if (!o.isBone) return;
      if (KK_TRUNK[o.name]) bone[KK_TRUNK[o.name]] = o;
      const m = o.name.match(/^([a-z]+)([lr])$/);
      if (m && KK[m[1]]) bone[(m[2] === 'l' ? 'Left' : 'Right') + KK[m[1]]] = o;
    });
    const clip = g.animations.find((a) => a.name === clipName);
    if (!clip) throw new Error('no clip ' + clipName + ' in ' + file);
    return { obj, bone, clip };
  }
  const buf = fs.readFileSync(file);
  const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const bone = {}; obj.traverse((o) => { if (o.isBone) bone[o.name.replace(/^.*mixamorig\d*:?/, '')] = o; });
  return { obj, bone, clip: obj.animations[0] };
}

/**
 * opt.lean: take out part of the trunk's forward lean (upright clips); opt.stride: open up leg swing;
 * opt.headUp: lift the head toward upright (prone swimming); opt.armsOut: push arms away from the jacket; opt.fps; opt.from/to: seconds of the clip to keep;
 * opt.align: start the loop at our left heel strike; opt.speed: 'feet' (planted foot) or 'root' (root travel)
 * opt.armLift: raise raised arms further (KayKit's chibi lifts its hands to shoulder height for a cheer; ours needs more)
 * opt.clip: clip name (KayKit files hold many); opt.tool: 'Right' | 'Left' — record which way the tool held in
 * that (KayKit) hand points, so the game can lay a rod or an axe along it
 */
async function convert(file, opt) {
  const { lean = 0.5, headUp = 0, stride = 1, armsOut = 0.16, fps = FPS, from = 0, to = Infinity, align = false, speed: speedBy = 'feet', clip: clipName, tool, armLift = 0 } = opt;
  const { obj, bone, clip } = await load(file, clipName);
  obj.updateMatrixWorld(true);
  const wp = (n) => bone[n].getWorldPosition(new THREE.Vector3());
  const wq = (n) => bone[n].getWorldQuaternion(new THREE.Quaternion());
  // which Mixamo side is our L (the −x side)?
  const mixL = wp('LeftUpLeg').x < 0 ? 'Left' : 'Right', mixR = mixL === 'Left' ? 'Right' : 'Left';
  const restQ = {}; for (const n of ['Hips', 'Spine2', 'Head']) restQ[n] = wq(n);
  const restFoot = { L: wp(mixL + 'ToeBase').sub(wp(mixL + 'Foot')), R: wp(mixR + 'ToeBase').sub(wp(mixR + 'Foot')) };
  const restHipY = wp('Hips').y - Math.min(wp(mixL + 'ToeBase').y, wp(mixR + 'ToeBase').y) + 2; // ~sole thickness
  const k = HIP_Y / restHipY;

  const mixer = new THREE.AnimationMixer(obj);
  mixer.clipAction(clip).play();
  const t0 = from, t1 = Math.min(to, clip.duration), n = Math.round((t1 - t0) * fps);
  const ourRest = (name, a, b) => V(BONES[BONE[name]].seg[b === undefined ? 1 : b]).sub(V(BONES[BONE[name]].seg[0]));
  const restDir = {
    upperArmL: V(BONES[BONE.foreArmL].pos).sub(V(BONES[BONE.upperArmL].pos)), foreArmL: V(BONES[BONE.handL].pos).sub(V(BONES[BONE.foreArmL].pos)),
    upperArmR: V(BONES[BONE.foreArmR].pos).sub(V(BONES[BONE.upperArmR].pos)), foreArmR: V(BONES[BONE.handR].pos).sub(V(BONES[BONE.foreArmR].pos)),
    thighL: V(BONES[BONE.shinL].pos).sub(V(BONES[BONE.thighL].pos)), shinL: V(BONES[BONE.footL].pos).sub(V(BONES[BONE.shinL].pos)),
    thighR: V(BONES[BONE.shinR].pos).sub(V(BONES[BONE.thighR].pos)), shinR: V(BONES[BONE.footR].pos).sub(V(BONES[BONE.shinR].pos)),
  };
  const frames = [], hips = [], feet = [], toolDir = [];
  for (let f = 0; f < n; f++) {
    mixer.setTime(t0 + (f / n) * (t1 - t0));
    obj.updateMatrixWorld(true);
    const W = {};
    const delta = (m) => wq(m).multiply(restQ[m].clone().invert());
    W.hips = level(delta('Hips'), lean);
    W.spine = level(delta('Spine2'), lean);
    W.neck = W.spine.clone();
    const head = W.spine.clone().slerp(delta('Head'), 0.6); // big head: let it bob less
    W.head = lean ? level(head, 0.85, 0.6) : headUp ? level(head, headUp, 0.5) : head; // keep the eyes ahead
    const seg = (a, b, side, out = 0, amp = 1, lift = 0) => {
      const d = wp(b).sub(wp(a)).normalize();
      if (lift && d.y > -0.3) { const k = d.y + 0.3; d.y += lift * k; d.x += side * 0.3 * lift * k; d.normalize(); } // only arms already on the way up; up and a little out
      if (amp !== 1) { // widen the swing in the side view (angle from straight down)
        const h = Math.hypot(d.y, d.z), ang = Math.atan2(d.z, -d.y) * amp;
        d.y = -Math.cos(ang) * h; d.z = Math.sin(ang) * h;
      }
      if (out) { d.x += side * out; d.normalize(); } // keep arms clear of our wider jacket
      return d;
    };
    for (const [s, m, sd] of [['L', mixL, -1], ['R', mixR, 1]]) {
      W['upperArm' + s] = arc(restDir['upperArm' + s], seg(m + 'Arm', m + 'ForeArm', sd, armsOut, 1, armLift));
      W['foreArm' + s] = arc(restDir['foreArm' + s], seg(m + 'ForeArm', m + 'Hand', sd, armsOut * 0.6, 1, armLift));
      W['hand' + s] = W['foreArm' + s].clone();
      W['thigh' + s] = arc(restDir['thigh' + s], seg(m + 'UpLeg', m + 'Leg', sd, 0.02, stride));
      W['shin' + s] = arc(restDir['shin' + s], seg(m + 'Leg', m + 'Foot', sd, 0.02, stride));
      W['foot' + s] = arc(restFoot[s], wp(m + 'ToeBase').sub(wp(m + 'Foot')));
    }
    // world → local through our hierarchy
    const local = BONES.map((b) => {
      const w = W[b.name];
      return b.parent < 0 ? w.clone() : W[BONES[b.parent].name].clone().invert().multiply(w);
    });
    frames.push(local);
    if (tool) toolDir.push(new THREE.Vector3(0, 1, 0).applyQuaternion(wq(tool + 'Slot'))); // KayKit: a held tool runs along the slot's +y
    const hp = wp('Hips');
    hips.push(hp);
    feet.push({ L: wp(mixL + 'Foot').sub(hp), R: wp(mixR + 'Foot').sub(hp), Ly: wp(mixL + 'ToeBase').y, Ry: wp(mixR + 'ToeBase').y });
  }
  // phase 0 = our left foot furthest forward (heel strike)
  let f0 = 0; if (align) for (let f = 1; f < n; f++) if (feet[f].L.z > feet[f0].L.z) f0 = f;
  // ground speed: how fast a planted foot slides back under the body (cm/s → model m/s)
  const vs = [];
  for (const s of ['L', 'R']) {
    const minY = Math.min(...feet.map((x) => x[s + 'y']));
    for (let f = 0; f < n; f++) {
      const g = (f + 1) % n;
      if (feet[f][s + 'y'] < minY + 4 && feet[g][s + 'y'] < minY + 4) vs.push(-(feet[g][s].z - feet[f][s].z) * fps);
    }
  }
  vs.sort((a, b) => a - b);
  const speed = speedBy === 'root' ? ((hips[n - 1].z - hips[0].z) * (n / (n - 1)) / (t1 - t0)) * k : vs[vs.length >> 1] * k * stride; // model m/s
  const mean = hips.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / n);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const q = [], p = [], d = [];
  for (let i = 0; i < n; i++) {
    const f = (i + f0) % n;
    for (const qq of frames[f]) q.push(r3(qq.x), r3(qq.y), r3(qq.z), r3(qq.w));
    p.push(r3((hips[f].x - mean.x) * k), r3((hips[f].y - restHipY) * k), 0); // forward root motion dropped: the game moves the body
    if (tool) d.push(r3(toolDir[f].x), r3(toolDir[f].y), r3(toolDir[f].z));
  }
  console.error(clipName || file, { frames: n, mixL, restHipY: restHipY.toFixed(1), modelSpeed: speed.toFixed(3), hipDrop: ((mean.y - restHipY) * k).toFixed(3) });
  const out = { n, duration: r3(t1 - t0), speed: r3(speed), q, p };
  // our L is whichever source side sits at −x
  if (tool) out.tool = { side: tool === mixL ? 'L' : 'R', d };
  return out;
}

const [mx, kk] = process.argv.slice(2);
const KT = kk + '/Rig_Medium_Tools.glb', KS = kk + '/Rig_Medium_Simulation.glb', KG = kk + '/Rig_Medium_General.glb';
// KayKit clips: an upright chibi already, so no levelling; arms keep their own spacing
const kay = (file, clip, o = {}) => convert(file, { lean: 0, armsOut: 0, fps: 20, clip, ...o });
const out = {
  // Mixamo
  walk: await convert(mx + '/Walking.fbx', { stride: STRIDE, align: true }),
  run: await convert(mx + '/Running.fbx', { stride: STRIDE, align: true }),
  // breaststroke, two strokes; the body lies flat so nothing is levelled
  swim: await convert(mx + '/Swimming.fbx', { lean: 0, headUp: 0.72, armsOut: 0, fps: 15, speed: 'root' }),
  // reaching the bank: the grab, played once as the hiker hauls out of the water
  edge: await convert(mx + '/SwimEdge.fbx', { lean: 0, armsOut: 0, fps: 20, from: 1.5, to: 3.1 }),
  // KayKit: fishing (rod in the right hand)
  fishCast: await kay(KT, 'Fishing_Cast', { tool: 'Right' }),
  fishIdle: await kay(KT, 'Fishing_Idle', { tool: 'Right', fps: 8 }),
  fishBite: await kay(KT, 'Fishing_Bite', { tool: 'Right', fps: 15 }),
  fishTug: await kay(KT, 'Fishing_Tug', { tool: 'Right', fps: 15 }),
  fishFight: await kay(KT, 'Fishing_Struggling', { tool: 'Right', fps: 15 }),
  fishReel: await kay(KT, 'Fishing_Reeling', { tool: 'Right', fps: 15 }),
  fishCatch: await kay(KT, 'Fishing_Catch', { tool: 'Right', fps: 15 }),
  // KayKit: work
  chop: await kay(KT, 'Chopping', { tool: 'Right', lean: 0.55 }),
  hammer: await kay(KT, 'Hammering', { tool: 'Right', fps: 15, to: 1.333, lean: 0.55 }),
  useItem: await kay(KG, 'Use_Item', { fps: 15 }),
  interact: await kay(KG, 'Interact', { fps: 15 }),
  // KayKit: emotes and sitting on the ground
  wave: await kay(KS, 'Waving', { fps: 15, armLift: 2.2 }),
  cheer: await kay(KS, 'Cheering', { fps: 15, armLift: 2.5 }),
  sitDown: await kay(KS, 'Sit_Floor_Down', { to: 0.875 }),
  sitIdle: await kay(KS, 'Sit_Floor_Idle', { fps: 6 }),
  sitUp: await kay(KS, 'Sit_Floor_StandUp'),
};
process.stdout.write(`// Generated by tools/mocap-convert.mjs.
// walk, run, swim, edge: Mixamo clips (in place). Everything else: KayKit Character Animations 1.1
// by Kay Lousberg (www.kaylousberg.com), CC0.
// Per frame: one quaternion per bone (rig.js order) and the hip offset; walk/run frame 0 = left heel strike.
// speed: ground speed (model m/s) at which the feet stay planted when played in real time.
// tool (some clips): which of our hands holds it and, per frame, the direction it points (model space).
export default ${JSON.stringify(out)};
`);
