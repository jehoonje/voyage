// Small touches of life and light that depend on place, time and weather:
// sunbeams slanting through forest canopies, fireflies at night (and drifting motes in
// misty jungle by day), gulls wheeling over the sea, and dust skating over desert sand.
import * as THREE from 'three';
import { sample } from './world.js';
import { mix, sstep } from './noise.js';

const SHAFTS = 10, MOTES = 240, GULLS = 6;

const SHAFT_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const SHAFT_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha, uTime, uSeed;
varying vec2 vUv;
void main(){
  float edge = smoothstep(0., .35, vUv.x) * smoothstep(1., .65, vUv.x);
  float fall = smoothstep(0., .25, vUv.y) * (1. - smoothstep(.75, 1., vUv.y));
  float streak = .65 + .35 * sin(vUv.x * 23. + uSeed * 7. + sin(uTime * .3 + uSeed) * 2.);
  gl_FragColor = vec4(uColor, edge * fall * streak * uAlpha);
}`;

const MOTE_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCam; uniform float uTime, uSize, uBox;
varying float vGlow;
void main(){
  vec3 p = (aSeed.xyz - .5) * vec3(uBox, 6., uBox);
  float t = uTime * (.15 + aSeed.w * .2);
  p += vec3(sin(t * 1.7 + aSeed.w * 20.), sin(t * 2.3 + aSeed.x * 9.) * .4, cos(t * 1.3 + aSeed.z * 13.)) * 1.6;
  p.xz = mod(p.xz - uCam.xz + uBox * .5, uBox) - uBox * .5 + uCam.xz;
  p.y += uCam.y;
  vGlow = .5 + .5 * sin(uTime * (2. + aSeed.w * 3.) + aSeed.x * 50.); // blink
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize / max(1., -mv.z);
}`;
const MOTE_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha;
varying float vGlow;
void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard;
  gl_FragColor = vec4(uColor, uAlpha * vGlow * (1. - smoothstep(0., .5, d))); }`;

export function createAmbience(scene) {
  /* sunbeams: soft additive planes leaning along the sun, scattered under trees */
  const beams = [];
  const beamGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  for (let i = 0; i < SHAFTS; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 0.94, 0.78) }, uAlpha: { value: 0 }, uTime: { value: 0 }, uSeed: { value: Math.random() * 10 } },
      vertexShader: SHAFT_VERT, fragmentShader: SHAFT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    const m = new THREE.Mesh(beamGeo, mat);
    m.frustumCulled = false; m.visible = false; m.renderOrder = 5; m.matrixAutoUpdate = false;
    scene.add(m);
    beams.push({ m, life: 0, max: 1, w: 2, h: 14 });
  }

  /* motes: fireflies at night, pale floating specks in misty daylight, sand grains in the desert */
  const mg = new THREE.BufferGeometry(), seeds = new Float32Array(MOTES * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
  mg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const moteU = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uSize: { value: 30 }, uBox: { value: 24 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } };
  const motes = new THREE.Points(mg, new THREE.ShaderMaterial({ uniforms: moteU, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  motes.frustumCulled = false;
  scene.add(motes);

  /* gulls: two-triangle birds circling and gliding above the shore */
  const gullMat = new THREE.MeshLambertMaterial({ color: 0xf4f4f0, side: THREE.DoubleSide });
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.18, 0, 0, -0.12, 0.75, 0.02, -0.05], 3));
  wingGeo.computeVertexNormals();
  const bodyGeo = new THREE.ConeGeometry(0.07, 0.5, 5).rotateX(Math.PI / 2);
  const gulls = [];
  for (let i = 0; i < GULLS; i++) {
    const g = new THREE.Group(), L = new THREE.Mesh(wingGeo, gullMat), R = new THREE.Mesh(wingGeo, gullMat);
    R.scale.x = -1;
    g.add(L, R, new THREE.Mesh(bodyGeo, gullMat));
    g.visible = false;
    scene.add(g);
    gulls.push({ g, L, R, a: Math.random() * 6.28, r: 14 + Math.random() * 18, h: 11 + Math.random() * 8, sp: 0.25 + Math.random() * 0.2, ph: Math.random() * 10, cx: 0, cz: 0 });
  }
  let gullVis = 0;
  const sunDir = new THREE.Vector3(), bx = new THREE.Vector3(), bz = new THREE.Vector3(), scl = new THREE.Vector3();

  function placeBeam(b, px, pz, fresh) {
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * 6.283, r = 5 + Math.random() * 18, x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
      const s = sample(x, z);
      if (s.h < 1) continue;
      b.w = 2 + Math.random() * 3; b.h = 15 + Math.random() * 7;
      b.m.position.set(x, s.h - 0.5, z);
      b.max = 6 + Math.random() * 8;
      b.life = fresh ? Math.random() * b.max * 0.7 : 0; // first time on: start out of step, not all at once
      return true;
    }
    return false;
  }

  return {
    /** bio: biome weights near the player; light: env.light; wx: weather; sun: the sun light */
    update(dt, now, camera, px, py, pz, bio, light, wx, sun) {
      const t = now / 1000;
      const clear = 1 - sstep(0.45, 0.85, wx.cover);
      // sunbeams: daytime, under canopy, when the sun gets through
      const woods = Math.min(1, bio.forest + bio.jungle * 1.2);
      const beamK = woods * light.day * clear * (1 - wx.rain) * (0.6 + light.dusk * 0.8);
      sunDir.copy(sun.position).sub(sun.target.position).normalize();
      if (sunDir.y < 0.35) { sunDir.y = 0.35; sunDir.normalize(); } // keep beams from lying flat at dawn
      for (const b of beams) {
        if (beamK < 0.02) { b.m.visible = false; b.life = b.max; continue; }
        b.life += dt;
        if (b.life >= b.max || Math.hypot(b.m.position.x - px, b.m.position.z - pz) > 30) {
          if (!placeBeam(b, px, pz, !b.m.visible)) { b.m.visible = false; continue; }
        }
        const f = sstep(0, 2, b.life) * (1 - sstep(b.max - 2, b.max, b.life));
        const u = b.m.material.uniforms;
        u.uAlpha.value = f * beamK * 0.8;
        u.uTime.value = t;
        u.uColor.value.setRGB(1, mix(0.94, 0.75, light.dusk), mix(0.78, 0.55, light.dusk));
        // stand the beam along the sun direction and turn its face to the camera around that axis
        b.m.visible = true;
        bx.copy(camera.position).sub(b.m.position);
        bz.copy(bx).addScaledVector(sunDir, -bx.dot(sunDir)).normalize();
        bx.crossVectors(sunDir, bz);
        b.m.matrix.makeBasis(bx, sunDir, bz).scale(scl.set(b.w, b.h, 1)).setPosition(b.m.position);
        b.m.matrixWorldNeedsUpdate = true;
      }

      // motes: fireflies love warm, wet, wooded places at night; pale specks drift in misty jungle by day
      const nightGlow = light.night * (bio.forest + bio.jungle + bio.meadow * 0.6) * (1 - bio.cold) * (1 - wx.rain * 0.8);
      const dayMist = light.day * bio.jungle * 0.6 + light.day * wx.fog * 0.3 * (1 - bio.desert);
      const desertDust = light.day * bio.desert * 0.5 * (1 - wx.dust);
      moteU.uCam.value.set(px, py + 1.6, pz); moteU.uTime.value = t;
      if (nightGlow > Math.max(dayMist, desertDust)) {
        moteU.uColor.value.setRGB(0.9, 1, 0.5); moteU.uAlpha.value = Math.min(1, nightGlow * 1.6); moteU.uSize.value = 110;
      } else if (dayMist > desertDust) {
        moteU.uColor.value.setRGB(0.85, 0.95, 0.9); moteU.uAlpha.value = dayMist * 0.35; moteU.uSize.value = 26;
      } else {
        moteU.uColor.value.setRGB(1, 0.85, 0.6); moteU.uAlpha.value = desertDust * 0.3; moteU.uSize.value = 18;
      }
      moteU.uSize.value *= Math.min(devicePixelRatio, 1.75);
      motes.visible = moteU.uAlpha.value > 0.01;

      // gulls over the sea by day
      gullVis += ((bio.sea > 0.15 && light.day > 0.5 && wx.storm < 0.5 ? 1 : 0) - gullVis) * Math.min(1, dt * 0.5);
      for (const gl of gulls) {
        gl.g.visible = gullVis > 0.05;
        if (!gl.g.visible) { gl.cx = px; gl.cz = pz; continue; }
        gl.cx += (px - gl.cx) * dt * 0.05; gl.cz += (pz - gl.cz) * dt * 0.05;
        gl.a += dt * gl.sp;
        const x = gl.cx + Math.cos(gl.a) * gl.r, z = gl.cz + Math.sin(gl.a) * gl.r;
        gl.g.position.set(x, Math.max(sample(x, z).h, 0) + gl.h + Math.sin(t * 0.5 + gl.ph) * 1.5, z);
        gl.g.rotation.set(0, -gl.a, 0.35); // banking into the circle
        const flap = Math.sin(t * 7 + gl.ph) * (Math.sin(t * 0.4 + gl.ph) > 0.2 ? 0.55 : 0.08); // flap, then glide
        gl.L.rotation.z = flap; gl.R.rotation.z = -flap;
        gl.g.scale.setScalar(gullVis);
      }
    },
  };
}
