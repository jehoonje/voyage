// Full-screen exploration map: only revealed cells are drawn. Drag / pinch / wheel to navigate.
import { clamp, mix, sstep } from './noise.js';
import { sample, groundColor } from './world.js';
import { CELL } from './progress.js';

const LEGEND = [['Forest', '#527f3a'], ['Jungle', '#30702b'], ['Meadow', '#94bf59'], ['Desert', '#e3b570'],
  ['Beach', '#e8d499'], ['Mountain', '#80766b'], ['Snowy peak', '#f2f4f7'], ['Water', '#3f8fc4']];

export function createMap(progress, getPlayer) {
  const $ = (id) => document.getElementById(id);
  const el = $('map'), cv = $('mapCv'), ctx = cv.getContext('2d');
  const st = progress.state;
  let open = false, zoom = 6, cx = 0, cz = 0, raf = 0;
  const colors = new Map(), tmp = [0, 0, 0];

  $('legend').innerHTML = LEGEND.map(([n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('');

  function cellColor(i, j, k) {
    let c = colors.get(k);
    if (c) return c;
    const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL, s = sample(x, z);
    if (s.h < 0) {
      const t = sstep(0, -18, s.h);
      c = `rgb(${mix(96, 26, t) | 0},${mix(170, 78, t) | 0},${mix(205, 140, t) | 0})`;
    } else {
      groundColor(s, x, z, tmp);
      c = `rgb(${(tmp[0] * 255) | 0},${(tmp[1] * 255) | 0},${(tmp[2] * 255) | 0})`;
    }
    colors.set(k, c);
    return c;
  }

  function draw() {
    const dpr = Math.min(devicePixelRatio, 2), w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1c1914';
    ctx.fillRect(0, 0, w, h);
    const i0 = Math.floor(cx - w / 2 / zoom) - 1, i1 = Math.ceil(cx + w / 2 / zoom) + 1;
    const j0 = Math.floor(cz - h / 2 / zoom) - 1, j1 = Math.ceil(cz + h / 2 / zoom) + 1;
    for (let j = j0; j <= j1; j++) {
      const sy = h / 2 + (j - cz) * zoom;
      for (let i = i0; i <= i1; i++) {
        const k = i + ',' + j;
        if (!st.cells.has(k)) continue;
        ctx.fillStyle = cellColor(i, j, k);
        ctx.fillRect(w / 2 + (i - cx) * zoom, sy, zoom + 0.6, zoom + 0.6);
      }
    }
    const p = getPlayer();
    const px = w / 2 + (p.x / CELL - cx) * zoom, py = h / 2 + (p.z / CELL - cz) * zoom;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(Math.cos(p.face), Math.sin(p.face)));
    ctx.beginPath();
    ctx.moveTo(11, 0); ctx.lineTo(-7, -7); ctx.lineTo(-3, 0); ctx.lineTo(-7, 7); ctx.closePath();
    ctx.fillStyle = '#f0b24a'; ctx.strokeStyle = '#2a1a06'; ctx.lineWidth = 2;
    ctx.fill(); ctx.stroke();
    ctx.restore();
    $('mapStat').textContent = `Revealed ${progress.areaKm2().toFixed(2)} km² · ${st.regions.size} regions found · ${st.biomes.size}/9 terrains`;
  }
  const request = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  const center = () => { const p = getPlayer(); cx = p.x / CELL; cz = p.z / CELL; };

  function toggle() {
    open = !open;
    el.hidden = !open;
    if (open) { center(); request(); }
  }
  $('closeMap').addEventListener('click', toggle);
  $('zin').addEventListener('click', () => { zoom = Math.min(24, zoom * 1.5); request(); });
  $('zout').addEventListener('click', () => { zoom = Math.max(1.5, zoom / 1.5); request(); });
  $('zme').addEventListener('click', () => { center(); request(); });

  const ptrs = new Map();
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); });
  cv.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const p = ptrs.get(e.pointerId);
    if (ptrs.size === 1) {
      cx -= (e.clientX - p[0]) / zoom; cz -= (e.clientY - p[1]) / zoom;
    } else {
      const o = [...ptrs.entries()].find(([k]) => k !== e.pointerId)[1];
      const d0 = Math.hypot(p[0] - o[0], p[1] - o[1]), d1 = Math.hypot(e.clientX - o[0], e.clientY - o[1]);
      if (d0 > 0) zoom = clamp((zoom * d1) / d0, 1.5, 24);
    }
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    request();
  });
  const up = (e) => ptrs.delete(e.pointerId);
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { zoom = clamp(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1.5, 24); request(); }, { passive: true });
  addEventListener('resize', () => { if (open) request(); });

  return { toggle, request, get open() { return open; } };
}
