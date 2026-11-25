// Nature textures painted at startup on <canvas> — zero download size.
// Leaves, needles, fronds, bark, grass, flowers and reeds are drawn stroke by stroke
// with seeded randomness, so every session gets the same look.
import * as THREE from 'three';

let s = 1;
const seed = (v) => { s = (v * 9973 + 7) % 2147483647 || 1; };
const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
const between = (a, b) => a + (b - a) * rnd();
const hsl = (h, sa, l, a = 1) => `hsla(${h},${sa}%,${l}%,${a})`;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function toTexture(c, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** one leaf: pointed oval with a faint midrib */
function leaf(ctx, x, y, len, w, ang, fill, vein) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(w, -len * 0.45, 0, -len);
  ctx.quadraticCurveTo(-w, -len * 0.45, 0, 0);
  ctx.fillStyle = fill;
  ctx.fill();
  if (vein) {
    ctx.strokeStyle = vein; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len * 0.85); ctx.stroke();
  }
  ctx.restore();
}

/** a sprig of leaves on twigs, filling a ragged disc; top of the canvas = branch tip */
function leafCluster({ size = 256, count = 260, len = [13, 20], width = 0.38, hue = [85, 110], sat = [32, 52], light = [20, 40], twig = 2.4, id = 1 }) {
  seed(id);
  const [c, ctx] = canvas(size, size), R = size / 2, k = size / 256;
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    ctx.strokeStyle = hsl(28, 30, between(18, 28));
    ctx.lineWidth = (twig - i * 0.25) * k;
    ctx.beginPath();
    ctx.moveTo(R + between(-8, 8) * k, size);
    ctx.quadraticCurveTo(R + between(-0.25, 0.25) * size, size * 0.6, R + between(-0.38, 0.38) * size, size * between(0.12, 0.45));
    ctx.stroke();
  }
  for (let i = 0; i < count; i++) {
    const a = rnd() * 6.283, r = Math.sqrt(rnd()) * R * 0.9;
    const x = R + Math.cos(a) * r, y = R + Math.sin(a) * r * 0.95;
    const L = between(len[0], len[1]) * k;
    const top = 1 - y / size; // leaves near the tip catch more light
    const l = between(light[0], light[1]) * (0.75 + 0.45 * top);
    const h = between(hue[0], hue[1]), sa = between(sat[0], sat[1]);
    leaf(ctx, x, y, L, L * width, a + Math.PI / 2 + between(-0.6, 0.6), hsl(h, sa, l), hsl(h, sa - 10, l + 10, 0.5));
  }
  return toTexture(c);
}

/** pine branch seen from above: twig from the trunk (left) to the tip (right), needles fanning out */
function pineBranch(id = 3) {
  seed(id);
  const [c, ctx] = canvas(256, 128);
  ctx.lineCap = 'round';
  const twig = (x0, y0, x1, y1, n, nl) => {
    ctx.strokeStyle = hsl(25, 30, 20); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    for (let i = 0; i < n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, side = i % 2 ? 1 : -1;
      const ln = nl * (1 - t * 0.5) * between(0.7, 1.1), a = Math.atan2(y1 - y0, x1 - x0) + side * between(0.7, 1.1);
      ctx.strokeStyle = hsl(between(130, 155), between(25, 40), between(14, 30));
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * ln, y + Math.sin(a) * ln); ctx.stroke();
    }
  };
  twig(0, 64, 250, 64, 120, 26);
  for (let k = 0; k < 9; k++) {
    const x = 25 + k * 24, side = k % 2 ? 1 : -1;
    twig(x, 64, x + 40, 64 + side * between(28, 44), 30, 14);
  }
  return toTexture(c);
}

/** willow strands: long hanging lines of narrow leaves; top of canvas = attachment */
function willowStrands(id = 5) {
  seed(id);
  const [c, ctx] = canvas(128, 512);
  for (let k = 0; k < 7; k++) {
    let x = between(10, 118), y = 0;
    const drift = between(-0.15, 0.15);
    ctx.strokeStyle = hsl(40, 25, 30); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + drift * 500, between(380, 510)); ctx.stroke();
    while (y < 500) {
      y += between(5, 9);
      const xx = x + drift * y, len = between(16, 26);
      leaf(ctx, xx, y, len, len * 0.16, Math.PI + between(-0.5, 0.5), hsl(between(70, 92), between(35, 50), between(26, 46)));
      if (rnd() < 0.04) break;
    }
  }
  return toTexture(c);
}

