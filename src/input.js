// Touch joystick (left half), camera drag (right half), keyboard, jump/run buttons.
import { clamp } from './noise.js';

export function createInput({ onJump, onMap, onLook, onZoom }) {
  const $ = (id) => document.getElementById(id);
  const joyEl = $('joy'), knob = $('knob'), touch = $('touch'), runBtn = $('runBtn');
  const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const look = { id: null, lx: 0, ly: 0 };
  const keys = {};
  let running = false;

  function joyHome() {
    joy.ox = Math.max(90, innerWidth * 0.16);
    joy.oy = innerHeight - 110;
    joyEl.style.transform = `translate(${joy.ox}px,${joy.oy}px)`;
    knob.style.transform = '';
  }
  joyHome();
  addEventListener('resize', () => { if (joy.id === null) joyHome(); });

  touch.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (e.clientX < innerWidth * 0.45 && joy.id === null) {
      Object.assign(joy, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
      joyEl.style.transform = `translate(${joy.ox}px,${joy.oy}px)`;
      joyEl.classList.add('act');
    } else if (look.id === null) {
      Object.assign(look, { id: e.pointerId, lx: e.clientX, ly: e.clientY });
    }
    touch.setPointerCapture(e.pointerId);
  });
  touch.addEventListener('pointermove', (e) => {
    if (e.pointerId === joy.id) {
      let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
      const l = Math.hypot(dx, dy), max = 56;
      if (l > max) { dx *= max / l; dy *= max / l; }
      joy.x = dx / max; joy.y = dy / max;
      knob.style.transform = `translate(${dx}px,${dy}px)`;
    } else if (e.pointerId === look.id) {
      onLook(e.clientX - look.lx, e.clientY - look.ly);
      look.lx = e.clientX; look.ly = e.clientY;
    }
  });
  const end = (e) => {
    if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; joyEl.classList.remove('act'); joyHome(); }
    if (e.pointerId === look.id) look.id = null;
  };
  touch.addEventListener('pointerup', end);
  touch.addEventListener('pointercancel', end);
  touch.addEventListener('wheel', (e) => onZoom(e.deltaY), { passive: true });

  addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Space') { onJump(); e.preventDefault(); }
    if (e.code === 'KeyM') onMap();
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });

  $('jumpBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); onJump(); });
  runBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    running = !running;
    runBtn.classList.toggle('on', running);
    runBtn.setAttribute('aria-pressed', running);
  });
  $('mapBtn').addEventListener('click', onMap);

  return {
    /** movement intent in screen space: x right, y down, mag 0..1 */
    read() {
      let x = joy.x, y = joy.y;
      if (keys.KeyW || keys.ArrowUp) y = -1;
      if (keys.KeyS || keys.ArrowDown) y = 1;
      if (keys.KeyA || keys.ArrowLeft) x = -1;
      if (keys.KeyD || keys.ArrowRight) x = 1;
      return { x, y, mag: clamp(Math.hypot(x, y), 0, 1), run: running || keys.ShiftLeft || keys.ShiftRight };
    },
  };
}
