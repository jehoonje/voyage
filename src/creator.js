// Character creation screen: part tabs + colour swatches over a live 3D preview.
// Renders with the main renderer into the area above (or beside) the panel.
import * as THREE from 'three';
import { EYES, HAIR, HATS, TOPS, BOTTOMS, SHOES, ACCESSORIES, SKIN_TONES, HAIR_COLORS, IRIS_COLORS, GEAR_COLORS } from './character/parts.js';
import { sanitize, saveSpec } from './character/character.js';
import { WALK, RUN, SWIM_Y } from './physics.js';

const HAT_C = { ballcap: 0x26282a, camp: 0xa07440, plaidcap: 0xffffff, mesh: 0xc8c0dc, bucket: 0xc8b490, rollbeanie: 0x3a3e46, pombeanie: 0xe8e2d4, bandana: 0x1e1e22, visor: 0xc8d4dc };
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const pickOf = (a) => a[(Math.random() * a.length) | 0];

/** camera framing per tab: [target y (world), distance] */
const FRAME = { face: [1.36, 1.9], hair: [1.38, 2.1], hat: [1.42, 2.2], top: [1.0, 2.6], bottom: [0.55, 2.4], shoes: [0.3, 1.7], acc: [0.9, 3.4] };

export function createCreator({ renderer, hero, onDone }) {
  const $ = (id) => document.getElementById(id);
  const el = $('creator'), stage = $('crStage'), tabsEl = $('crTabs'), body = $('crBody'), busy = $('crBusy');

  /* ---------- preview scene ---------- */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfd3c8);
  scene.add(new THREE.HemisphereLight(0xfff6ec, 0x8a8478, 2.1));
  const key = new THREE.DirectionalLight(0xfff0e0, 2.4);
  key.position.set(-1.6, 3.2, 2.6); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0006; key.shadow.normalBias = 0.01;
  Object.assign(key.shadow.camera, { left: -1.2, right: 1.2, top: 2.2, bottom: -0.3, near: 0.5, far: 8 });
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xdde8ff, 0.9); rim.position.set(2, 2, -2.5); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xbcc2b4 }));
  floor.receiveShadow = true; scene.add(floor);
  const water = new THREE.Mesh(new THREE.CircleGeometry(1.3, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x3f8fb0, transparent: true, opacity: 0.6, depthWrite: false }));
  water.renderOrder = 2; water.visible = false; scene.add(water);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
  const view = { yaw: 0.35, ty: FRAME.acc[0], dist: FRAME.acc[1], ty0: FRAME.acc[0], dist0: FRAME.acc[1] };

  /* ---------- state ---------- */
  let spec = null, tab = 'face', accSel = null, active = false, motion = 'idle', mt = 0, prevParent = null;
  const P = { x: 0, y: 0, z: 0, face: 0, grounded: true, swim: false, land: 0 };

  let applying = 0, busyTimer = 0;
  function rebuild() {
    const n = ++applying;
    clearTimeout(busyTimer);
    busyTimer = setTimeout(() => { if (n === applying) busy.hidden = false; }, 150);
    hero.apply(spec).then((done) => { if (done && n === applying) { clearTimeout(busyTimer); busy.hidden = true; } })
      .catch((e) => { busy.hidden = false; busy.textContent = "Couldn't build it · " + e.message; });
  }
  function change(patch) { Object.assign(spec, patch); spec = sanitize(spec); render(); rebuild(); }

  /* ---------- UI ---------- */
  const TABS = [['face', 'Face'], ['hair', 'Hair'], ['hat', 'Hat'], ['top', 'Top'], ['bottom', 'Bottoms'], ['shoes', 'Shoes'], ['acc', 'Extras']];
  tabsEl.innerHTML = TABS.map(([k, n]) => `<button role="tab" data-tab="${k}">${n}</button>`).join('');
  tabsEl.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; render(); } });

  const sec = (title, inner) => `<section><h3>${title}</h3>${inner}</section>`;
  const chips = (field, cat, cur) => `<div class="chips">${Object.entries(cat).map(([k, v]) =>
    `<button class="chip" data-f="${field}" data-v="${k}" aria-pressed="${k === cur}">${v.name}</button>`).join('')}</div>`;
  const swatches = (field, pal, cur) => `<div class="sw">${pal.map((c) =>
    `<button class="swc" style="--c:${hex(c)}" data-f="${field}" data-c="${c}" aria-pressed="${c === cur}" aria-label="${hex(c)}"></button>`).join('')}
    <label class="swc pick${pal.includes(cur) ? '' : ' on'}" style="--c:${hex(cur)}" aria-label="Pick any colour"><input type="color" data-f="${field}" value="${hex(cur)}"><span>＋</span></label></div>`;

  function render() {
    for (const b of tabsEl.children) b.setAttribute('aria-selected', b.dataset.tab === tab);
    const s = spec;
    let h = '';
    if (tab === 'face') {
      h = sec('Skin', swatches('skin', SKIN_TONES, s.skin)) + sec('Eyes', chips('eyes', EYES, s.eyes)) +
        sec('Eye colour', swatches('iris', IRIS_COLORS, s.iris)) +
        sec('Freckles', `<div class="chips"><button class="chip" data-f="freckles" data-v="0" aria-pressed="${!s.freckles}">None</button><button class="chip" data-f="freckles" data-v="1" aria-pressed="${s.freckles}">Yes</button></div>`);
    } else if (tab === 'hair') {
      h = sec('Hairstyle', chips('hair', HAIR, s.hair)) + sec('Hair colour', swatches('hairColor', HAIR_COLORS, s.hairColor));
    } else if (tab === 'hat') {
      h = sec('Hat', chips('hat', HATS, s.hat)) + (s.hat !== 'none' ? sec('Hat colour', swatches('hatColor', GEAR_COLORS, s.hatColor)) : '');
    } else if (tab === 'top') {
      h = sec('Top', chips('top', TOPS, s.top)) + sec('Colour', swatches('topColor', GEAR_COLORS, s.topColor)) + sec(TOPS[s.top].accentName + ' colour', swatches('topAccent', GEAR_COLORS, s.topAccent));
    } else if (tab === 'bottom') {
      h = sec('Bottoms', chips('bottom', BOTTOMS, s.bottom)) + sec(BOTTOMS[s.bottom].tex ? 'Colour (tints the pattern)' : 'Colour', swatches('bottomColor', GEAR_COLORS, s.bottomColor));
    } else if (tab === 'shoes') {
      h = sec('Shoes', chips('shoes', SHOES, s.shoes)) + sec('Colour', swatches('shoesColor', GEAR_COLORS, s.shoesColor)) + sec('Sole colour', swatches('soleColor', GEAR_COLORS, s.soleColor));
    } else {
      const worn = Object.keys(s.acc);
      if (!worn.includes(accSel)) accSel = worn[worn.length - 1] || null;
      h = sec('Extras <small>pick several · one of each kind</small>', `<div class="chips">${Object.entries(ACCESSORIES).map(([k, v]) =>
        `<button class="chip" data-f="acc" data-v="${k}" aria-pressed="${!!s.acc[k]}">${v.name}</button>`).join('')}</div>`);
      if (accSel) {
        const A = ACCESSORIES[accSel];
        h += sec('Recolour', `<div class="chips">${worn.map((k) => `<button class="chip sm" data-f="accSel" data-v="${k}" aria-pressed="${k === accSel}">${ACCESSORIES[k].name}</button>`).join('')}</div>`);
        h += sec(`${A.name} · ${A.cName || 'colour'}`, swatches('accC', GEAR_COLORS, s.acc[accSel].c));
        if (A.c2 !== undefined) h += sec(`${A.name} · strap colour`, swatches('accC2', GEAR_COLORS, s.acc[accSel].c2));
      }
    }
    body.innerHTML = h;
    const f = FRAME[tab]; view.ty0 = f[0]; view.dist0 = f[1];
  }

  function pick(f, v) {
    const s = spec;
    if (f === 'eyes' || f === 'hair') change({ [f]: v });
    else if (f === 'freckles') change({ freckles: v === '1' });
    else if (f === 'hat') change({ hat: v, hatColor: HAT_C[v] ?? s.hatColor });
    else if (f === 'top') change({ top: v, topColor: TOPS[v].c, topAccent: TOPS[v].accent });
    else if (f === 'bottom') change({ bottom: v, bottomColor: BOTTOMS[v].c });
    else if (f === 'shoes') change({ shoes: v, shoesColor: SHOES[v].c, soleColor: SHOES[v].sole });
    else if (f === 'accSel') { accSel = v; render(); }
    else if (f === 'acc') {
      const acc = { ...s.acc }, A = ACCESSORIES[v];
      if (acc[v]) delete acc[v];
      else {
        if (A.group) for (const k of Object.keys(acc)) if (ACCESSORIES[k].group === A.group) delete acc[k];
        acc[v] = { c: A.c, ...(A.c2 !== undefined ? { c2: A.c2 } : {}) };
        accSel = v;
      }
      change({ acc });
    }
  }
  function colour(f, c) {
    if (f === 'accC' || f === 'accC2') {
      const acc = { ...spec.acc }; acc[accSel] = { ...acc[accSel], [f === 'accC' ? 'c' : 'c2']: c };
      change({ acc });
    } else change({ [f]: c });
  }
  body.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-f]'); if (!b) return;
    if (b.dataset.c !== undefined) colour(b.dataset.f, +b.dataset.c); else pick(b.dataset.f, b.dataset.v);
  });
  body.addEventListener('change', (e) => { const i = e.target; if (i.type === 'color') colour(i.dataset.f, parseInt(i.value.slice(1), 16)); });

  $('crRandom').addEventListener('click', () => {
    const keys = (o) => Object.keys(o);
    const top = pickOf(keys(TOPS)), bottom = pickOf(keys(BOTTOMS)), shoes = pickOf(keys(SHOES)), hat = Math.random() < 0.75 ? pickOf(keys(HATS).filter((k) => k !== 'none')) : 'none';
    const acc = {}, groups = new Set();
    const pool = keys(ACCESSORIES).sort(() => Math.random() - 0.5);
    if (Math.random() < 0.75) pool.unshift(pickOf(['daypack', 'bigpack', 'campack', 'vest', 'sling']));
    for (const k of pool.slice(0, 1 + ((Math.random() * 3) | 0))) {
      const A = ACCESSORIES[k]; if (A.group && groups.has(A.group)) continue; if (A.group) groups.add(A.group);
      acc[k] = { c: Math.random() < 0.6 ? A.c : pickOf(GEAR_COLORS), ...(A.c2 !== undefined ? { c2: A.c2 } : {}) };
    }
    const tint = (base) => (Math.random() < 0.55 ? base : pickOf(GEAR_COLORS));
    spec = sanitize({
      skin: pickOf(SKIN_TONES), eyes: pickOf(keys(EYES)), iris: pickOf(IRIS_COLORS), freckles: Math.random() < 0.2,
      hair: pickOf(keys(HAIR)), hairColor: pickOf(HAIR_COLORS), hat, hatColor: Math.random() < 0.6 ? (HAT_C[hat] ?? 0) : pickOf(GEAR_COLORS),
      top, topColor: tint(TOPS[top].c), topAccent: tint(TOPS[top].accent), bottom, bottomColor: BOTTOMS[bottom].tex ? 0xffffff : tint(BOTTOMS[bottom].c),
      shoes, shoesColor: tint(SHOES[shoes].c), soleColor: SHOES[shoes].sole, acc,
    });
    accSel = null; render(); rebuild();
  });
  $('crDone').addEventListener('click', () => {
    if (!hero.ready) return;
    saveSpec(spec);
    close();
    onDone(spec);
  });
  $('crMotion').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    motion = b.dataset.m; mt = 0;
    for (const x of $('crMotion').children) x.setAttribute('aria-pressed', x === b);
  });

  // drag to turn the hiker
  let drag = null;
  stage.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, x: e.clientX }; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id) { view.yaw -= (e.clientX - drag.x) * 0.01; drag.x = e.clientX; } });
  const end = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);

  function open(s) {
    spec = sanitize(s);
    tab = 'face'; accSel = null; motion = 'idle';
    for (const x of $('crMotion').children) x.setAttribute('aria-pressed', x.dataset.m === 'idle');
    prevParent = hero.root.parent;
    scene.add(hero.root);
    el.hidden = false; active = true; document.body.classList.add('creating');
    render();
    view.ty = view.ty0; view.dist = view.dist0;
    rebuild();
  }
  function close() {
    active = false; el.hidden = true; document.body.classList.remove('creating');
    (prevParent || scene).add(hero.root);
    renderer.setViewport(0, 0, innerWidth, innerHeight);
  }

  return {
    get active() { return active; },
    open,
    frame(dt) {
      // pose: idle / walk / run in place, or a hop
      mt += dt;
      P.y = 0; P.grounded = true; P.land = Math.max(0, P.land - dt * 3);
      const swim = motion === 'swim';
      const speed = motion === 'walk' ? WALK : motion === 'run' ? RUN : swim ? WALK * 0.55 : 0;
      P.swim = swim; water.visible = swim; floor.visible = !swim;
      if (motion === 'jump') {
        const t = mt % 1.4, air = 0.62;
        if (t < air) { P.y = 4.2 * t * (air - t); P.grounded = false; } else if (t < air + dt * 1.5) P.land = 0.6;
      }
      hero.animate(dt, P, speed, null);
      hero.root.position.y = swim ? SWIM_Y : P.y;
      hero.root.rotation.y = 0;

      // camera eases to the tab's framing
      const k = Math.min(1, dt * 6);
      view.ty += (view.ty0 - view.ty) * k; view.dist += (view.dist0 - view.dist) * k;
      const r = stage.getBoundingClientRect();
      const w = Math.max(1, r.width), h = Math.max(1, r.height);
      camera.aspect = w / h;
      // keep the whole framed part visible on narrow screens
      const fit = camera.aspect < 0.75 ? 0.75 / camera.aspect : 1;
      const d = view.dist * Math.min(fit, 1.6) * (swim ? 1.35 : 1);
      const oy = swim ? SWIM_Y + 0.5 : 0; // swimming sits low in the water
      camera.position.set(Math.sin(view.yaw) * d, view.ty + oy + d * 0.12 + (swim ? 0.5 : 0), Math.cos(view.yaw) * d);
      camera.lookAt(0, view.ty + oy, 0);
      camera.updateProjectionMatrix();
      renderer.setViewport(r.left, innerHeight - r.bottom, w, h);
      renderer.render(scene, camera);
    },
  };
}
