// World generation: height, climate, biome and ground colour for any (x, z).
import { vnoise, fbm, clamp, mix, sstep } from './noise.js';

export const WATER_LEVEL = 0;

export function sample(x, z) {
  const c = fbm(x * 0.0011, z * 0.0011, 4); // continents
  let h = c * 62 + 6;
  h += fbm(x * 0.009 + 31, z * 0.009 - 17, 3) * 9 * clamp(h / 10, 0, 1); // hills
  const mm = sstep(0.04, 0.28, fbm(x * 0.0017 + 400, z * 0.0017 - 250, 3)); // mountain mask
  let r = 1 - Math.abs(vnoise(x * 0.0045 + 11, z * 0.0045 + 77));
  r = r * r * r;
  h += r * 78 * mm * clamp(h / 8, 0, 1); // ridges
  // mountain flanks: spurs and eroded gullies (ridged multifractal, domain-warped), crags up high
  const hi = mm * sstep(10, 34, h);
  if (hi > 0.001) {
    const wx = x + vnoise(x * 0.006 + 3, z * 0.006) * 40, wz = z + vnoise(x * 0.006, z * 0.006 - 5) * 40;
    let sum = 0, amp = 1, f = 0.011, prev = 1;
    for (let k = 0; k < 3; k++) {
      const n = 1 - Math.abs(vnoise(wx * f + k * 13.1, wz * f - k * 7.7));
      const v = n * n * prev;
      sum += v * amp; prev = clamp(v * 1.6, 0, 1); amp *= 0.45; f *= 2.1;
    }
    h += (sum - 0.42) * 15 * hi;
    const crag = Math.max(0, vnoise(x * 0.075 + 5, z * 0.075 - 2) - 0.15);
    h += (crag * crag * 7 + vnoise(x * 0.16, z * 0.16) * 0.6) * hi * sstep(22, 42, h);
  }
  const t = fbm(x * 0.0007 + 50, z * 0.0007 - 80, 3), m = fbm(x * 0.0009 - 200, z * 0.0009 + 130, 3);
  // deserts: long wind-built dunes, and red mesas rising in steep terraces
  const dw = desertWeight(t, m) * sstep(2, 7, h) * (1 - mm);
  if (dw > 0.001) {
    const u = x * 0.82 + z * 0.57, v = -x * 0.57 + z * 0.82, wob = fbm(x * 0.004 + 21, z * 0.004 - 5, 2);
    const ph = u * 0.03 + wob * 4 + v * 0.004;
    const crest = 1 - Math.abs(Math.sin(ph)); // sharp crests, wide troughs
    // dune fields swell and fade; a second, crossing set of smaller dunes breaks up the rows
    const field = 0.55 + 0.9 * (vnoise(x * 0.0025 + 8, z * 0.0025 - 3) * 0.5 + 0.5);
    const ph2 = (x * 0.31 - z * 0.95) * 0.05 + wob * 3;
    const crest2 = 1 - Math.abs(Math.sin(ph2));
    h += (crest * crest * 4.2 * field + crest2 * crest2 * crest2 * 1.6 + fbm(x * 0.012, z * 0.012, 2) * 1.5 + vnoise(x * 0.05, z * 0.05) * 0.45) * dw;
    // mesas: ragged, gully-cut cliff edges, tiers, and a skirt of talus at the foot
    const mn = fbm(x * 0.0045 - 333, z * 0.0045 + 71, 3) + vnoise(x * 0.03, z * 0.03) * 0.03 + vnoise(x * 0.09, z * 0.09) * 0.008;
    const mesa = sstep(0.115, 0.172, mn) * 2.4 + sstep(0.17, 0.195, mn) * 8 + sstep(0.27, 0.29, mn) * 7 + sstep(0.37, 0.385, mn) * 6
      + sstep(0.2, 0.26, mn) * vnoise(x * 0.04 - 9, z * 0.04) * 1.2; // weathered, uneven tops
    h += mesa * sstep(0.45, 0.8, dw);
  }
  const rv = Math.abs(fbm(x * 0.0022 + 900, z * 0.0022 - 300, 3));
  const rw = (1 - sstep(0.012, 0.05, rv)) * (1 - mm * 0.85) * (h > -1 ? 1 : 0); // rivers
  h = mix(h, -2.6, rw);
  // everyday unevenness: low swells and hummocks on dry land, fading out at the water's edge
  const land = sstep(1, 4, h) * (1 - rw);
  h += vnoise(x * 0.09, z * 0.09) * 0.5 + (fbm(x * 0.035 + 7, z * 0.035 - 3, 2) * 1.6 + vnoise(x * 0.14, z * 0.14) * 0.35) * land;
  return {
    h,
    t, // temperature
    m, // moisture
    riv: rw > 0.5,
  };
}

