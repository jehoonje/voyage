// Customisable hiker (feature-animation style, ~3.7 heads), as pure distance fields.
// Every slot (eyes, iris, hair, hat, top, bottom, shoes, accessories) is chosen and
// coloured on its own. No three.js here: the worker meshes these shapes off the main thread.
import { cone, ellipsoid, roundBox, smin, smax } from './sculpt.js';

const cl = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ================= skeleton landmarks (rest pose, model metres) ================= */
export const ARM = (s) => ({ sh: [s * 0.13, 0.672, 0], el: [s * 0.162, 0.53, -0.012], wr: [s * 0.176, 0.385, 0.008] });
export const LEG = (s) => ({ hip: [s * 0.058, 0.42, 0], kn: [s * 0.064, 0.23, 0.008], an: [s * 0.068, 0.088, 0] });
export const HEAD_PIVOT = [0, 0.88, 0];

/* ================= body ================= */
function torsoBody(x, y, z) {
  let d = ellipsoid(x, y, z, [0, 0.61, 0], [0.105, 0.13, 0.074]);
  d = smin(d, ellipsoid(x, y, z, [0, 0.47, 0], [0.1, 0.08, 0.074]), 0.05);
  // sloped shoulder line rather than a bar across the top
  for (const s of [-1, 1]) d = smin(d, cone(x, y, z, [0, 0.72, -0.005], [s * 0.112, 0.668, -0.005], 0.034, 0.026), 0.05);
  return d;
}
const armBody = (x, y, z, a) => smin(cone(x, y, z, a.sh, a.el, 0.027, 0.024), cone(x, y, z, a.el, a.wr, 0.023, 0.019), 0.02);
const legBody = (x, y, z, l) => smin(cone(x, y, z, l.hip, l.kn, 0.046, 0.03), cone(x, y, z, l.kn, l.an, 0.03, 0.021), 0.025);
const L0 = LEG(-1), L1 = LEG(1);
const bothLegs = (x, y, z) => Math.min(legBody(x, y, z, L0), legBody(x, y, z, L1));

const HC = [0, 1.02, 0.01];
function head(x, y, z) {
  let d = ellipsoid(x, y, z, HC, [0.166, 0.172, 0.162]);
  d = smin(d, ellipsoid(x, y, z, [0, 0.95, 0.055], [0.13, 0.1, 0.118]), 0.06); // cheeks
  d = smin(d, ellipsoid(x, y, z, [0, 0.885, 0.082], [0.055, 0.046, 0.055]), 0.04); // chin
  d = smin(d, ellipsoid(x, y, z, [0, 0.985, 0.168], [0.025, 0.026, 0.026]), 0.022); // nose
  for (const s of [-1, 1]) {
    d = smax(d, -ellipsoid(x, y, z, [s * 0.062, 1.03, 0.148], [0.046, 0.04, 0.036]), 0.02); // sockets
    let e = ellipsoid(x, y, z, [s * 0.172, 1.0, -0.015], [0.026, 0.06, 0.048]);
    e = smax(e, -ellipsoid(x, y, z, [s * 0.184, 1.0, 0], [0.013, 0.04, 0.03]), 0.008);
    d = smin(d, e, 0.02);
  }
  return smin(d, cone(x, y, z, [0, 0.7, -0.01], [0, 0.88, -0.005], 0.041, 0.044), 0.03); // neck
}
/** relaxed hand hanging at the side: palm toward the body, fingers loosely curled */
function hand(x, y, z, s) {
  const w = ARM(s).wr;
  const lx = (x - w[0]) * s, ly = y - w[1], lz = z - w[2]; // lx > 0 = away from the body
  let d = roundBox(lx, ly, lz, [0.002, -0.036, 0.004], [0.011, 0.03, 0.025], 0.01); // palm
  const fingers = [[-0.017, 0.038], [-0.006, 0.044], [0.006, 0.042], [0.017, 0.036]];
  for (const [fz, len] of fingers) {
    const base = [0.0, -0.062, fz + 0.004], mid = [-0.003, -0.062 - len * 0.6, fz + 0.006], tip = [-0.011, -0.062 - len, fz + 0.005];
    d = smin(d, smin(cone(lx, ly, lz, base, mid, 0.0072, 0.0064), cone(lx, ly, lz, mid, tip, 0.0064, 0.0055), 0.004), 0.005);
  }
  d = smin(d, smin(cone(lx, ly, lz, [-0.006, -0.018, 0.024], [-0.012, -0.04, 0.034], 0.0085, 0.0075),
    cone(lx, ly, lz, [-0.012, -0.04, 0.034], [-0.016, -0.058, 0.036], 0.0075, 0.0062), 0.004), 0.006); // thumb
  return smin(d, cone(lx, ly, lz, [0, 0.015, 0], [0, -0.012, 0.003], 0.02, 0.019), 0.012); // wrist
}
const hands = (x, y, z) => Math.min(hand(x, y, z, -1), hand(x, y, z, 1));

