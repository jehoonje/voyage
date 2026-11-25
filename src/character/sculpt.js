// Tiny SDF sculpting kit: primitives, smooth booleans, and a surface-nets mesher.
// Pure maths (no three.js) so it runs inside a Web Worker.

export const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
export const smax = (a, b, k) => -smin(-a, -b, k);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** tapered capsule from a to b, radius ra → rb; also reports h (0..1 along the axis) */
export function cone(px, py, pz, a, b, ra, rb, out) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  if (out) out.h = h;
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h);
}
/** ellipsoid (approximate distance) */
export function ellipsoid(px, py, pz, c, r) {
  const x = (px - c[0]) / r[0], y = (py - c[1]) / r[1], z = (pz - c[2]) / r[2];
  const k0 = Math.sqrt(x * x + y * y + z * z);
  const x2 = x / r[0], y2 = y / r[1], z2 = z / r[2];
  const k1 = Math.sqrt(x2 * x2 + y2 * y2 + z2 * z2);
  return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2]);
}
export function roundBox(px, py, pz, c, half, r) {
  const qx = Math.abs(px - c[0]) - half[0] + r, qy = Math.abs(py - c[1]) - half[1] + r, qz = Math.abs(pz - c[2]) - half[2] + r;
  const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
  return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

/**
 * Surface nets over [min, max] at the given cell size.
 * A coarse pre-pass skips blocks far from the surface, which is most of the box.
 * Returns plain typed arrays: position, normal, index.
 */
export function meshRaw(sdf, min, max, cell) {
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1, ny = Math.ceil((max[1] - min[1]) / cell) + 1, nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const F = new Float32Array(nx * ny * nz);
  const id = (i, j, k) => i + nx * (j + ny * k);
  const S = 4, R = S * cell * 1.9; // block size in cells; "far" threshold (field is only roughly Lipschitz)
  const cx = Math.ceil((nx - 1) / S) + 1, cy = Math.ceil((ny - 1) / S) + 1, cz = Math.ceil((nz - 1) / S) + 1;
  const G = new Float32Array(cx * cy * cz);
  const gid = (i, j, k) => i + cx * (j + cy * k);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    G[gid(i, j, k)] = sdf(min[0] + Math.min(i * S, nx - 1) * cell, min[1] + Math.min(j * S, ny - 1) * cell, min[2] + Math.min(k * S, nz - 1) * cell);
  }
  for (let bk = 0; bk < cz - 1; bk++) for (let bj = 0; bj < cy - 1; bj++) for (let bi = 0; bi < cx - 1; bi++) {
    let far = true, lo = Infinity;
    for (let c = 0; c < 8; c++) {
      const v = G[gid(bi + (c & 1), bj + ((c >> 1) & 1), bk + ((c >> 2) & 1))];
      if (Math.abs(v) < R || (c && (v < 0) !== (lo < 0))) far = false;
      if (c === 0) lo = v;
    }
    const i0 = bi * S, j0 = bj * S, k0 = bk * S;
    const i1 = Math.min(i0 + S, nx - 1), j1 = Math.min(j0 + S, ny - 1), k1 = Math.min(k0 + S, nz - 1);
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      F[id(i, j, k)] = far ? lo : sdf(min[0] + i * cell, min[1] + j * cell, min[2] + k * cell);
    }
  }
  const vIndex = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [];
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const val = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = F[id(i + corner[c][0], j + corner[c][1], k + corner[c][2])];
      val[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((val[a] < 0) === (val[b] < 0)) continue;
      const t = val[a] / (val[a] - val[b]);
      sx += corner[a][0] + (corner[b][0] - corner[a][0]) * t;
      sy += corner[a][1] + (corner[b][1] - corner[a][1]) * t;
      sz += corner[a][2] + (corner[b][2] - corner[a][2]) * t;
      n++;
    }
    vIndex[id(i, j, k)] = pos.length / 3;
    pos.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
  }
  const idx = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, b, c, a, c, d); else idx.push(a, d, c, a, c, b);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const s0 = F[id(i, j, k)] < 0, s1 = F[id(i + 1, j, k)] < 0;
    if (s0 !== s1) quad(vIndex[id(i, j - 1, k - 1)], vIndex[id(i, j, k - 1)], vIndex[id(i, j, k)], vIndex[id(i, j - 1, k)], s0);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const s0 = F[id(i, j, k)] < 0, s1 = F[id(i, j + 1, k)] < 0;
    if (s0 !== s1) quad(vIndex[id(i - 1, j, k - 1)], vIndex[id(i - 1, j, k)], vIndex[id(i, j, k)], vIndex[id(i, j, k - 1)], s0);
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const s0 = F[id(i, j, k)] < 0, s1 = F[id(i, j, k + 1)] < 0;
    if (s0 !== s1) quad(vIndex[id(i - 1, j - 1, k)], vIndex[id(i, j - 1, k)], vIndex[id(i, j, k)], vIndex[id(i - 1, j, k)], s0);
  }
  const position = new Float32Array(pos);
  const normal = new Float32Array(pos.length), e = cell * 0.5;
  for (let v = 0; v < pos.length; v += 3) {
    const x = pos[v], y = pos[v + 1], z = pos[v + 2];
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    normal[v] = gx / l; normal[v + 1] = gy / l; normal[v + 2] = gz / l;
  }
  const index = position.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  return { position, normal, index };
}
