// Exploration progress: revealed cells, XP / level, regions, biomes, HUD, toasts, save.
import { hash2 } from './noise.js';
import { sample, biome, BIOME_NAME } from './world.js';

export const CELL = 16;
const REVEAL = 3, REGION = 350, SAVE_KEY = 'mjdr-save';
const need = (l) => 60 + l * 45;
/** each level up to 6 makes you a little quicker on your feet: ×1.00 at Lv.1 … ×1.30 at Lv.6 */
export const PACE_MAX_LVL = 6, FISH_LVL = 3;
export const paceFor = (lvl) => 1 + 0.06 * (Math.min(lvl, PACE_MAX_LVL) - 1);

const ADJ = ['Whispering', 'Forgotten', 'Golden', 'Misty', 'Silent', 'Crimson', 'Starlit', 'Windswept', 'Ancient', 'Azure', 'Silver', 'Shadow', 'Dawn', 'Echoing'];
const NOUN = {
  sea: ['Sea', 'Bay', 'Strait'], river: ['River', 'Stream', 'Rapids'], beach: ['Coast', 'Sands', 'Sandbar'],
  desert: ['Desert', 'Dunes', 'Wastes'], meadow: ['Meadow', 'Fields', 'Hills'], forest: ['Forest', 'Woods', 'Trail'],
  jungle: ['Wilds', 'Jungle', 'Tangle'], mountain: ['Range', 'Peak', 'Highlands'], snow: ['Snowfields', 'Icecap', 'Frost Ridge'],
};
function regionName(rx, rz, b) {
  const a = hash2(rx * 13 + 5, rz * 29 - 7), c = hash2(rx - 3, rz * 3 + 1), ns = NOUN[b];
  return ADJ[Math.floor(a * ADJ.length)] + ' ' + ns[Math.floor(c * ns.length)];
}

export function createProgress() {
  const $ = (id) => document.getElementById(id);
  const st = { xp: 0, lvl: 1, items: {}, cells: new Set(), regions: new Set(), biomes: new Set() };
  let dirty = false, lastCell = '', lastPlace = '';
  const itemListeners = [];

  // toasts
  const queue = [];
  let busy = false;
  function next() {
    const q = queue.shift();
    if (!q) { busy = false; return; }
    busy = true;
    $('toastK').textContent = q[0]; $('toastT').textContent = q[1]; $('toastX').textContent = q[2];
    const el = $('toast');
    el.classList.add('on');
    setTimeout(() => { el.classList.remove('on'); setTimeout(next, 500); }, 2300);
  }
  const toast = (k, t, x) => { queue.push([k, t, x]); if (!busy) next(); };

  function hud() {
    const nd = need(st.lvl);
    $('lvl').textContent = 'Me Lv.' + st.lvl;
    $('xpbar').style.width = (st.xp / nd) * 100 + '%';
    $('xptxt').textContent = st.xp + ' / ' + nd + ' XP';
    $('area').textContent = areaKm2().toFixed(2) + ' km²';
  }
  const areaKm2 = () => (st.cells.size * CELL * CELL) / 1e6;

  function gain(n) {
    st.xp += n; dirty = true;
    while (st.xp >= need(st.lvl)) {
      st.xp -= need(st.lvl); st.lvl++;
      const note = st.lvl === FISH_LVL ? 'Fishing unlocked · a little quicker on your feet'
        : st.lvl <= PACE_MAX_LVL ? 'A little quicker on your feet' : 'Farther places are calling';
      toast('Level up', 'Me Lv.' + st.lvl, note);
    }
    hud();
  }

  function readSave() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; }
  }

  return {
    state: st,
    areaKm2,
    toast,
    gain,
    count: (id) => st.items[id] || 0,
    addItem(id, n) { st.items[id] = (st.items[id] || 0) + n; dirty = true; itemListeners.forEach((f) => f()); },
    /** remove n of an item; false (and nothing removed) if there aren't enough */
    takeItem(id, n) {
      if ((st.items[id] || 0) < n) return false;
      st.items[id] -= n; dirty = true; itemListeners.forEach((f) => f());
      return true;
    },
    onItems(f) { itemListeners.push(f); },
    hasSave() { const s = readSave(); return !!(s && s.cells && s.cells.length); },
    /** restore saved progress; returns saved position or null */
    load() {
      const s = readSave();
      if (!s) return null;
      st.xp = s.xp; st.lvl = s.lvl;
      st.items = s.items || (s.wood ? { wood: s.wood } : {});
      itemListeners.forEach((f) => f());
      st.cells = new Set(s.cells); st.regions = new Set(s.regions); st.biomes = new Set(s.biomes);
      hud();
      return { x: s.x, z: s.z };
    },
    reset() {
      st.xp = 0; st.lvl = 1; st.items = {}; itemListeners.forEach((f) => f()); st.cells.clear(); st.regions.clear(); st.biomes.clear();
      dirty = true; hud();
    },
    save(px, pz) {
      if (!dirty) return;
      dirty = false;
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({
          xp: st.xp, lvl: st.lvl, items: st.items, cells: [...st.cells], regions: [...st.regions], biomes: [...st.biomes], x: px, z: pz,
        }));
      } catch { /* storage unavailable */ }
    },
    /** reveal cells around the player, award XP, announce regions */
    explore(px, pz) {
      const ci = Math.floor(px / CELL), cj = Math.floor(pz / CELL), key = ci + ',' + cj;
      if (key !== lastCell) {
        lastCell = key;
        let n = 0;
        for (let j = -REVEAL; j <= REVEAL; j++) for (let i = -REVEAL; i <= REVEAL; i++) {
          if (i * i + j * j > REVEAL * REVEAL + 1) continue;
          const k = ci + i + ',' + (cj + j);
          if (!st.cells.has(k)) { st.cells.add(k); n++; }
        }
        if (n) gain(n);
      }
      const b = biome(sample(px, pz)), rx = Math.floor(px / REGION), rz = Math.floor(pz / REGION);
      const rk = rx + ',' + rz + ',' + b;
      if (rk !== lastPlace) {
        lastPlace = rk;
        const nm = regionName(rx, rz, b);
        $('placeName').textContent = nm;
        $('placeBiome').textContent = BIOME_NAME[b];
        if (!st.biomes.has(b)) { st.biomes.add(b); toast('New terrain', BIOME_NAME[b], '+100 XP'); gain(100); }
        else if (!st.regions.has(rk)) { toast('Region discovered', nm, '+25 XP'); gain(25); }
        st.regions.add(rk); dirty = true;
      }
    },
  };
}