/* ================= garments ================= */
const tmp = {};
function makeTop(o) {
  const loose = o.loose ?? 0.022, hem = o.hem ?? 0.39;
  const arms = [ARM(-1), ARM(1)];
  return (x, y, z) => {
    let d = torsoBody(x, y, z) - loose;
    if (o.crinkle) d -= 0.0028 * Math.sin(x * 150 + y * 95) * Math.sin(z * 130 - y * 70);
    d -= 0.003 * Math.sin(y * 85 + Math.abs(x) * 25) * cl((0.55 - y) * 8, 0, 1); // folds at the waist
    if (o.cinch) d += 0.013 * Math.exp(-((y - hem - 0.014) ** 2) / 0.00025); // elastic hem
    if (o.hood !== 'none') d = smin(d, ellipsoid(x, y, z, [0, 0.745, -0.062], [0.1, 0.045, 0.06]), 0.03); // hood roll
    if (o.collar !== false) d = smin(d, smax(Math.abs(cone(x, y, z, [0, 0.69, 0], [0, 0.785, -0.005], 0.066, 0.056)) - 0.012, Math.max(0.69 - y, y - 0.785), 0.006), 0.02);
    for (const a of arms) {
      let sl = armBody(x, y, z, a) - (o.sleeve ?? 0.014);
      const lo = cone(x, y, z, a.el, a.wr, 0, 0, tmp), h2 = tmp.h, up = cone(x, y, z, a.sh, a.el, 0, 0);
      if (o.short) { cone(x, y, z, a.sh, a.el, 0, 0, tmp); sl = smax(sl, up < lo ? (tmp.h - 0.55) * 0.155 : 1, 0.008); }
      else {
        if (o.cuffCinch && up >= lo) sl -= 0.008 * Math.exp(-((h2 - 0.78) ** 2) / 0.006); // gathered above the cuff
        if (up >= lo) sl = smax(sl, (h2 - 0.93) * 0.15, 0.008);
      }
      d = smin(d, sl, 0.012 + 0.022 * cl((y - 0.6) / 0.1, 0, 1));
    }
    return smax(d, hem - y, 0.014);
  };
}
/** thin raised strip lying on a garment surface, limited by mask (negative inside) */
const strip = (g, mask, t = 0.0032) => (x, y, z) => smax(Math.abs(g(x, y, z) + 0.0016) - t, mask(x, y, z), 0.002);
/** colour zones cut out of a top (negative inside) */
const ZONES = {
  block: [(x, y) => 0.625 - y, (x, y) => smax(Math.abs(y - 0.47) - 0.04, 0.13 - Math.abs(x), 0.005)],
};

function makeBottom(o) {
  return (x, y, z) => {
    let d = ellipsoid(x, y, z, [0, 0.43, 0], [0.112, 0.07, 0.086]);
    for (const s of [-1, 1]) {
      const l = s < 0 ? L0 : L1;
      let g;
      if (o.type === 'shorts') {
        g = cone(x, y, z, l.hip, [l.hip[0] * 1.12, 0.27, 0.004], 0.064, 0.07);
      } else if (o.type === 'balloon') {
        g = smin(cone(x, y, z, l.hip, l.kn, 0.068, 0.072), cone(x, y, z, l.kn, [l.an[0], 0.14, 0.004], 0.072, 0.082), 0.03);
        g = smin(g, cone(x, y, z, [l.an[0], 0.14, 0.004], [l.an[0], 0.09, 0], 0.05, 0.036), 0.03); // gathered cuff
      } else { // wide
        g = smin(cone(x, y, z, l.hip, l.kn, 0.066, 0.062), cone(x, y, z, l.kn, l.an, 0.062, 0.066), 0.03);
        g -= 0.005 * Math.sin(y * 120) * cl((0.16 - y) * 14, 0, 1); // stacking at the hem
      }
      if (o.cargo) {
        const py = o.type === 'shorts' ? 0.33 : 0.27;
        g = smin(g, roundBox(x, y, z, [s * (o.type === 'shorts' ? 0.124 : 0.118), py, 0.0], [0.013, 0.042, 0.04], 0.012), 0.012);
        g = smin(g, roundBox(x, y, z, [s * (o.type === 'shorts' ? 0.13 : 0.125), py + 0.046, 0.0], [0.009, 0.008, 0.043], 0.005), 0.005);
      }
      d = smin(d, g, 0.03);
    }
    const end = o.type === 'shorts' ? 0.27 : o.type === 'balloon' ? 0.09 : 0.072;
    return smax(d, end - y, 0.01);
  };
}
const skirt = (x, y, z) => smax(smax(cone(x, y, z / 0.82, [0, 0.45, 0], [0, 0.29, 0], 0.11, 0.15) * 0.82 - 0.004, 0.29 - y, 0.01), y - 0.47, 0.01);
const leggings = (x, y, z) => smax(bothLegs(x, y, z) - 0.005, y - 0.44, 0.01);
const socks = (lo, hi) => (x, y, z) => smax(bothLegs(x, y, z) - 0.006, Math.max(lo - y, y - hi), 0.006);
function gaiters(x, y, z) { // bunched gaiters from the shoe to below the knee, ruffled top
  const d = bothLegs(x, y, z) - 0.026 - 0.006 * Math.sin(y * 70);
  return smax(d, Math.max(0.085 - y, y - 0.205 - 0.006 * Math.sin(Math.atan2(x, z) * 9)), 0.008);
}
function shoes(type) {
  return (x, y, z) => {
    let d = Infinity;
    for (const a of [L0.an, L1.an]) {
      let b;
      if (type === 'rain') b = smin(cone(x, y, z, [a[0], 0.215, -0.004], [a[0], 0.04, 0], 0.038, 0.044), ellipsoid(x, y, z, [a[0] * 1.04, 0.04, 0.05], [0.055, 0.04, 0.09]), 0.03);
      else if (type === 'boot') b = smin(cone(x, y, z, [a[0], 0.13, -0.006], [a[0], 0.04, 0], 0.035, 0.05), ellipsoid(x, y, z, [a[0] * 1.04, 0.042, 0.055], [0.056, 0.042, 0.092]), 0.03);
      else b = smin(cone(x, y, z, [a[0], 0.085, -0.01], [a[0], 0.04, 0], 0.036, 0.048), ellipsoid(x, y, z, [a[0] * 1.04, 0.04, 0.055], [0.055, 0.038, 0.092]), 0.03);
      d = Math.min(d, b);
    }
    return d;
  };
}
const soles = (x, y, z) => Math.min(roundBox(x, y, z, [L0.an[0] * 1.04, 0.009, 0.052], [0.051, 0.011, 0.096], 0.011), roundBox(x, y, z, [L1.an[0] * 1.04, 0.009, 0.052], [0.051, 0.011, 0.096], 0.011));

