// Exploration progress: revealed cells, XP / level, regions, biomes, HUD, toasts, save.
import { hash2 } from './noise.js';
import { sample, biome, BIOME_NAME } from './world.js';
import { store } from './store.js';
import { perksFor, PERKS } from './perks.js';
import { serverNow } from './clock.js';

export const CELL = 16;
export const REGION = 350;
const SAVE_KEY = 'mjdr-save';
/** materials don't take a bag slot; everything else (each kind of fish…) takes one */
const NO_SLOT = new Set(['wood']);
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
export function regionName(rx, rz, b) {
  const a = hash2(rx * 13 + 5, rz * 29 - 7), c = hash2(rx - 3, rz * 3 + 1), ns = NOUN[b];
  return ADJ[Math.floor(a * ADJ.length)] + ' ' + ns[Math.floor(c * ns.length)];
}

export function createProgress() {
  const $ = (id) => document.getElementById(id);
  // codex: per fish { n, best (cm), where (terrain of the first one) }; buffs: { speed|bite: { until (server ms), k } }
  const st = { xp: 0, lvl: 1, items: {}, cells: new Set(), regions: new Set(), biomes: new Set(), codex: {}, buffs: {}, name: '', guideDone: false };
  let dirty = false, lastCell = '', lastPlace = '', perks = perksFor(st.biomes);
  const itemListeners = [], regionListeners = [];
  const refreshPerks = () => { perks = perksFor(st.biomes); itemListeners.forEach((f) => f()); };
  const slotsUsed = () => Object.keys(st.items).filter((k) => st.items[k] > 0 && !NO_SLOT.has(k)).length;

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
    return store.get(SAVE_KEY);
  }

  return {
    state: st,
    areaKm2,
    toast,
    gain,
    count: (id) => st.items[id] || 0,
    /** add n of an item; false if it's a new kind and every bag slot is taken */
    addItem(id, n) {
      if (!st.items[id] && !NO_SLOT.has(id) && slotsUsed() >= perks.slots) return false;
      st.items[id] = (st.items[id] || 0) + n; dirty = true; itemListeners.forEach((f) => f());
      return true;
    },
    get perks() { return perks; },
    slots: () => ({ used: slotsUsed(), max: perks.slots }),
    /** note a catch in the field guide; returns { first, record } */
    logCatch(species, cm, where) {
      const c = st.codex[species] || (st.codex[species] = { n: 0, best: 0, where });
      const first = c.n === 0, record = !first && cm > c.best, prev = c.best;
      c.n++; c.best = Math.max(c.best, cm); dirty = true;
      return { first, record, prev };
    },
    /** a food buff: kind 'speed' | 'bite', k = strength, for secs */
    addBuff(kind, k, secs) {
      const now = serverNow(), cur = st.buffs[kind];
      const left = cur && cur.until > now ? cur.until - now : 0;
      st.buffs[kind] = { k: Math.max(k, cur && left ? cur.k : 0), until: now + Math.max(left, secs * 1000) };
      dirty = true;
    },
    /** current strength of a buff (0 if none), and ms left */
    buff(kind) { const b = st.buffs[kind]; const left = b ? b.until - serverNow() : 0; return left > 0 ? { k: b.k, left } : { k: 0, left: 0 }; },
    setName(n) { st.name = n; dirty = true; },
    setGuideDone() { st.guideDone = true; dirty = true; },
    /** f(regionKey, name, isNewForMe) when the player walks into a region */
    onRegion(f) { regionListeners.push(f); },
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
      st.codex = s.codex || {}; st.buffs = s.buffs || {}; if (s.name) st.name = s.name;
      st.guideDone = s.guideDone ?? (s.lvl >= 2); // saves from before the guide: only new-ish players get it
      refreshPerks();
      hud();
      return { x: s.x, z: s.z };
    },
    reset() {
      st.xp = 0; st.lvl = 1; st.items = {}; st.cells.clear(); st.regions.clear(); st.biomes.clear(); st.codex = {}; st.buffs = {}; st.guideDone = false;
      refreshPerks();
      dirty = true; hud();
    },
    save(px, pz) {
      if (!dirty) return;
      dirty = false;
      store.set(SAVE_KEY, {
        xp: st.xp, lvl: st.lvl, items: st.items, cells: [...st.cells], regions: [...st.regions], biomes: [...st.biomes], x: px, z: pz,
        codex: st.codex, buffs: st.buffs, name: st.name, guideDone: st.guideDone,
      });
    },
    /** reveal cells around the player, award XP, announce regions */
    explore(px, pz) {
      const ci = Math.floor(px / CELL), cj = Math.floor(pz / CELL), key = ci + ',' + cj;
      if (key !== lastCell) {
        lastCell = key;
        let n = 0;
        const R = perks.reveal;
        for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
          if (i * i + j * j > R * R + 1) continue;
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
        const isNew = !st.regions.has(rk);
        if (!st.biomes.has(b)) { st.biomes.add(b); refreshPerks(); toast('New terrain', BIOME_NAME[b], PERKS[b].text + ' · +100 XP'); gain(100); }
        else if (isNew) { toast('Region discovered', nm, '+25 XP'); gain(25); }
        st.regions.add(rk); dirty = true;
        regionListeners.forEach((f) => f(rk, nm, isNew));
      }
    },
  };
}