export const height = (x, z) => sample(x, z).h;

function desertWeight(t, m) { return sstep(0.06, 0.22, t) * sstep(0, -0.12, m); }

/** [desert, jungle, forest] blend weights from climate */
export function weights(s) {
  return [
    sstep(0.06, 0.22, s.t) * sstep(0, -0.12, s.m),
    sstep(0.02, 0.18, s.t) * sstep(0.04, 0.2, s.m),
    sstep(-0.16, 0, s.m),
  ];
}

export function biome(s) {
  if (s.h < -0.3) return s.riv ? 'river' : 'sea';
  if (s.h < 2.2) return 'beach';
  const [d, w, f] = weights(s);
  if (d > 0.5 && s.h < 52) return 'desert'; // mesas stay desert
  if (s.h > 56) return 'snow';
  if (s.h > 36) return 'mountain';
  if (w > 0.5) return 'jungle';
  return f > 0.5 ? 'forest' : 'meadow';
}

export const BIOME_NAME = {
  sea: '바다', river: '강', beach: '모래사장', desert: '사막', meadow: '초원',
  forest: '숲', jungle: '정글', mountain: '산', snow: '설산',
};

const C = {
  beach: [0.91, 0.83, 0.6], desert: [0.89, 0.71, 0.44], meadow: [0.47, 0.6, 0.33],
  forest: [0.29, 0.45, 0.23], jungle: [0.2, 0.4, 0.18], mountain: [0.5, 0.46, 0.42],
  snow: [0.95, 0.96, 0.98], deep: [0.3, 0.34, 0.3], mesa: [0.78, 0.45, 0.3],
};

export function groundColor(s, x, z, o) {
  const [d, w, f] = weights(s), v = 1 + vnoise(x * 0.2, z * 0.2) * 0.07;
  for (let k = 0; k < 3; k++) {
    let g = mix(C.meadow[k], C.forest[k], f);
    g = mix(g, C.jungle[k], w);
    g = mix(g, C.desert[k], d);
    g = mix(g, C.mountain[k], sstep(30, 40, s.h) * (1 - d));
    g = mix(g, C.snow[k], sstep(52, 60, s.h) * (1 - d));
    g = mix(g, C.mesa[k], d * sstep(10, 18, s.h) * 0.6); // higher desert ground reddens
    g = mix(C.beach[k], g, sstep(1.4, 3, s.h));
    g = mix(g, C.deep[k], sstep(0, -14, s.h));
    o[k] = g * v;
  }
  return o;
}

/** Splat weights for the terrain shader: grass, sand, rock, snow */
export function splat(s, o, k) {
  const d = weights(s)[0];
  const sn = sstep(52, 60, s.h) * (1 - d);
  const rk = sstep(30, 40, s.h) * (1 - sn) * (1 - d);
  const sd = clamp(Math.max(1 - sstep(1.4, 3, s.h), d) * (1 - rk - sn), 0, 1);
  o[k] = Math.max(0, 1 - sn - rk - sd);
  o[k + 1] = sd;
  o[k + 2] = rk;
  o[k + 3] = sn;
}