/** palm frond: midrib along x, leaflets swept back on both sides */
function palmFrond(id = 6) {
  seed(id);
  const [c, ctx] = canvas(512, 128);
  ctx.strokeStyle = hsl(60, 30, 35); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 64); ctx.lineTo(505, 64); ctx.stroke();
  for (let x = 10; x < 500; x += 7) {
    const t = x / 512, len = 58 * Math.sin(Math.PI * Math.pow(t, 0.7)) + 6;
    for (const side of [-1, 1]) {
      ctx.strokeStyle = hsl(between(85, 105), between(35, 50), between(24, 40));
      ctx.lineWidth = 3.2 * (1 - t * 0.5);
      ctx.beginPath(); ctx.moveTo(x, 64);
      ctx.quadraticCurveTo(x + len * 0.3, 64 + side * len * 0.5, x + len * 0.55, 64 + side * len);
      ctx.stroke();
    }
  }
  return toTexture(c);
}

/** fern frond: thin rachis along x, rows of small rounded pinnae tapering to the tip */
function fernFrond(id = 21) {
  seed(id);
  const [c, ctx] = canvas(512, 128);
  ctx.strokeStyle = hsl(80, 35, 26); ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(0, 64); ctx.lineTo(500, 64); ctx.stroke();
  for (let x = 14; x < 495; x += 9) {
    const t = x / 512, len = 50 * Math.sin(Math.PI * Math.pow(t, 0.8)) + 4;
    for (const side of [-1, 1]) {
      const l = between(26, 40) * (0.8 + 0.4 * t), hu = between(92, 120);
      for (let k = 0; k < 6; k++) { // each pinna: a row of tiny lobes
        const u = k / 6, px = x + len * 0.25 * u, py = 64 + side * len * u;
        leaf(ctx, px, py, 9 * (1 - u * 0.5) + 3, 4, side > 0 ? Math.PI * 0.75 : Math.PI * 0.25, hsl(hu, between(38, 52), l));
      }
    }
  }
  return toTexture(c);
}

/** big tropical leaf (banana / elephant ear): stem at the bottom, broad blade with side veins */
function bigLeaf(id = 22) {
  seed(id);
  const [c, ctx] = canvas(256, 512);
  ctx.strokeStyle = hsl(85, 35, 30); ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(128, 512); ctx.lineTo(128, 330); ctx.stroke();
  const g = ctx.createLinearGradient(0, 330, 0, 10);
  g.addColorStop(0, hsl(105, 45, 22)); g.addColorStop(1, hsl(95, 50, 36));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(128, 335);
  ctx.bezierCurveTo(250, 300, 250, 90, 128, 8);
  ctx.bezierCurveTo(6, 90, 6, 300, 128, 335);
  ctx.fill();
  // tears where the wind has split the blade
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 7; i++) {
    const y = between(60, 300), side = rnd() < 0.5 ? -1 : 1;
    ctx.lineWidth = between(1.5, 3); ctx.beginPath(); ctx.moveTo(128 + side * 120, y - 20); ctx.lineTo(128 + side * between(40, 80), y); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = hsl(75, 35, 52, 0.7); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(128, 335); ctx.lineTo(128, 14); ctx.stroke();
  ctx.lineWidth = 1.2; ctx.strokeStyle = hsl(80, 30, 45, 0.45);
  for (let y = 40; y < 320; y += 14) for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(128, y + 10); ctx.quadraticCurveTo(128 + side * 50, y, 128 + side * 105, y - 18); ctx.stroke();
  }
  return toTexture(c);
}

/** bark: vertical fissures over a base colour; birch gets dark horizontal lenticels */
function bark({ base, dark, light, birch = false, id = 7 }) {
  seed(id);
  const [c, ctx] = canvas(128, 256);
  ctx.fillStyle = base; ctx.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * 128, y = rnd() * 256, h = between(10, 50);
    ctx.strokeStyle = rnd() < 0.5 ? dark : light;
    ctx.globalAlpha = between(0.15, 0.5);
    ctx.lineWidth = between(0.8, 2.5);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + between(-3, 3), y + h); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (birch) {
    for (let i = 0; i < 70; i++) {
      const x = rnd() * 128, y = rnd() * 256, w = between(6, 30);
      ctx.fillStyle = hsl(30, 10, between(8, 22));
      ctx.fillRect(x, y, w, between(1.5, 4.5));
    }
  }
  return toTexture(c, true);
}