/* bags and straps */
const packBody = (big) => (x, y, z) => {
  let d = big ? roundBox(x, y, z, [0, 0.63, -0.19], [0.135, 0.22, 0.09], 0.07) : roundBox(x, y, z, [0, 0.56, -0.16], [0.11, 0.13, 0.055], 0.05);
  if (big) d = smin(d, ellipsoid(x, y, z, [0, 0.86, -0.18], [0.13, 0.045, 0.09]), 0.03);
  return smin(d, big ? roundBox(x, y, z, [0, 0.55, -0.285], [0.09, 0.08, 0.02], 0.02) : roundBox(x, y, z, [0, 0.52, -0.215], [0.075, 0.06, 0.012], 0.012), 0.02);
};
function straps(o) {
  return (x, y, z) => {
    const ax = Math.abs(x);
    let d = cone(ax, y, z, [0.068, 0.74, -0.1], [0.072, 0.762, 0.03], 0.011, 0.011);
    d = smin(d, cone(ax, y, z, [0.072, 0.762, 0.03], [0.076, 0.6, 0.106], 0.011, 0.011), 0.02);
    d = smin(d, cone(ax, y, z, [0.076, 0.6, 0.106], [0.11, 0.48, 0.07], 0.007, 0.007), 0.012);
    if (o.sternum) d = Math.min(d, cone(x, y, z, [-0.074, 0.645, 0.106], [0.074, 0.645, 0.106], 0.006, 0.006));
    if (o.hipBelt) {
      d = Math.min(d, smax(Math.abs(ellipsoid(x, y, z, [0, 0.455, -0.01], [0.13, 0.03, 0.1])) - 0.008, Math.abs(y - 0.455) - 0.016, 0.005));
      d = smin(d, roundBox(x, y, z, [0, 0.455, 0.1], [0.02, 0.013, 0.007], 0.003), 0.004);
    }
    return d;
  };
}
function vest(x, y, z) {
  let d = Infinity;
  for (const s of [-1, 1]) d = Math.min(d, roundBox(x, y, z, [s * 0.062, 0.6, 0.098], [0.038, 0.075, 0.016], 0.014));
  d = Math.min(d, roundBox(x, y, z, [0, 0.6, -0.11], [0.09, 0.1, 0.02], 0.02));
  const ax = Math.abs(x);
  return Math.min(d, cone(ax, y, z, [0.06, 0.7, -0.1], [0.062, 0.76, 0.0], 0.012, 0.012), cone(ax, y, z, [0.062, 0.76, 0.0], [0.062, 0.67, 0.1], 0.012, 0.012));
}
const slingBag = (x, y, z) => smin(cone(x, y, z, [-0.07, 0.69, 0.11], [0.1, 0.5, 0.13], 0.032, 0.058), cone(x, y, z, [-0.07, 0.69, 0.11], [-0.09, 0.76, 0.0], 0.012, 0.012), 0.02);
const slingStrap = (x, y, z) => cone(x, y, z, [-0.09, 0.76, -0.01], [0.13, 0.5, -0.1], 0.011, 0.011);
function torusRot(x, y, z, c, R, r, ang, zs = 0.75) { // ring around the body, tilted by ang about z
  const px = x - c[0], py = y - c[1], pz = (z - c[2]) / zs;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const rx = px * ca + py * sa, ry = -px * sa + py * ca;
  return Math.hypot(Math.hypot(rx, pz) - R, ry) - r;
}
const ropeSling = (x, y, z) => Math.min(torusRot(x, y, z, [0, 0.58, 0], 0.165, 0.008, -0.62), torusRot(x, y, z, [0.004, 0.565, 0], 0.17, 0.008, -0.6), torusRot(x, y, z, [-0.004, 0.595, 0], 0.16, 0.008, -0.64));
const ropeBelt = (x, y, z) => Math.min(torusRot(x, y, z, [0, 0.46, 0], 0.13, 0.0075, 0, 0.8), cone(x, y, z, [0.03, 0.46, 0.105], [0.05, 0.33, 0.11], 0.007, 0.007), cone(x, y, z, [0.02, 0.46, 0.105], [-0.01, 0.36, 0.115], 0.007, 0.007));
const phones = (x, y, z) => { const ax = Math.abs(x); return smin(smax(Math.abs(ellipsoid(x, y, z, [0, 1.03, -0.02], [0.2, 0.225, 0.05])) - 0.012, 1.03 - y, 0.01), cone(ax, y, z, [0.165, 0.995, -0.02], [0.21, 0.995, -0.02], 0.06, 0.055), 0.015); };
const glove = (fingerless) => (x, y, z) => Math.min(...[-1, 1].map((s) => smax(hand(x, y, z, s) - 0.0035, fingerless ? (ARM(s).wr[1] - 0.07) - y : -1, 0.003)));

