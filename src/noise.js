// Deterministic hash + value noise. Same SEED → same world everywhere.
export const SEED = 20261125 | 0;

export function hash2(i, j) {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + SEED) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y);
  let fx = x - i, fy = y - j;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) * 2 - 1;
}

export function fbm(x, y, octaves) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let k = 0; k < octaves; k++) {
    s += a * vnoise(x * f + k * 17.3, y * f - k * 9.1);
    n += a; a *= 0.5; f *= 2.03;
  }
  return s / n;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const mix = (a, b, t) => a + (b - a) * t;
export function sstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