/** a clump of tapered, curving blades rising from the bottom edge */
function blades({ size = 256, count = 80, hue = [72, 102], sat = [30, 52], light = [20, 44], dry = 0.12, minH = 0.45, w = 4, id = 9 }) {
  seed(id);
  const [c, ctx] = canvas(size, size);
  for (let i = 0; i < count; i++) {
    const x0 = between(0.08, 0.92) * size, h = between(minH, 0.98) * size, bend = between(-0.35, 0.35) * h, bw = between(0.6, 1.2) * w;
    const isDry = rnd() < dry;
    const col = isDry ? hsl(between(38, 52), between(30, 45), between(45, 62)) : hsl(between(hue[0], hue[1]), between(sat[0], sat[1]), between(light[0], light[1]));
    const g = ctx.createLinearGradient(0, size, 0, size - h);
    g.addColorStop(0, isDry ? hsl(40, 25, 30) : hsl(95, 40, 12));
    g.addColorStop(0.45, col);
    g.addColorStop(1, col);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0 - bw, size);
    ctx.quadraticCurveTo(x0 - bw * 0.5 + bend * 0.3, size - h * 0.55, x0 + bend, size - h);
    ctx.quadraticCurveTo(x0 + bw * 0.5 + bend * 0.3, size - h * 0.55, x0 + bw, size);
    ctx.fill();
  }
  return [c, ctx];
}

function grass() { return toTexture(blades({ id: 9 })[0]); }

function flowers() {
  const [c, ctx] = blades({ count: 26, light: [22, 36], w: 2, minH: 0.5, dry: 0, id: 10 });
  const colours = [[0, 0, 96], [50, 90, 62], [275, 50, 62], [330, 60, 72], [210, 60, 70]];
  seed(11);
  for (let i = 0; i < 22; i++) {
    const x = between(20, 236), y = between(20, 120), [h, sa, l] = colours[Math.floor(rnd() * colours.length)], r = between(3, 6);
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * 6.283;
      ctx.fillStyle = hsl(h, sa, l);
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8, r * 0.7, 0, 6.283); ctx.fill();
    }
    ctx.fillStyle = hsl(45, 90, 50);
    ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, 6.283); ctx.fill();
  }
  return toTexture(c);
}

function reeds() {
  const [c, ctx] = blades({ size: 256, count: 34, hue: [70, 95], sat: [25, 40], light: [22, 38], w: 2.2, minH: 0.7, dry: 0.15, id: 12 });
  seed(13);
  for (let i = 0; i < 6; i++) { // cattail heads
    const x = between(30, 226), y = between(10, 50);
    ctx.fillStyle = hsl(25, 45, between(18, 26));
    ctx.beginPath(); ctx.ellipse(x, y + 14, 4, 14, 0, 0, 6.283); ctx.fill();
    ctx.strokeStyle = hsl(60, 25, 30); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y + 28); ctx.lineTo(x + between(-6, 6), 256); ctx.stroke();
  }
  return toTexture(c);
}

let cache = null;
/** all textures, painted once */
export function natureTextures() {
  if (cache) return cache;
  cache = {
    broad: leafCluster({ id: 1 }),
    birch: leafCluster({ id: 2, count: 400, len: [8, 13], width: 0.42, hue: [68, 92], sat: [38, 55], light: [28, 50], twig: 1.4 }),
    jungle: leafCluster({ id: 4, count: 85, len: [40, 62], width: 0.5, hue: [95, 125], sat: [40, 55], light: [16, 34], twig: 3 }),
    bush: leafCluster({ id: 8, count: 300, len: [10, 16], width: 0.45, hue: [85, 115], sat: [30, 48], light: [18, 36] }),
    pine: pineBranch(),
    willow: willowStrands(),
    palm: palmFrond(),
    fern: fernFrond(),
    bigleaf: bigLeaf(),
    barkBrown: bark({ base: hsl(28, 22, 26), dark: hsl(25, 25, 12), light: hsl(30, 15, 42), id: 7 }),
    barkBirch: bark({ base: hsl(45, 12, 84), dark: hsl(40, 8, 60), light: hsl(45, 10, 95), birch: true, id: 14 }),
    barkPalm: bark({ base: hsl(32, 22, 42), dark: hsl(28, 25, 24), light: hsl(35, 18, 58), id: 15 }),
    grass: grass(),
    flowers: flowers(),
    reeds: reeds(),
  };
  return cache;
}