/* ================= hats ================= */
const capCrown = (x, y, z, h = 0.15) => smax(ellipsoid(x, y, z, [0, 1.13, -0.02], [0.188, h, 0.194]), 1.12 - y + 0.05 * Math.max(0, -z), 0.02);
const brim = (len = 0.15, w = 0.15, drop = 0.25) => (x, y, z) => smax(ellipsoid(x, y, z, [0, 1.132 - Math.max(0, z - 0.12) * drop, 0.2], [w, 0.016, len]), 0.06 - z, 0.03);
const button = (x, y, z, top = 1.278) => ellipsoid(x, y, z, [0, top, -0.02], [0.02, 0.013, 0.02]);
const bucket = (x, y, z) => {
  const c = smax(cone(x, y, z, [0, 1.13, -0.015], [0, 1.25, -0.015], 0.195, 0.165), Math.max(1.13 - y, y - 1.25), 0.03);
  const b = smax(cone(x, y, z, [0, 1.14, -0.015], [0, 1.1, -0.015], 0.2, 0.27), Math.max(1.1 - y, y - 1.145), 0.006);
  return smin(c, b, 0.02);
};
const HAT_SDF = {
  ballcap: (x, y, z) => smin(smin(capCrown(x, y, z) - 0.003 * Math.abs(Math.sin(Math.atan2(x, z) * 3)), brim()(x, y, z), 0.03), button(x, y, z), 0.01),
  camp: (x, y, z) => smin(smax(roundBox(x, y, z, [0, 1.16, -0.02], [0.185, 0.07, 0.19], 0.08), 1.12 - y + 0.05 * Math.max(0, -z), 0.02), smax(roundBox(x, y, z, [0, 1.13, 0.25], [0.14, 0.006, 0.08], 0.006), 0.13 - z, 0.02), 0.02),
  plaidcap: (x, y, z) => smin(capCrown(x, y, z) - 0.003 * Math.abs(Math.sin(Math.atan2(x, z) * 3)), brim()(x, y, z), 0.03),
  mesh: (x, y, z) => smin(capCrown(x, y, z, 0.135), brim(0.12, 0.14, 0.4)(x, y, z), 0.03),
  bucket,
  rollbeanie: (x, y, z) => smin(smax(ellipsoid(x, y, z, [0, 1.12, -0.015], [0.188, 0.155, 0.19]), 1.13 - y, 0.02), smax(Math.abs(cone(x, y, z, [0, 1.12, -0.015], [0, 1.18, -0.015], 0.19, 0.18)) - 0.016, Math.abs(y - 1.15) - 0.03, 0.01), 0.01),
  pombeanie: (x, y, z) => smin(smin(smax(ellipsoid(x, y, z, [0, 1.1, -0.02], [0.19, 0.2, 0.195]), 1.04 - y + 0.05 * Math.max(0, -z), 0.02), smax(Math.abs(cone(x, y, z, [0, 1.04, -0.02], [0, 1.11, -0.02], 0.195, 0.19)) - 0.016, Math.max(1.04 - y, y - 1.11), 0.01), 0.01), ellipsoid(x, y, z, [0, 1.32, -0.03], [0.05, 0.05, 0.05]), 0.02),
  bandana: (x, y, z) => smin(smax(ellipsoid(x, y, z, [0, 1.09, -0.02], [0.186, 0.165, 0.19]), 1.07 - y + 0.12 * Math.max(0, -z), 0.015), Math.min(cone(x, y, z, [0, 1.02, -0.18], [-0.04, 0.93, -0.21], 0.02, 0.01), cone(x, y, z, [0, 1.02, -0.18], [0.04, 0.92, -0.2], 0.02, 0.01)), 0.02),
  visor: (x, y, z) => smin(smax(Math.abs(ellipsoid(x, y, z, [0, 1.12, -0.02], [0.19, 0.1, 0.195])) - 0.006, Math.abs(y - 1.13) - 0.022, 0.006), brim(0.14, 0.15, 0.3)(x, y, z), 0.02),
};
const goggles = (x, y, z) => {
  const band = smax(Math.abs(cone(x, y, z, [0, 1.17, -0.015], [0, 1.2, -0.015], 0.182, 0.172)) - 0.006, Math.abs(y - 1.185) - 0.012, 0.004);
  const lens = Math.min(...[-1, 1].map((s) => ellipsoid(x, y, z, [s * 0.055, 1.2, 0.165], [0.06, 0.03, 0.03])));
  return smin(band, lens, 0.01);
};

