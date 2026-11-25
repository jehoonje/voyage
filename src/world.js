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
  const rv = Math.abs(fbm(x * 0.0022 + 900, z * 0.0022 - 300, 3));
  const rw = (1 - sstep(0.012, 0.05, rv)) * (1 - mm * 0.85) * (h > -1 ? 1 : 0); // rivers
  h = mix(h, -2.6, rw);
  h += vnoise(x * 0.09, z * 0.09) * 0.5;
  return {
    h,
    t: fbm(x * 0.0007 + 50, z * 0.0007 - 80, 3), // temperature
    m: fbm(x * 0.0009 - 200, z * 0.0009 + 130, 3), // moisture
    riv: rw > 0.5,
  };
}

export const height = (x, z) => sample(x, z).h;

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
  if (s.h > 56) return 'snow';
  if (s.h > 36) return 'mountain';
  const [d, w, f] = weights(s);
  if (d > 0.5) return 'desert';
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
  snow: [0.95, 0.96, 0.98], deep: [0.3, 0.34, 0.3],
};

export function groundColor(s, x, z, o) {
  const [d, w, f] = weights(s), v = 1 + vnoise(x * 0.2, z * 0.2) * 0.07;
  for (let k = 0; k < 3; k++) {
    let g = mix(C.meadow[k], C.forest[k], f);
    g = mix(g, C.jungle[k], w);
    g = mix(g, C.desert[k], d);
    g = mix(g, C.mountain[k], sstep(30, 40, s.h));
    g = mix(g, C.snow[k], sstep(52, 60, s.h));
    g = mix(C.beach[k], g, sstep(1.4, 3, s.h));
    g = mix(g, C.deep[k], sstep(0, -14, s.h));
    o[k] = g * v;
  }
  return o;
}

/** Splat weights for the terrain shader: grass, sand, rock, snow */
export function splat(s, o, k) {
  const sn = sstep(52, 60, s.h);
  const rk = sstep(30, 40, s.h) * (1 - sn);
  const d = weights(s)[0];
  const sd = clamp(Math.max(1 - sstep(1.4, 3, s.h), d) * (1 - rk - sn), 0, 1);
  o[k] = Math.max(0, 1 - sn - rk - sd);
  o[k + 1] = sd;
  o[k + 2] = rk;
  o[k + 3] = sn;
}
