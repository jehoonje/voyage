// Touch joystick (left half), camera drag (right half), pinch to zoom (two fingers on the camera side, or both
// thumbs landing together anywhere), keyboard, jump/run buttons.
import { clamp } from './noise.js';

export function createInput({ onJump, onMap, onLook, onZoom }) {
  const $ = (id) => document.getElementById(id);
  const joyEl = $('joy'), knob = $('knob'), touch = $('touch'), runBtn = $('runBtn');
  const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const look = { id: null, lx: 0, ly: 0 };
  const pinch = { id: null, x: 0, y: 0, d: 0 }; // second finger of a pinch
  const first = { id: null, t: 0, x: 0, y: 0, moved: false }; // the most recent lone touch, to spot two thumbs landing together
  const TOGETHER = 260; // ms
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

  function joyRelease() { joy.id = null; joy.x = joy.y = 0; joyEl.classList.remove('act'); joyHome(); }
  touch.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const solo = joy.id === null && look.id === null;
    // both thumbs down at (nearly) the same moment, the first one still: that's a pinch, wherever they are
    if (!solo && first.id !== null && !first.moved && e.timeStamp - first.t < TOGETHER && pinch.id === null) {
      if (joy.id === first.id) joyRelease();
      Object.assign(look, { id: first.id, lx: first.x, ly: first.y });
      Object.assign(pinch, { id: e.pointerId, x: e.clientX, y: e.clientY, d: Math.hypot(e.clientX - first.x, e.clientY - first.y) });
      first.id = null;
      try { touch.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      return;
    }
    if (solo) Object.assign(first, { id: e.pointerId, t: e.timeStamp, x: e.clientX, y: e.clientY, moved: false });
    else first.id = null;
    if (e.clientX < innerWidth * 0.45 && joy.id === null) {
      Object.assign(joy, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
      joyEl.style.transform = `translate(${joy.ox}px,${joy.oy}px)`;
      joyEl.classList.add('act');
    } else if (look.id === null) {
      Object.assign(look, { id: e.pointerId, lx: e.clientX, ly: e.clientY });
    } else if (pinch.id === null) {
      Object.assign(pinch, { id: e.pointerId, x: e.clientX, y: e.clientY, d: Math.hypot(e.clientX - look.lx, e.clientY - look.ly) });
    }
    try { touch.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
  });
  touch.addEventListener('pointermove', (e) => {
    if (e.pointerId === first.id) {
      if (Math.hypot(e.clientX - first.x, e.clientY - first.y) > 14) first.moved = true;
      if (first.moved) first.id = null; else { first.x = e.clientX; first.y = e.clientY; }
    }
    if (e.pointerId === joy.id) {
      let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
      const l = Math.hypot(dx, dy), max = 56;
      if (l > max) { dx *= max / l; dy *= max / l; }
      joy.x = dx / max; joy.y = dy / max;
      knob.style.transform = `translate(${dx}px,${dy}px)`;
    } else if (e.pointerId === look.id || e.pointerId === pinch.id) {
      if (pinch.id !== null) { // two fingers: spread to zoom in, pinch to zoom out
        if (e.pointerId === look.id) { look.lx = e.clientX; look.ly = e.clientY; } else { pinch.x = e.clientX; pinch.y = e.clientY; }
        const d = Math.hypot(pinch.x - look.lx, pinch.y - look.ly);
        onZoom((pinch.d - d) * 4);
        pinch.d = d;
      } else {
        onLook(e.clientX - look.lx, e.clientY - look.ly);
        look.lx = e.clientX; look.ly = e.clientY;
      }
    }
  });
  const end = (e) => {
    if (e.pointerId === first.id) first.id = null;
    if (e.pointerId === joy.id) joyRelease();
    if (e.pointerId === pinch.id) pinch.id = null;
    if (e.pointerId === look.id) { // the other finger keeps steering the camera
      if (pinch.id !== null) { Object.assign(look, { id: pinch.id, lx: pinch.x, ly: pinch.y }); pinch.id = null; } else look.id = null;
    }
  };
  touch.addEventListener('pointerup', end);
  touch.addEventListener('pointercancel', end);
  touch.addEventListener('wheel', (e) => { e.preventDefault(); onZoom(e.deltaY * (e.deltaMode === 1 ? 30 : 1)); }, { passive: false });

  addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return; // typing a sign or a name
    keys[e.code] = true;
    if (e.code === 'Space') { onJump(); e.preventDefault(); }
    if (e.code === 'KeyM') onMap();
    if (e.code === 'Equal' || e.code === 'NumpadAdd') onZoom(-120);
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') onZoom(120);
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