/* ================= hair ================= */
const faceCut = (x, y, z) => ellipsoid(x, y, z, [0, 0.965, 0.17], [0.162, 0.13, 0.15]);
const shell = (x, y, z, k = 0) => ellipsoid(x, y, z, [0, 1.07, -0.015], [0.178 + k, 0.16 + k, 0.176 + k]);
const open = (d, x, y, z) => smax(d, -faceCut(x, y, z), 0.025);
function braid(x, y, z, pts, r) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    for (let k = 0; k < 3; k++) {
      const t = (k + 0.5) / 3, c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const rr = r * (1 - (i * 3 + k) / (pts.length * 3) * 0.45);
      d = smin(d, ellipsoid(x, y, z, c, [rr, rr * 1.3, rr]), 0.006);
    }
  }
  return d;
}
const HAIR_SDF = {
  crop: (x, y, z) => smax(smin(open(shell(x, y, z), x, y, z), ellipsoid(x, y, z, [0.02, 1.13, 0.13], [0.1, 0.035, 0.05]), 0.03), 0.97 - y + 0.3 * Math.max(0, z), 0.02) - 0.002 * Math.sin(x * 200 + z * 120),
  sidepart: (x, y, z) => {
    let d = smin(open(shell(x, y, z), x, y, z), ellipsoid(x, y, z, [-0.04, 1.16, 0.06], [0.16, 0.075, 0.13]), 0.04);
    d = smax(d, -cone(x, y, z, [0.055, 1.25, 0.1], [0.06, 1.25, -0.12], 0.006, 0.006), 0.006); // part line
    return smax(d, 0.96 - y + 0.3 * Math.max(0, z), 0.02);
  },
  bob: (x, y, z) => {
    let d = smin(shell(x, y, z), ellipsoid(x, y, z, [0, 0.98, -0.025], [0.2, 0.15, 0.185]), 0.05);
    d = smin(d, ellipsoid(x, y, z, [0.02, 1.12, 0.13], [0.12, 0.04, 0.05]), 0.03);
    d -= 0.006 * Math.sin(Math.atan2(x, z) * 10 + y * 45);
    return smax(open(d, x, y, z), 0.86 - y, 0.02);
  },
  curly: (x, y, z) => {
    let d = shell(x, y, z, 0.01);
    for (const c of CURLS) d = smin(d, ellipsoid(x, y, z, c, [0.055, 0.06, 0.055]), 0.025);
    d -= 0.008 * Math.sin(x * 90) * Math.sin(y * 80) * Math.sin(z * 85);
    return smax(open(d, x, y, z), 0.68 - y, 0.02);
  },
  long: (x, y, z) => {
    let d = smin(shell(x, y, z), roundBox(x, y, z, [0, 0.86, -0.1], [0.175, 0.2, 0.08], 0.07), 0.05);
    d = smax(d, -cone(x, y, z, [0, 1.25, 0.12], [0, 1.22, -0.12], 0.005, 0.005), 0.005); // centre part
    d -= 0.002 * Math.sin(x * 260);
    return smax(open(d, x, y, z), 0.68 - y, 0.02);
  },
  ponytail: (x, y, z) => {
    let d = smax(open(shell(x, y, z), x, y, z), 0.97 - y + 0.3 * Math.max(0, z), 0.02);
    d = smin(d, ellipsoid(x, y, z, [0.03, 1.13, 0.13], [0.11, 0.035, 0.05]), 0.03);
    return smin(d, smin(cone(x, y, z, [0, 1.15, -0.17], [0, 1.0, -0.25], 0.045, 0.042), cone(x, y, z, [0, 1.0, -0.25], [0, 0.78, -0.22], 0.042, 0.016), 0.03), 0.02);
  },
  sidebraid: (x, y, z) => {
    let d = smax(open(shell(x, y, z), x, y, z), 0.95 - y + 0.25 * Math.max(0, z), 0.02);
    d = smin(d, ellipsoid(x, y, z, [-0.03, 1.13, 0.13], [0.11, 0.035, 0.05]), 0.03);
    return smin(d, braid(x, y, z, [[0.12, 0.98, -0.06], [0.16, 0.86, 0.0], [0.15, 0.74, 0.06], [0.13, 0.62, 0.08]], 0.035), 0.02);
  },
  spiky: (x, y, z) => {
    let d = smax(open(shell(x, y, z, -0.004), x, y, z), 0.98 - y + 0.3 * Math.max(0, z), 0.02);
    for (const [bx, bz, i] of SPIKES) d = smin(d, cone(x, y, z, [bx, 1.2, bz], [bx * 1.3, 1.27 + (i % 3) * 0.012, bz * 1.3 + 0.02], 0.028, 0.004), 0.015);
    return d;
  },
  bun: (x, y, z) => {
    let d = smax(open(shell(x, y, z), x, y, z), 0.97 - y + 0.3 * Math.max(0, z), 0.02);
    d = smin(d, ellipsoid(x, y, z, [0.02, 1.13, 0.13], [0.11, 0.035, 0.05]), 0.03);
    return smin(d, ellipsoid(x, y, z, [0, 1.25, -0.06], [0.07, 0.06, 0.07]) - 0.004 * Math.sin(Math.atan2(x, z - 0.06) * 8), 0.02);
  },
  twinbraid: (x, y, z) => {
    let d = smax(open(shell(x, y, z), x, y, z), 0.95 - y + 0.25 * Math.max(0, z), 0.02);
    d = smax(d, -cone(x, y, z, [0, 1.25, 0.12], [0, 1.22, -0.12], 0.005, 0.005), 0.005);
    for (const s of [-1, 1]) d = smin(d, braid(x, y, z, [[s * 0.13, 0.96, -0.07], [s * 0.15, 0.86, -0.02], [s * 0.14, 0.74, 0.04], [s * 0.125, 0.64, 0.06]], 0.03), 0.02);
    return d;
  },
};
const CURLS = [[-0.17, 0.98, 0.02], [0.17, 0.98, 0.02], [-0.18, 0.9, -0.04], [0.18, 0.9, -0.04], [-0.15, 0.82, -0.08], [0.15, 0.82, -0.08], [-0.08, 0.86, -0.17], [0.08, 0.86, -0.17], [0, 0.8, -0.18], [-0.12, 0.74, -0.12], [0.12, 0.74, -0.12], [0, 0.95, -0.2], [-0.1, 1.1, 0.14], [0.06, 1.13, 0.14]];
const SPIKES = Array.from({ length: 16 }, (_, i) => { const a = i * 2.4, r = 0.04 + (i % 4) * 0.025; return [Math.cos(a) * r, Math.sin(a) * r - 0.01, i]; });

