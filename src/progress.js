// Exploration progress: revealed cells, XP / level, regions, biomes, HUD, toasts, save.
import { hash2 } from './noise.js';
import { sample, biome, BIOME_NAME } from './world.js';

export const CELL = 16;
const REVEAL = 3, REGION = 350, SAVE_KEY = 'mjdr-save';
const need = (l) => 60 + l * 45;

const ADJ = ['속삭이는', '잊혀진', '황금빛', '안개 낀', '고요한', '붉은', '별빛', '바람의', '오래된', '푸른', '은빛', '그림자', '새벽의', '메아리치는'];
const NOUN = {
  sea: ['바다', '만', '해협'], river: ['강', '강줄기', '여울'], beach: ['해안', '백사장', '모래톱'],
  desert: ['사막', '모래언덕', '황야'], meadow: ['초원', '들판', '언덕'], forest: ['숲', '수림', '숲길'],
  jungle: ['밀림', '정글', '덩굴숲'], mountain: ['산맥', '봉우리', '고원'], snow: ['설산', '빙봉', '얼음능선'],
};
function regionName(rx, rz, b) {
  const a = hash2(rx * 13 + 5, rz * 29 - 7), c = hash2(rx - 3, rz * 3 + 1), ns = NOUN[b];
  return ADJ[Math.floor(a * ADJ.length)] + ' ' + ns[Math.floor(c * ns.length)];
}

export function createProgress() {
  const $ = (id) => document.getElementById(id);
  const st = { xp: 0, lvl: 1, cells: new Set(), regions: new Set(), biomes: new Set() };
  let dirty = false, lastCell = '', lastPlace = '';

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
    $('lvl').textContent = '탐험가 Lv.' + st.lvl;
    $('xpbar').style.width = (st.xp / nd) * 100 + '%';
    $('xptxt').textContent = st.xp + ' / ' + nd + ' XP';
    $('area').textContent = areaKm2().toFixed(2) + ' km²';
  }
  const areaKm2 = () => (st.cells.size * CELL * CELL) / 1e6;

  function gain(n) {
    st.xp += n; dirty = true;
    while (st.xp >= need(st.lvl)) {
      st.xp -= need(st.lvl); st.lvl++;
      toast('레벨 업', '탐험가 Lv.' + st.lvl, '더 먼 곳이 당신을 부릅니다');
    }
    hud();
  }

  function readSave() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; }
  }

  return {
    state: st,
    areaKm2,
    hasSave() { const s = readSave(); return !!(s && s.cells && s.cells.length); },
    /** restore saved progress; returns saved position or null */
    load() {
      const s = readSave();
      if (!s) return null;
      st.xp = s.xp; st.lvl = s.lvl;
      st.cells = new Set(s.cells); st.regions = new Set(s.regions); st.biomes = new Set(s.biomes);
      hud();
      return { x: s.x, z: s.z };
    },
    reset() {
      st.xp = 0; st.lvl = 1; st.cells.clear(); st.regions.clear(); st.biomes.clear();
      dirty = true; hud();
    },
    save(px, pz) {
      if (!dirty) return;
      dirty = false;
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({
          xp: st.xp, lvl: st.lvl, cells: [...st.cells], regions: [...st.regions], biomes: [...st.biomes], x: px, z: pz,
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
        if (!st.biomes.has(b)) { st.biomes.add(b); toast('새로운 지형', BIOME_NAME[b], '+100 XP'); gain(100); }
        else if (!st.regions.has(rk)) { toast('새 지역 발견', nm, '+25 XP'); gain(25); }
        st.regions.add(rk); dirty = true;
      }
    },
  };
}
