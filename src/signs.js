// Signposts: a post with a board; the text (and who wrote it) is painted onto a canvas texture.
import * as THREE from 'three';

const postGeo = new THREE.BoxGeometry(0.09, 1.25, 0.09).translate(0, 0.62, 0);
const boardGeo = new THREE.BoxGeometry(0.95, 0.5, 0.05);
const postMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2c });

/** wrap to at most 3 lines that fit the board */
function wrap(ctx, text, max) {
  const words = text.split(/\s+/), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= max) cur = t;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  // a single long word (no spaces, e.g. Korean without spaces) is broken by characters
  return lines.flatMap((l) => {
    if (ctx.measureText(l).width <= max) return [l];
    const out = []; let s = '';
    for (const ch of l) { if (ctx.measureText(s + ch).width > max) { out.push(s); s = ch; } else s += ch; }
    return s ? [...out, s] : out;
  }).slice(0, 3);
}

function boardTexture(text, by) {
  const cv = document.createElement('canvas'); cv.width = 384; cv.height = 200;
  const c = cv.getContext('2d');
  c.fillStyle = '#a77a4a'; c.fillRect(0, 0, 384, 200);
  c.strokeStyle = 'rgba(70,40,20,.35)'; c.lineWidth = 2;
  for (let y = 18; y < 200; y += 26) { c.beginPath(); c.moveTo(0, y + Math.sin(y) * 3); c.bezierCurveTo(120, y - 4, 260, y + 5, 384, y); c.stroke(); }
  c.fillStyle = '#2b1a0c'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = '600 34px system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  const lines = wrap(c, text, 350);
  lines.forEach((l, i) => c.fillText(l, 192, 82 + (i - (lines.length - 1) / 2) * 40));
  c.font = '20px system-ui, sans-serif'; c.fillStyle = 'rgba(43,26,12,.75)';
  c.fillText('— ' + by, 192, 178);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 4;
  return tex;
}

export function createSigns(scene) {
  const signs = new Map(); // id → sign
  return {
    get list() { return [...signs.values()]; },
    has: (id) => signs.has(id),
    /** s: { id, x, y, z, face, text, ownerName, mine } */
    add(s) {
      if (signs.has(s.id)) return signs.get(s.id);
      const g = new THREE.Group();
      g.position.set(s.x, s.y - 0.05, s.z); g.rotation.y = s.face || 0;
      const post = new THREE.Mesh(postGeo, postMat); post.castShadow = true;
      const tex = boardTexture(s.text, s.ownerName || 'someone');
      const face = new THREE.MeshLambertMaterial({ map: tex }), edge = new THREE.MeshLambertMaterial({ color: 0x7a5532 });
      const board = new THREE.Mesh(boardGeo, [edge, edge, edge, edge, face, face]);
      board.position.set(0, 1.08, 0.06); board.castShadow = true;
      g.add(post, board); scene.add(g);
      const o = { ...s, g, tex, mats: [face, edge] };
      signs.set(s.id, o);
      return o;
    },
    remove(id) {
      const o = signs.get(id); if (!o) return;
      scene.remove(o.g); o.tex.dispose(); o.mats.forEach((m) => m.dispose());
      signs.delete(id);
    },
    /** the nearest sign within r */
    nearest(x, z, r) {
      let best = null, bd = r * r;
      for (const o of signs.values()) { const d = (o.x - x) ** 2 + (o.z - z) ** 2; if (d < bd) { bd = d; best = o; } }
      return best;
    },
    /** drop signs far away (they're loaded again when you come back) */
    prune(x, z, R) { for (const o of [...signs.values()]) if ((o.x - x) ** 2 + (o.z - z) ** 2 > R * R) this.remove(o.id); },
  };
}