/* ================= catalogs (names are what the player sees) ================= */
export const SKIN_TONES = [0xf4cfb2, 0xf0c2a2, 0xe0a882, 0xd8a07a, 0xc68a62, 0xb07a56, 0x9a6444, 0x86583c, 0x6e4430, 0x553324];
export const HAIR_COLORS = [0x1a1614, 0x2a1e16, 0x3a2818, 0x4a3020, 0x6a4026, 0x8a5a32, 0xb24a2a, 0xd8b06a, 0xe0c878, 0x9a9a9a, 0xe8e4dc, 0x3a4a6a];
export const IRIS_COLORS = [0x2c2420, 0x3a2a1c, 0x5a3a22, 0x6a4a2c, 0x7a5a30, 0x4a6a3a, 0x3a6a6a, 0x2c4e78, 0x5a6a7a, 0x6a3a5a];
export const GEAR_COLORS = [0x1c1e20, 0x2e2f31, 0x4a4a52, 0x8a8e96, 0xb4b4ba, 0xe8e4da, 0xccb996, 0xa69c86, 0x9a7440, 0x6b6a4f, 0x5f5a36, 0x6e7260, 0x8b9182,
  0x4a8a7a, 0x2aa8c8, 0x2c4e78, 0x1e2c48, 0x6c5a82, 0x5a4688, 0x963c78, 0xd03c78, 0xc84a4a, 0xc4622c, 0xd06a2a, 0xc9a032, 0xb4ac2c, 0xc8f040, 0xffffff];

/** eye shapes; iris colour is chosen separately */
export const EYES = {
  almond: { name: '기본 아몬드' },
  round: { name: '동그란 큰 눈', scale: [1.12, 1.18], cover: 0.5, irisSize: 0.7 },
  droopy: { name: '순한 처진 눈', tilt: -0.28, brow: -0.25 },
  upturned: { name: '올라간 눈', tilt: 0.3, scale: [1.08, 0.9], brow: 0.2 },
  sleepy: { name: '졸린 눈', cover: 0.98 },
  smile: { name: '웃는 눈', smile: true },
  narrow: { name: '가늘고 긴 눈', scale: [1.2, 0.8], cover: 0.74, lash: 1.2 },
  lash: { name: '긴 속눈썹', lash: 2.4, flick: true, scale: [1.05, 1.05] },
  sparkle: { name: '반짝이는 눈', scale: [1.1, 1.12], cover: 0.5, shine: 2, irisSize: 0.72 },
  soft: { name: '부드러운 눈', scale: [1.04, 1.04], cover: 0.58, tilt: -0.1, lower: 0.35 },
};
export const HAIR = {
  crop: { name: '크롭 숏' }, sidepart: { name: '사이드 파트' }, bob: { name: '웨이브 단발' }, curly: { name: '곱슬 장발' }, long: { name: '롱 스트레이트' },
  ponytail: { name: '포니테일', tie: [0, 1.15, -0.17] }, sidebraid: { name: '사이드 브레이드' }, spiky: { name: '스파이크 숏' }, bun: { name: '올림머리 번' }, twinbraid: { name: '양갈래 브레이드' },
};
export const HATS = {
  none: { name: '없음' },
  ballcap: { name: '볼캡' }, camp: { name: '캠프 캡' }, plaidcap: { name: '체크 캡', tex: 'plaid', texScale: 9 }, mesh: { name: '메쉬 러닝캡', tex: 'mesh' },
  bucket: { name: '버킷햇' }, rollbeanie: { name: '롤업 비니', tex: 'knit' }, pombeanie: { name: '방울 니트 비니', tex: 'knit', cut: 1.05 },
  bandana: { name: '두건' }, visor: { name: '바이저' },
};
/** tops: geometry params in g; accent is the zip/trim colour unless noted */
export const TOPS = {
  black: { name: '블랙 립스톱 재킷', g: { tex: 'ripstop' }, c: 0x2e2f31, accent: 0x6a6a6a, accentName: '지퍼' },
  shell: { name: '하드셸', g: { tex: 'ripstop', pitZips: true }, c: 0x8b9182, accent: 0xe8e4da, accentName: '지퍼' },
  block: { name: '블록 컬러 셸', g: { tex: 'ripstop', zones: 'block' }, c: 0x5f5a36, accent: 0x22262a, accentName: '어깨 배색' },
  wind: { name: '크링클 윈드 재킷', g: { tex: 'crinkle', crinkle: true, loose: 0.026 }, c: 0xccb996, accent: 0x2a2a2a, accentName: '지퍼' },
  windbreaker: { name: '윈드브레이커', g: { tex: 'crinkle', crinkle: true, cinch: true, hem: 0.42, cuffCinch: true }, c: 0xc4622c, accent: 0x2aa8a0, accentName: '지퍼' },
  cinched: { name: '스트링 셸', g: { tex: 'crinkle', crinkle: true, cinch: true, hem: 0.41 }, c: 0x6c5a82, accent: 0x24364a, accentName: '지퍼' },
  armband: { name: '암밴드 셸', g: { tex: 'ripstop', cinch: true, hem: 0.4, armband: true }, c: 0xb4b4ba, accent: 0xc8f040, accentName: '암밴드' },
  softshell: { name: '소프트셸', g: { tex: 'cotton', hem: 0.36 }, c: 0x963c78, accent: 0x6a6ac8, accentName: '지퍼' },
  knit: { name: '니트 + 티셔츠', g: { tex: 'knit', loose: 0.008, collar: false, hood: 'none', tee: true }, c: 0x8a8e96, accent: 0x9fc4e0, accentName: '티셔츠' },
};
export const BOTTOMS = {
  wide: { name: '와이드 팬츠', g: { type: 'wide' }, c: 0xa69c86 },
  cargo: { name: '와이드 카고', g: { type: 'wide', cargo: true }, c: 0x6b6a4f },
  camo: { name: '카모 카고', g: { type: 'wide', cargo: true }, tex: 'camo', c: 0xffffff },
  balloon: { name: '벌룬 카고', g: { type: 'balloon', cargo: true }, c: 0x6e7260 },
  shorts: { name: '쇼츠', g: { type: 'shorts' }, c: 0x4a4a52 },
  cargoshorts: { name: '카고 쇼츠', g: { type: 'shorts', cargo: true }, c: 0x9a7440 },
  skirt: { name: '스커트 + 이너 쇼츠', g: { type: 'skirt' }, tex: 'floral', c: 0xffffff },
};
export const SHOES = {
  trail: { name: '트레일 러너', g: { type: 'trail' }, tex: 'mesh', c: 0x5a5a56, sole: 0x2a2a28 },
  camo: { name: '카모 트레일', g: { type: 'trail' }, tex: 'camo', c: 0x6a6e62, sole: 0x2a2a28 },
  boot: { name: '하이킹 부츠', g: { type: 'boot' }, tex: 'cotton', c: 0x3a3a38, sole: 0x1e1e1e },
  rain: { name: '레인 부츠', g: { type: 'rain' }, tex: 'cotton', c: 0xe6da8a, sole: 0xc8bc6a },
};
/** accessories: toggled on/off; one per group at most. c2 is the strap/trim colour where present */
export const ACCESSORIES = {
  phones: { name: '헤드폰', c: 0x1c1c1e },
  goggles: { name: '고글', c: 0xe0583a, cName: '렌즈' },
  gloves: { name: '장갑', group: 'glove', c: 0xd8a040 },
  fingerless: { name: '반장갑', group: 'glove', c: 0x30b0c8 },
  socks: { name: '발목 양말', group: 'socks', c: 0x6a6a3a },
  longsocks: { name: '긴 양말', group: 'socks', c: 0xd03c78 },
  gaiters: { name: '게이터', c: 0x55555c },
  leggings: { name: '레깅스', c: 0x8a8e98 },
  daypack: { name: '데이팩', group: 'bag', c: 0x26282a, c2: 0x1c1e20 },
  bigpack: { name: '대형 배낭', group: 'bag', c: 0x2c3034, c2: 0x1c1e20 },
  campack: { name: '카모 배낭', group: 'bag', tex: 'olivecamo', c: 0xffffff, c2: 0x3a3d38 },
  vest: { name: '하네스 베스트', group: 'bag', c: 0x1e2022 },
  sling: { name: '슬링백', group: 'bag', c: 0xb8bcc0, c2: 0xb8bcc0 },
  rope: { name: '로프 슬링', c: 0xc8f040 },
  ropeBelt: { name: '로프 벨트', c: 0x9a8ad8 },
};

export const DEFAULT_SPEC = {
  skin: 0xf0c2a2, eyes: 'almond', iris: 0x5a3a22, freckles: false,
  hair: 'bob', hairColor: 0x4a3020,
  hat: 'plaidcap', hatColor: 0xffffff,
  top: 'black', topColor: 0x2e2f31, topAccent: 0x6a6a6a,
  bottom: 'camo', bottomColor: 0xffffff,
  shoes: 'camo', shoesColor: 0x6a6e62, soleColor: 0x2a2a28,
  acc: { phones: { c: 0x1c1c1e }, campack: { c: 0xffffff, c2: 0x3a3d38 } },
};

/* ================= part shapes ================= */
const BOX = {
  top: [[-0.24, 0.33, -0.13], [0.24, 0.8, 0.13]], bottom: [[-0.17, 0.06, -0.12], [0.17, 0.52, 0.12]], legs: [[-0.12, 0.05, -0.06], [0.12, 0.46, 0.06]],
  shoes: [[-0.15, -0.01, -0.07], [0.15, 0.23, 0.17]], head: [[-0.22, 0.68, -0.2], [0.22, 1.21, 0.21]], hair: [[-0.26, 0.6, -0.3], [0.26, 1.33, 0.25]], hat: [[-0.3, 1.0, -0.28], [0.3, 1.4, 0.38]],
  bag: [[-0.2, 0.38, -0.33], [0.2, 0.93, 0.15]], hands: [[-0.21, 0.26, -0.04], [0.21, 0.41, 0.06]],
};
const unite = (a, b) => (x, y, z) => Math.min(a(x, y, z), b(x, y, z));

/**
 * The distance field, bounds, cell size and bone group for one part.
 * Params are plain data so the same request can be sent to a worker.
 */
export function partShape(kind, p = {}) {
  switch (kind) {
    case 'head': return { sdf: head, box: BOX.head, cell: 0.0035, bones: 'head' };
    case 'hands': return { sdf: hands, box: BOX.hands, cell: 0.0022, bones: 'hands' };
    case 'legs': return { sdf: bothLegs, box: BOX.legs, cell: 0.004, bones: 'legs' };
    case 'top': case 'topZone': {
      const f = makeTop(p.g), zones = ZONES[p.g.zones] || [];
      let sdf = f;
      if (kind === 'topZone') { const m = zones[p.zone]; sdf = (x, y, z) => smax(f(x, y, z), m(x, y, z), 0.002); }
      else if (zones.length) sdf = (x, y, z) => smax(f(x, y, z), -Math.min(...zones.map((m) => m(x, y, z))), 0.002);
      return { sdf, box: BOX.top, cell: 0.0045, bones: 'top' };
    }
    case 'zip': {
      const f = makeTop(p.g);
      let det = strip(f, (x, y, z) => Math.max(Math.abs(x) - 0.0035, -z));
      if (p.g.pitZips) det = unite(det, strip(f, (x, y, z) => Math.max(Math.abs(Math.abs(x) - 0.06 - (0.62 - y) * 0.05) - 0.003, Math.abs(y - 0.58) - 0.06, -z)));
      return { sdf: det, box: [[-0.12, 0.36, 0.0], [0.12, 0.8, 0.14]], cell: 0.003, bones: 'top' };
    }
    case 'armband': return { sdf: strip(makeTop(p.g), (x, y) => Math.max(Math.abs(y - 0.6) - 0.02, 0.125 - x), 0.005), box: [[0.08, 0.5, -0.08], [0.24, 0.7, 0.08]], cell: 0.003, bones: 'top' };
    case 'tee': return { sdf: makeTop({ loose: 0.016, short: true, hood: 'none', collar: false, hem: 0.37 }), box: BOX.top, cell: 0.0045, bones: 'top' };
    case 'bottom': return { sdf: makeBottom(p.g), box: BOX.bottom, cell: 0.0045, bones: 'bottom' };
    case 'skirt': return { sdf: skirt, box: [[-0.2, 0.26, -0.15], [0.2, 0.5, 0.15]], cell: 0.0045, bones: 'skirt' };
    case 'leggings': return { sdf: leggings, box: BOX.legs, cell: 0.004, bones: 'legs' };
    case 'socks': return { sdf: socks(p.lo, p.hi), box: BOX.legs, cell: 0.004, bones: 'legs' };
    case 'gaiters': return { sdf: gaiters, box: BOX.legs, cell: 0.004, bones: 'legs' };
    case 'shoes': return { sdf: shoes(p.type), box: BOX.shoes, cell: 0.0045, bones: 'feet' };
    case 'soles': return { sdf: soles, box: BOX.shoes, cell: 0.004, bones: 'feet' };
    case 'glove': return { sdf: glove(p.fingerless), box: BOX.hands, cell: 0.0025, bones: 'hands' };
    case 'pack': return { sdf: packBody(p.big), box: BOX.bag, cell: 0.005, bones: 'chest' };
    case 'straps': return { sdf: straps(p), box: BOX.bag, cell: 0.0032, bones: p.hipBelt ? 'harness' : 'chest' };
    case 'vest': return { sdf: vest, box: BOX.bag, cell: 0.004, bones: 'chest' };
    case 'sling': return { sdf: slingBag, box: BOX.bag, cell: 0.004, bones: 'chest' };
    case 'slingStrap': return { sdf: slingStrap, box: BOX.bag, cell: 0.0035, bones: 'chest' };
    case 'rope': return { sdf: ropeSling, box: [[-0.26, 0.38, -0.18], [0.26, 0.8, 0.18]], cell: 0.003, bones: 'chest' };
    case 'ropeBelt': return { sdf: ropeBelt, box: [[-0.17, 0.3, -0.14], [0.17, 0.5, 0.14]], cell: 0.003, bones: 'hips' };
    case 'phones': return { sdf: phones, box: [[-0.26, 0.92, -0.1], [0.26, 1.28, 0.06]], cell: 0.0035, bones: 'skull' };
    case 'goggles': return { sdf: goggles, box: [[-0.22, 1.13, -0.22], [0.22, 1.25, 0.22]], cell: 0.003, bones: 'skull' };
    case 'hat': return { sdf: HAT_SDF[p.hat], box: BOX.hat, cell: 0.0042, bones: 'skull' };
    case 'hair': {
      const f = HAIR_SDF[p.hair];
      const sdf = p.cut ? (x, y, z) => smax(f(x, y, z), y - p.cut - Math.max(0, -z) * 0.05, 0.01) : f;
      return { sdf, box: BOX.hair, cell: 0.0042, bones: 'hair' };
    }
  }
  throw new Error('unknown part ' + kind);
}
