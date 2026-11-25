// Customisable hiker (feature-animation style, ~3.7 heads).
// One shared body; eyes, hat, hair and outfit are swappable parts with their own colours.
// Every garment is a sculpted distance field meshed once and cached.
import * as THREE from 'three';
import { cone, ellipsoid, roundBox, smin, smax, mesh } from './sculpt.js';

const cl = (v, a, b) => (v < a ? a : v > b ? b : v);
const tmp = {};

/* ================= skeleton landmarks (rest pose, metres) ================= */
const ARM = (s) => ({ sh: [s * 0.135, 0.685, 0], el: [s * 0.162, 0.53, -0.012], wr: [s * 0.176, 0.385, 0.008] });
const LEG = (s) => ({ hip: [s * 0.058, 0.42, 0], kn: [s * 0.064, 0.23, 0.008], an: [s * 0.068, 0.088, 0] });

/* ================= body ================= */
function torsoBody(x, y, z) {
  let d = ellipsoid(x, y, z, [0, 0.61, 0], [0.105, 0.13, 0.074]);
  d = smin(d, ellipsoid(x, y, z, [0, 0.47, 0], [0.1, 0.08, 0.074]), 0.05);
  return smin(d, cone(x, y, z, [-0.12, 0.69, -0.005], [0.12, 0.69, -0.005], 0.036, 0.036), 0.05);
}
const armBody = (x, y, z, a) => smin(cone(x, y, z, a.sh, a.el, 0.031, 0.026), cone(x, y, z, a.el, a.wr, 0.025, 0.02), 0.02);
const legBody = (x, y, z, l) => smin(cone(x, y, z, l.hip, l.kn, 0.046, 0.03), cone(x, y, z, l.kn, l.an, 0.03, 0.021), 0.025);
const bothLegs = (x, y, z) => Math.min(legBody(x, y, z, LEG(-1)), legBody(x, y, z, LEG(1)));

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

/* ================= garments ================= */
function makeTop(o) {
  const loose = o.loose ?? 0.022, hem = o.hem ?? 0.39;
  return (x, y, z) => {
    let d = torsoBody(x, y, z) - loose;
    if (o.crinkle) d -= 0.0028 * Math.sin(x * 150 + y * 95) * Math.sin(z * 130 - y * 70);
    d -= 0.003 * Math.sin(y * 85 + Math.abs(x) * 25) * cl((0.55 - y) * 8, 0, 1); // folds at the waist
    if (o.cinch) d += 0.013 * Math.exp(-((y - hem - 0.014) ** 2) / 0.00025); // elastic hem
    if (o.hood !== 'none') d = smin(d, ellipsoid(x, y, z, [0, 0.745, -0.062], [0.1, 0.045, 0.06]), 0.03); // hood roll
    if (o.collar !== false) d = smin(d, smax(Math.abs(cone(x, y, z, [0, 0.69, 0], [0, 0.785, -0.005], 0.066, 0.056)) - 0.012, Math.max(0.69 - y, y - 0.785), 0.006), 0.02);
    for (const s of [-1, 1]) {
      const a = ARM(s);
      let sl = armBody(x, y, z, a) - (o.sleeve ?? 0.016);
      const lo = cone(x, y, z, a.el, a.wr, 0, 0, tmp), h2 = tmp.h, up = cone(x, y, z, a.sh, a.el, 0, 0);
      if (o.short) { cone(x, y, z, a.sh, a.el, 0, 0, tmp); sl = smax(sl, up < lo ? (tmp.h - 0.55) * 0.155 : 1, 0.008); }
      else {
        if (o.cuffCinch && up >= lo) sl -= 0.008 * Math.exp(-((h2 - 0.78) ** 2) / 0.006); // gathered above the cuff
        if (up >= lo) sl = smax(sl, (h2 - 0.93) * 0.15, 0.008);
      }
      d = smin(d, sl, 0.01 + 0.045 * cl((y - 0.6) / 0.1, 0, 1));
    }
    return smax(d, hem - y, 0.014);
  };
}
/** thin raised strip lying on a garment surface, limited by mask (negative inside) */
const strip = (g, mask, t = 0.0032) => (x, y, z) => smax(Math.abs(g(x, y, z) + 0.0016) - t, mask(x, y, z), 0.002);

function makeBottom(o) {
  return (x, y, z) => {
    let d = ellipsoid(x, y, z, [0, 0.43, 0], [0.112, 0.07, 0.086]);
    for (const s of [-1, 1]) {
      const l = LEG(s);
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
const skirt = (x, y, z) => smax(smax(cone(x, y * 1, z / 0.82, [0, 0.45, 0], [0, 0.29, 0], 0.11, 0.15) * 0.82 - 0.004, 0.29 - y, 0.01), y - 0.47, 0.01);
const leggings = (x, y, z) => smax(bothLegs(x, y, z) - 0.005, y - 0.44, 0.01);
const socks = (lo, hi) => (x, y, z) => smax(bothLegs(x, y, z) - 0.006, Math.max(lo - y, y - hi), 0.006);
function gaiters(x, y, z) { // bunched gaiters from the shoe to below the knee, ruffled top
  let d = bothLegs(x, y, z) - 0.026 - 0.006 * Math.sin(y * 70);
  return smax(d, Math.max(0.085 - y, y - 0.205 - 0.006 * Math.sin(Math.atan2(x, z) * 9)), 0.008);
}
function shoes(type) {
  return (x, y, z) => {
    let d = Infinity;
    for (const s of [-1, 1]) {
      const a = LEG(s).an;
      let b;
      if (type === 'rain') b = smin(cone(x, y, z, [a[0], 0.215, -0.004], [a[0], 0.04, 0], 0.038, 0.044), ellipsoid(x, y, z, [a[0] * 1.04, 0.04, 0.05], [0.055, 0.04, 0.09]), 0.03);
      else if (type === 'boot') b = smin(cone(x, y, z, [a[0], 0.13, -0.006], [a[0], 0.04, 0], 0.035, 0.05), ellipsoid(x, y, z, [a[0] * 1.04, 0.042, 0.055], [0.056, 0.042, 0.092]), 0.03);
      else b = smin(cone(x, y, z, [a[0], 0.085, -0.01], [a[0], 0.04, 0], 0.036, 0.048), ellipsoid(x, y, z, [a[0] * 1.04, 0.04, 0.055], [0.055, 0.038, 0.092]), 0.03);
      d = Math.min(d, b);
    }
    return d;
  };
}
const soles = (x, y, z) => Math.min(...[-1, 1].map((s) => roundBox(x, y, z, [LEG(s).an[0] * 1.04, 0.009, 0.052], [0.051, 0.011, 0.096], 0.011)));

/* bags and straps */
const packBody = (big) => (x, y, z) => {
  let d = big ? roundBox(x, y, z, [0, 0.63, -0.19], [0.135, 0.22, 0.09], 0.07) : roundBox(x, y, z, [0, 0.56, -0.16], [0.11, 0.13, 0.055], 0.05);
  if (big) d = smin(d, ellipsoid(x, y, z, [0, 0.86, -0.18], [0.13, 0.045, 0.09]), 0.03);
  d = smin(d, big ? roundBox(x, y, z, [0, 0.55, -0.285], [0.09, 0.08, 0.02], 0.02) : roundBox(x, y, z, [0, 0.52, -0.215], [0.075, 0.06, 0.012], 0.012), 0.02);
  return d;
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
  d = Math.min(d, cone(ax, y, z, [0.06, 0.7, -0.1], [0.062, 0.76, 0.0], 0.012, 0.012), cone(ax, y, z, [0.062, 0.76, 0.0], [0.062, 0.67, 0.1], 0.012, 0.012));
  return d;
}
const slingBag = (x, y, z) => smin(cone(x, y / 1, z, [-0.07, 0.69, 0.11], [0.1, 0.5, 0.13], 0.032, 0.058) , cone(x, y, z, [-0.07, 0.69, 0.11], [-0.09, 0.76, 0.0], 0.012, 0.012), 0.02);
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
export const HATS = {
  ballcap: { name: '볼캡', sdf: (x, y, z) => smin(smin(capCrown(x, y, z) - 0.003 * Math.abs(Math.sin(Math.atan2(x, z) * 3)), brim()(x, y, z), 0.03), button(x, y, z), 0.01) },
  camp: { name: '캠프 캡', sdf: (x, y, z) => smin(smax(roundBox(x, y, z, [0, 1.16, -0.02], [0.185, 0.07, 0.19], 0.08), 1.12 - y + 0.05 * Math.max(0, -z), 0.02), smax(roundBox(x, y, z, [0, 1.13, 0.25], [0.14, 0.006, 0.08], 0.006), 0.13 - z, 0.02), 0.02) },
  plaidcap: { name: '체크 캡', sdf: (x, y, z) => smin(capCrown(x, y, z) - 0.003 * Math.abs(Math.sin(Math.atan2(x, z) * 3)), brim()(x, y, z), 0.03) },
  mesh: { name: '메쉬 러닝캡', sdf: (x, y, z) => smin(capCrown(x, y, z, 0.135), brim(0.12, 0.14, 0.4)(x, y, z), 0.03) },
  bucket: { name: '버킷햇', sdf: (x, y, z) => {
    const c = smax(cone(x, y, z, [0, 1.13, -0.015], [0, 1.25, -0.015], 0.195, 0.165), Math.max(1.13 - y, y - 1.25), 0.03);
    const b = smax(cone(x, y, z, [0, 1.14, -0.015], [0, 1.1, -0.015], 0.2, 0.27) , Math.max(1.1 - y, y - 1.145), 0.006);
    return smin(c, Math.abs(b) < 1 ? b - 0.0 : b, 0.02);
  } },
  bucketgoggle: { name: '버킷햇 + 고글', sdf: null, base: 'bucket', goggles: true },
  rollbeanie: { name: '롤업 비니', sdf: (x, y, z) => smin(smax(ellipsoid(x, y, z, [0, 1.12, -0.015], [0.188, 0.155, 0.19]), 1.13 - y, 0.02), smax(Math.abs(cone(x, y, z, [0, 1.12, -0.015], [0, 1.18, -0.015], 0.19, 0.18)) - 0.016, Math.abs(y - 1.15) - 0.03, 0.01), 0.01) },
  pombeanie: { name: '방울 니트 비니', cut: 1.05, sdf: (x, y, z) => smin(smin(smax(ellipsoid(x, y, z, [0, 1.1, -0.02], [0.19, 0.2, 0.195]), 1.04 - y + 0.05 * Math.max(0, -z), 0.02), smax(Math.abs(cone(x, y, z, [0, 1.04, -0.02], [0, 1.11, -0.02], 0.195, 0.19)) - 0.016, Math.max(1.04 - y, y - 1.11), 0.01), 0.01), ellipsoid(x, y, z, [0, 1.32, -0.03], [0.05, 0.05, 0.05]), 0.02) },
  bandana: { name: '두건', sdf: (x, y, z) => smin(smax(ellipsoid(x, y, z, [0, 1.09, -0.02], [0.186, 0.165, 0.19]), 1.07 - y + 0.12 * Math.max(0, -z), 0.015), Math.min(cone(x, y, z, [0, 1.02, -0.18], [-0.04, 0.93, -0.21], 0.02, 0.01), cone(x, y, z, [0, 1.02, -0.18], [0.04, 0.92, -0.2], 0.02, 0.01)), 0.02) },
  visor: { name: '바이저', sdf: (x, y, z) => smin(smax(Math.abs(ellipsoid(x, y, z, [0, 1.12, -0.02], [0.19, 0.1, 0.195])) - 0.006, Math.abs(y - 1.13) - 0.022, 0.006), brim(0.14, 0.15, 0.3)(x, y, z), 0.02) },
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
export const HAIR = {
  crop: { name: '크롭 숏', sdf: (x, y, z) => smax(smin(open(shell(x, y, z), x, y, z), ellipsoid(x, y, z, [0.02, 1.13, 0.13], [0.1, 0.035, 0.05]), 0.03), 0.97 - y + 0.3 * Math.max(0, z), 0.02) - 0.002 * Math.sin(x * 200 + z * 120) },
  sidepart: { name: '사이드 파트', sdf: (x, y, z) => {
    let d = smin(open(shell(x, y, z), x, y, z), ellipsoid(x, y, z, [-0.04, 1.16, 0.06], [0.16, 0.075, 0.13]), 0.04);
    d = smax(d, -cone(x, y, z, [0.055, 1.25, 0.1], [0.06, 1.25, -0.12], 0.006, 0.006), 0.006); // part line
    return smax(d, 0.96 - y + 0.3 * Math.max(0, z), 0.02);
  } },
  bob: { name: '웨이브 단발', sdf: (x, y, z) => {
    let d = smin(shell(x, y, z), ellipsoid(x, y, z, [0, 0.98, -0.025], [0.2, 0.15, 0.185]), 0.05);
    d = smin(d, ellipsoid(x, y, z, [0.02, 1.12, 0.13], [0.12, 0.04, 0.05]), 0.03);
    d -= 0.006 * Math.sin(Math.atan2(x, z) * 10 + y * 45);
    return smax(open(d, x, y, z), 0.86 - y, 0.02);
  } },
  curly: { name: '곱슬 장발', sdf: (x, y, z) => {
    let d = shell(x, y, z, 0.01);
    const curls = [[-0.17, 0.98, 0.02], [0.17, 0.98, 0.02], [-0.18, 0.9, -0.04], [0.18, 0.9, -0.04], [-0.15, 0.82, -0.08], [0.15, 0.82, -0.08], [-0.08, 0.86, -0.17], [0.08, 0.86, -0.17], [0, 0.8, -0.18], [-0.12, 0.74, -0.12], [0.12, 0.74, -0.12], [0, 0.95, -0.2], [-0.1, 1.1, 0.14], [0.06, 1.13, 0.14]];
    for (const c of curls) d = smin(d, ellipsoid(x, y, z, c, [0.055, 0.06, 0.055]), 0.025);
    d -= 0.008 * Math.sin(x * 90) * Math.sin(y * 80) * Math.sin(z * 85);
    return smax(open(d, x, y, z), 0.68 - y, 0.02);
  } },
  long: { name: '롱 스트레이트', sdf: (x, y, z) => {
    let d = smin(shell(x, y, z), roundBox(x, y, z, [0, 0.86, -0.1], [0.175, 0.2, 0.08], 0.07), 0.05);
    d = smax(d, -cone(x, y, z, [0, 1.25, 0.12], [0, 1.22, -0.12], 0.005, 0.005), 0.005); // centre part
    d -= 0.002 * Math.sin(x * 260);
    return smax(open(d, x, y, z), 0.68 - y, 0.02);
  } },
  ponytail: { name: '포니테일', sdf: (x, y, z) => {
    let d = smax(open(shell(x, y, z), x, y, z), 0.97 - y + 0.3 * Math.max(0, z), 0.02);
    d = smin(d, ellipsoid(x, y, z, [0.03, 1.13, 0.13], [0.11, 0.035, 0.05]), 0.03);
    d = smin(d, smin(cone(x, y, z, [0, 1.15, -0.17], [0, 1.0, -0.24], 0.045, 0.04), cone(x, y, z, [0, 1.0, -0.24], [0, 0.84, -0.22], 0.04, 0.018), 0.03), 0.02);
    return d;
  }, tie: [0, 1.15, -0.17] },
  sidebraid: { name: '사이드 브레이드', sdf: (x, y, z) => {
    let d = smax(open(shell(x, y, z), x, y, z), 0.95 - y + 0.25 * Math.max(0, z), 0.02);
    d = smin(d, ellipsoid(x, y, z, [-0.03, 1.13, 0.13], [0.11, 0.035, 0.05]), 0.03);
    return smin(d, braid(x, y, z, [[0.12, 0.98, -0.06], [0.16, 0.86, 0.0], [0.15, 0.74, 0.06], [0.13, 0.62, 0.08]], 0.035), 0.02);
  } },
  spiky: { name: '스파이크 숏', sdf: (x, y, z) => {
    let d = smax(open(shell(x, y, z, -0.004), x, y, z), 0.98 - y + 0.3 * Math.max(0, z), 0.02);
    for (let i = 0; i < 16; i++) {
      const a = i * 2.4, r = 0.04 + (i % 4) * 0.025, bx = Math.cos(a) * r, bz = Math.sin(a) * r - 0.01;
      d = smin(d, cone(x, y, z, [bx, 1.2, bz], [bx * 1.3, 1.27 + (i % 3) * 0.012, bz * 1.3 + 0.02], 0.028, 0.004), 0.015);
    }
    return d;
  } },
  bun: { name: '올림머리 번', sdf: (x, y, z) => {
    let d = smax(open(shell(x, y, z), x, y, z), 0.97 - y + 0.3 * Math.max(0, z), 0.02);
    d = smin(d, ellipsoid(x, y, z, [0.02, 1.13, 0.13], [0.11, 0.035, 0.05]), 0.03);
    return smin(d, ellipsoid(x, y, z, [0, 1.25, -0.06], [0.07, 0.06, 0.07]) - 0.004 * Math.sin(Math.atan2(x, z - 0.06) * 8), 0.02);
  } },
  twinbraid: { name: '양갈래 브레이드', sdf: (x, y, z) => {
    let d = smax(open(shell(x, y, z), x, y, z), 0.95 - y + 0.25 * Math.max(0, z), 0.02);
    d = smax(d, -cone(x, y, z, [0, 1.25, 0.12], [0, 1.22, -0.12], 0.005, 0.005), 0.005);
    for (const s of [-1, 1]) d = smin(d, braid(x, y, z, [[s * 0.13, 0.96, -0.07], [s * 0.15, 0.86, -0.02], [s * 0.14, 0.74, 0.04], [s * 0.125, 0.64, 0.06]], 0.03), 0.02);
    return d;
  } },
};

/* ================= eyes ================= */
export const EYES = {
  almond: { name: '기본 아몬드', iris: 0x5a3a22 },
  round: { name: '동그란 큰 눈', scale: [1.12, 1.18], cover: 0.5, iris: 0x3a2a1c, irisSize: 0.7 },
  droopy: { name: '순한 처진 눈', tilt: -0.28, iris: 0x6a4a2c, brow: -0.25 },
  upturned: { name: '올라간 눈', tilt: 0.3, scale: [1.08, 0.9], iris: 0x2c2420, brow: 0.2 },
  sleepy: { name: '졸린 눈', cover: 0.98, iris: 0x5a3a22, },
  smile: { name: '웃는 눈', smile: true },
  narrow: { name: '가늘고 긴 눈', scale: [1.2, 0.8], cover: 0.74, iris: 0x2a221c, lash: 1.2 },
  lash: { name: '긴 속눈썹', lash: 2.4, flick: true, iris: 0x4a3426, scale: [1.05, 1.05] },
  sparkle: { name: '반짝이는 눈', scale: [1.1, 1.12], cover: 0.5, iris: 0x2c4e78, shine: 2, irisSize: 0.72 },
  freckle: { name: '초록 눈 · 주근깨', iris: 0x4a6a3a, freckles: true },
};

/* ================= textures & materials ================= */
let sd = 5; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
function tex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const blotchTex = (base, cols, n, a, b) => tex(128, (g, s) => { g.fillStyle = base; g.fillRect(0, 0, s, s); for (let i = 0; i < n; i++) { g.fillStyle = cols[i % cols.length]; const x = rnd() * s, y = rnd() * s, r = a + rnd() * (b - a); for (const [ox, oy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) { g.beginPath(); g.ellipse(x + ox, y + oy, r, r * 0.7, rnd() * 3, 0, 6.283); g.fill(); } } });
const TEX = {};
function T(name) {
  if (TEX[name]) return TEX[name];
  const mk = {
    cotton: () => tex(64, (g, s) => { g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); for (let i = 0; i < s; i += 2) { g.fillStyle = 'rgba(0,0,0,.035)'; g.fillRect(i, 0, 1, s); g.fillRect(0, i, s, 1); } }),
    ripstop: () => tex(64, (g, s) => { g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); g.fillStyle = 'rgba(0,0,0,.07)'; for (let i = 0; i < s; i += 8) { g.fillRect(i, 0, 1, s); g.fillRect(0, i, s, 1); } }),
    crinkle: () => tex(128, (g, s) => { g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.05 + rnd() * 0.08})`; g.lineWidth = 1 + rnd() * 2; g.beginPath(); const x = rnd() * s, y = rnd() * s; g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 30); g.stroke(); } }),
    knit: () => tex(64, (g, s) => { g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); for (let i = 0; i < s; i += 4) { g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(i, 0, 2, s); } }),
    mesh: () => tex(64, (g, s) => { g.fillStyle = '#fff'; g.fillRect(0, 0, s, s); g.fillStyle = 'rgba(0,0,0,.14)'; for (let j = 0; j < s; j += 6) for (let i = (j / 6) % 2 ? 3 : 0; i < s; i += 6) g.fillRect(i, j, 3, 3); }),
    camo: () => blotchTex('#58584e', ['#48483f', '#67675c', '#3d3e38'], 36, 8, 18),
    olivecamo: () => blotchTex('#6a7046', ['#5a603c', '#7a8052', '#4e5434'], 30, 8, 18),
    plaid: () => tex(64, (g, s) => { g.fillStyle = '#d8ccb2'; g.fillRect(0, 0, s, s); for (const [c, w, o] of [['rgba(120,100,80,.55)', 9, 4], ['rgba(90,80,70,.4)', 3, 26], ['rgba(150,135,110,.5)', 6, 42]]) { g.fillStyle = c; g.fillRect(o, 0, w, s); g.fillRect(0, o, s, w); } }),
    floral: () => tex(128, (g, s) => { g.fillStyle = '#e8ecdc'; g.fillRect(0, 0, s, s); for (let i = 0; i < 40; i++) { g.strokeStyle = ['#6a9a6a', '#8ab08a', '#4a7a5a'][i % 3]; g.lineWidth = 2; g.beginPath(); const x = rnd() * s, y = rnd() * s; g.moveTo(x, y); g.quadraticCurveTo(x + 8, y - 10, x + 4, y - 18); g.stroke(); } }),
    gradient: () => { const c = document.createElement('canvas'); c.width = 4; c.height = 128; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#9fc4e0'); gr.addColorStop(1, '#6ab0a0'); g.fillStyle = gr; g.fillRect(0, 0, 4, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; },
  };
  return (TEX[name] = mk[name]());
}
function cloth(color, texName = 'cotton', scale = 22, rough = 0.88) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
  const t = T(texName);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uD: { value: t }, uS: { value: scale } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vR; varying vec3 vRN;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvR = position; vRN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uD; uniform float uS; varying vec3 vR; varying vec3 vRN;')
      .replace('#include <map_fragment>', texName === 'gradient'
        ? 'diffuseColor.rgb *= texture2D(uD, vec2(.5, clamp((vR.y - .42) / .34, 0., 1.))).rgb;'
        : `vec3 n0 = normalize(vRN), w = pow(abs(n0), vec3(3.)); w /= w.x + w.y + w.z;
diffuseColor.rgb *= texture2D(uD, vR.zy * uS).rgb * w.x + texture2D(uD, vR.xz * uS).rgb * w.y + texture2D(uD, vR.xy * uS).rgb * w.z;`);
  };
  return m;
}
function faceDecal(freckles) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  if (freckles) for (let i = 0; i < 80; i++) { const a = rnd() * 6.283, r = Math.sqrt(rnd()); g.fillStyle = `rgba(160,85,55,${0.28 + rnd() * 0.3})`; g.beginPath(); g.arc(128 + Math.cos(a) * r * 82, 135 + Math.sin(a) * r * 26, 1.4 + rnd() * 1.6, 0, 6.283); g.fill(); }
  for (const s of [-1, 1]) { const gr = g.createRadialGradient(128 + s * 70, 150, 0, 128 + s * 70, 150, 34); gr.addColorStop(0, 'rgba(235,115,105,.35)'); gr.addColorStop(1, 'rgba(235,115,105,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }
  return new THREE.CanvasTexture(c);
}
function skinMat(color, freckles) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  const f = faceDecal(freckles);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uF = { value: f };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vR; varying vec3 vRN;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvR = position; vRN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uF; varying vec3 vR; varying vec3 vRN;')
      .replace('#include <map_fragment>', `{ vec2 uv = vec2((vR.x + .16) / .32, (vR.y - .84) / .32); float fr = smoothstep(.3, .7, normalize(vRN).z) * step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.) * step(.8, vR.y);
  vec4 d = texture2D(uF, uv); diffuseColor.rgb = mix(diffuseColor.rgb, d.rgb, d.a * fr); }`)
      .replace('#include <opaque_fragment>', `float tt = 1. - abs(dot(normal, normalize(vViewPosition)));
outgoingLight += vec3(.9, .35, .25) * .07 * smoothstep(.2, .8, tt);
#include <opaque_fragment>`);
  };
  return m;
}

/* ================= outfits ================= */
// colours chosen from the reference photos; no brand marks
export const OUTFITS = {
  sage: { name: '세이지 하드셸', top: { c: 0x8b9182, tex: 'ripstop', zips: 0xe8e4da, pitZips: true }, bottom: { type: 'wide', c: 0x6b6a4f, cargo: true }, shoes: { type: 'trail', c: 0x5a5a56, sole: 0x2a2a28 }, bag: { type: 'pack', c: 0x26282a, strap: 0x1c1e20, sternum: true } },
  block: { name: '블록 컬러 셸', top: { c: 0x5f5a36, tex: 'ripstop', zones: [{ mask: (x, y) => 0.625 - y, c: 0x22262a }, { mask: (x, y) => smax(Math.abs(y - 0.47) - 0.04, 0.13 - Math.abs(x), 0.005), c: 0xd9d0b2 }], zips: 0xd06a2a }, bottom: { type: 'wide', c: 0x1e2128 }, shoes: { type: 'boot', c: 0x3a3a38, sole: 0x1e1e1e }, bag: { type: 'bigpack', c: 0x2c3034, strap: 0x1c1e20, sternum: true, hipBelt: true } },
  beigevest: { name: '베이지 윈드 + 베스트', top: { c: 0xccb996, tex: 'crinkle', crinkle: true, zips: 0x2a2a2a, loose: 0.026 }, bottom: { type: 'balloon', c: 0x6e7260, cargo: true }, shoes: { type: 'trail', c: 0x8a8a82, sole: 0x2a2a28, tex: 'mesh' }, bag: { type: 'vest', c: 0x1e2022 } },
  orange: { name: '오렌지 윈드브레이커', top: { c: 0xc4622c, tex: 'crinkle', crinkle: true, cinch: true, hem: 0.42, zips: 0x2aa8a0, cuffCinch: true }, bottom: { type: 'wide', c: 0xa69c86 }, shoes: { type: 'trail', c: 0x222224, sole: 0x1a1a1a }, bag: { type: 'sling', c: 0xb8bcc0, strap: 0xb8bcc0 } },
  purple: { name: '퍼플 셸 + 하네스', top: { c: 0x6c5a82, tex: 'crinkle', crinkle: true, zips: 0x24364a, cinch: true, hem: 0.41 }, bottom: { type: 'wide', c: 0x1e2c48, cargo: true }, shoes: { type: 'trail', c: 0x4a8a7a, sole: 0x2a2a28 }, bag: { type: 'pack', c: 0x2aa8c8, strap: 0x2aa8c8, sternum: true, hipBelt: true } },
  greyrope: { name: '그레이 셸 + 로프', top: { c: 0xb4b4ba, tex: 'ripstop', zips: 0x3a3048, cinch: true, hem: 0.4, armband: 0xc8f040 }, bottom: { type: 'wide', c: 0x5a4688 }, shoes: { type: 'trail', c: 0xb0c838, sole: 0x2c6a3a }, extra: { rope: 0xc8f040 } },
  magenta: { name: '마젠타 소프트셸 + 게이터', top: { c: 0x963c78, tex: 'cotton', hem: 0.36, zips: 0x6a6ac8 }, bottom: { type: 'shorts', c: 0x4a4a52 }, legs: { socks: [0.12, 0.25, 0xd03c78], gaiters: 0x55555c }, shoes: { type: 'trail', c: 0xc0c4c8, sole: 0x8a8e92 }, bag: { type: 'pack', c: 0x1e2022, strap: 0x3a9a7a }, extra: { ropeBelt: 0x9a8ad8 }, glove: { c: 0x30b0c8, fingerless: true } },
  yellow: { name: '옐로 윈드 + 카고 숏츠', top: { c: 0xb4ac2c, tex: 'crinkle', crinkle: true, cinch: true, hem: 0.43, cuffCinch: true, zips: 0xd8d4b0 }, bottom: { type: 'shorts', c: 0x9a7440, cargo: true }, legs: { socks: [0.17, 0.27, 0xc08a2a] }, shoes: { type: 'rain', c: 0xe6da8a, sole: 0xc8bc6a }, extra: { rope: 0xb88a52 }, glove: { c: 0xd8a040 } },
  layered: { name: '데이하이크 레이어드', top: { c: 0x8a8e96, tex: 'knit', loose: 0.008, collar: false, hood: 'none' }, tee: { tex: 'gradient', c: 0xffffff }, bottom: { type: 'skirt', c: 0xffffff }, legs: { leggings: 0x8a8e98, socks: [0.12, 0.2, 0x6a6a3a] }, shoes: { type: 'boot', c: 0x4a5448, sole: 0x2a6a4a }, bag: { type: 'bigpack', c: 0xc9a032, strap: 0xb08a2a, hipBelt: true, sternum: true } },
  ours: { name: '우리 하이커 기본', top: { c: 0x2e2f31, tex: 'ripstop', zips: 0x6a6a6a }, bottom: { type: 'wide', c: 0xffffff, tex: 'camo', cargo: true }, shoes: { type: 'trail', c: 0x6a6e62, sole: 0x2a2a28, tex: 'camo' }, bag: { type: 'bigpack', c: 0xffffff, tex: 'olivecamo', strap: 0x3a3d38, sternum: true, hipBelt: true }, extra: { phones: 0x1c1c1e } },
};

/* ================= assembly ================= */
const GEO = new Map();
const geo = (key, fn) => { if (!GEO.has(key)) GEO.set(key, fn()); return GEO.get(key); };
const BOX = { top: [[-0.24, 0.33, -0.13], [0.24, 0.8, 0.13]], bottom: [[-0.17, 0.06, -0.12], [0.17, 0.52, 0.12]], legs: [[-0.12, 0.05, -0.06], [0.12, 0.46, 0.06]],
  shoes: [[-0.15, -0.01, -0.07], [0.15, 0.23, 0.17]], head: [[-0.22, 0.68, -0.2], [0.22, 1.21, 0.21]], hair: [[-0.26, 0.6, -0.3], [0.26, 1.33, 0.25]], hat: [[-0.3, 1.0, -0.28], [0.3, 1.4, 0.38]],
  bag: [[-0.2, 0.38, -0.33], [0.2, 0.93, 0.15]], hands: [[-0.21, 0.26, -0.04], [0.21, 0.41, 0.06]] };

export function createCustom(scene, opt) {
  const { skin = 0xf0c2a2, hairStyle = 'crop', hairColor = 0x4a3020, hat = null, hatColor = 0xd8ccb2, hatTex = null, eyes = 'almond', outfit = 'ours' } = opt;
  const O = OUTFITS[outfit], E = EYES[eyes];
  const root = new THREE.Group(); scene.add(root);
  const add = (g, m) => { const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; root.add(o); return o; };
  const sk = skinMat(skin, !!E.freckles);
  add(geo('head', () => mesh(head, ...BOX.head, 0.0035)), sk);
  add(geo('hands', () => mesh((x, y, z) => Math.min(hand(x, y, z, -1), hand(x, y, z, 1)), ...BOX.hands, 0.0022)), sk);
  add(geo('legs', () => mesh(bothLegs, ...BOX.legs, 0.004)), sk);

  // ---- outfit ----
  const topFn = makeTop(O.top);
  const zones = O.top.zones || [];
  const zoneUnion = (x, y, z) => Math.min(...zones.map((zn) => zn.mask(x, y, z, topFn)));
  add(geo(`top:${outfit}`, () => mesh(zones.length ? (x, y, z) => smax(topFn(x, y, z), -zoneUnion(x, y, z), 0.002) : topFn, ...BOX.top, 0.0045)), cloth(O.top.c, O.top.tex || 'cotton', 22));
  zones.forEach((zn, i) => add(geo(`top:${outfit}:z${i}`, () => mesh((x, y, z) => smax(topFn(x, y, z), zn.mask(x, y, z), 0.002), ...BOX.top, 0.0045)), cloth(zn.c, O.top.tex || 'cotton', 22)));
  if (O.top.zips) {
    const zipMask = (x, y, z) => Math.max(Math.abs(x) - 0.0035, -z);
    let det = strip(topFn, zipMask);
    if (O.top.pitZips) det = ((a, b) => (x, y, z) => Math.min(a(x, y, z), b(x, y, z)))(det, strip(topFn, (x, y, z) => Math.max(Math.abs(Math.abs(x) - 0.06 - (0.62 - y) * 0.05) - 0.003, Math.abs(y - 0.58) - 0.06, -z)));
    add(geo(`zip:${outfit}`, () => mesh(det, [-0.12, 0.36, 0.0], [0.12, 0.8, 0.14], 0.003)), cloth(O.top.zips, 'cotton', 40, 0.5));
  }
  if (O.top.armband) add(geo(`arm:${outfit}`, () => mesh(strip(topFn, (x, y, z) => Math.max(Math.abs(y - 0.6) - 0.02, 0.125 - x), 0.005), [0.08, 0.5, -0.08], [0.24, 0.7, 0.08], 0.003)), cloth(O.top.armband, 'cotton', 30, 0.6));
  if (O.tee) {
    const teeFn = makeTop({ loose: 0.016, short: true, hood: 'none', collar: false, hem: 0.37 });
    add(geo(`tee:${outfit}`, () => mesh(teeFn, ...BOX.top, 0.0045)), cloth(O.tee.c, O.tee.tex, 22));
  }
  const bFn = makeBottom(O.bottom);
  if (O.bottom.type === 'skirt') {
    add(geo('shortsUnder', () => mesh(makeBottom({ type: 'shorts' }), ...BOX.bottom, 0.0045)), cloth(0x55585e));
    add(geo('skirt', () => mesh(skirt, [-0.2, 0.26, -0.15], [0.2, 0.5, 0.15], 0.0045)), cloth(0xffffff, 'floral', 10));
  } else add(geo(`bottom:${O.bottom.type}:${!!O.bottom.cargo}`, () => mesh(bFn, ...BOX.bottom, 0.0045)), cloth(O.bottom.c, O.bottom.tex || 'cotton', 20));
  const L = O.legs || {};
  if (L.leggings) add(geo('leggings', () => mesh(leggings, ...BOX.legs, 0.004)), cloth(L.leggings, 'knit', 30));
  if (L.socks) add(geo(`socks:${L.socks[0]}:${L.socks[1]}`, () => mesh(socks(L.socks[0], L.socks[1]), ...BOX.legs, 0.004)), cloth(L.socks[2], 'knit', 30));
  if (L.gaiters) add(geo('gaiters', () => mesh(gaiters, ...BOX.legs, 0.004)), cloth(L.gaiters, 'ripstop', 24));
  add(geo(`shoes:${O.shoes.type}`, () => mesh(shoes(O.shoes.type), ...BOX.shoes, 0.0045)), cloth(O.shoes.c, O.shoes.tex || 'mesh', 26, 0.7));
  add(geo('soles', () => mesh(soles, ...BOX.shoes, 0.004)), cloth(O.shoes.sole, 'cotton', 30, 0.8));
  if (O.glove) add(geo(`glove:${!!O.glove.fingerless}`, () => mesh(glove(O.glove.fingerless), ...BOX.hands, 0.0025)), cloth(O.glove.c, 'cotton', 40, 0.7));

  const B = O.bag;
  if (B) {
    const bagMat = cloth(B.c, B.tex || 'ripstop', 16), strapMat = cloth(B.strap ?? B.c, 'cotton', 40, 0.7);
    if (B.type === 'pack' || B.type === 'bigpack') {
      add(geo(`pack:${B.type}`, () => mesh(packBody(B.type === 'bigpack'), ...BOX.bag, 0.005)), bagMat);
      add(geo(`straps:${!!B.sternum}:${!!B.hipBelt}`, () => mesh(straps(B), ...BOX.bag, 0.0032)), strapMat);
    } else if (B.type === 'vest') add(geo('vest', () => mesh(vest, ...BOX.bag, 0.004)), bagMat);
    else if (B.type === 'sling') {
      add(geo('sling', () => mesh(slingBag, ...BOX.bag, 0.004)), bagMat);
      add(geo('slingStrap', () => mesh(slingStrap, ...BOX.bag, 0.0035)), strapMat);
    }
  }
  const X = O.extra || {};
  if (X.rope) add(geo('rope', () => mesh(ropeSling, [-0.26, 0.38, -0.18], [0.26, 0.8, 0.18], 0.003)), cloth(X.rope, 'knit', 60, 0.7));
  if (X.ropeBelt) add(geo('ropeBelt', () => mesh(ropeBelt, [-0.17, 0.3, -0.14], [0.17, 0.5, 0.14], 0.003)), cloth(X.ropeBelt, 'knit', 60, 0.7));
  if (X.phones) add(geo('phones', () => mesh(phones, [-0.26, 0.92, -0.1], [0.26, 1.28, 0.06], 0.0035)), new THREE.MeshStandardMaterial({ color: X.phones, roughness: 0.4 }));

  // ---- hair & hat ----
  const H = HAIR[hairStyle];
  const hairFn = hat ? (x, y, z) => smax(H.sdf(x, y, z), y - (HATS[hat].cut ?? 1.13) - Math.max(0, -z) * 0.05, 0.01) : H.sdf;
  const hairMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.6 });
  add(geo(`hair:${hairStyle}:${hat ? (HATS[hat].cut ?? 1.13) : 0}`, () => mesh(hairFn, ...BOX.hair, 0.0042)), hairMat);
  if (hat) {
    const def = HATS[hat], sdfH = def.sdf || HATS[def.base].sdf;
    add(geo(`hat:${hat}`, () => mesh(sdfH, ...BOX.hat, 0.0042)), cloth(hatColor, hatTex || (hat.includes('beanie') ? 'knit' : hat === 'mesh' ? 'mesh' : hat === 'plaidcap' ? 'plaid' : 'cotton'), hat === 'plaidcap' ? 9 : 22));
    if (def.goggles) {
      add(geo('goggles', () => mesh(goggles, [-0.22, 1.13, -0.22], [0.22, 1.25, 0.22], 0.003)), new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.4 }));
      const lens = new THREE.MeshStandardMaterial({ color: 0xe0583a, roughness: 0.15, metalness: 0.3 });
      for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.034, 20, 12).scale(1.5, 0.75, 0.6), lens); l.position.set(s * 0.055, 1.2, 0.186); root.add(l); }
    }
    if (hat === 'pombeanie') { /* pom is part of the sdf */ }
  }
  if (H.tie) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 8, 16), cloth(0xc84a4a)); t.position.set(...H.tie); t.rotation.x = 0.9; root.add(t); }

  // ---- face: eyes, brows, mouth ----
  buildEyes(root, E, skin, hairColor);
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0036, 6, 18, Math.PI * 0.72).rotateZ(Math.PI + 0.36), new THREE.MeshBasicMaterial({ color: 0x8a3c30 }));
  mouth.position.set(0.006, 0.928, 0.152); root.add(mouth);
  return root;
}

function buildEyes(root, E, skin, hairColor) {
  const r = 0.036, white = new THREE.MeshStandardMaterial({ color: 0xfbf8f2, roughness: 0.25 });
  const iris = new THREE.MeshStandardMaterial({ color: E.iris ?? 0x5a3a22, roughness: 0.3 }), pupil = new THREE.MeshBasicMaterial({ color: 0x120c08 });
  const shine = new THREE.MeshBasicMaterial({ color: 0xffffff }), lidMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(skin).multiplyScalar(0.94), roughness: 0.55, emissive: new THREE.Color(skin).multiplyScalar(0.28) });
  const lash = new THREE.MeshBasicMaterial({ color: 0x1c1410 }), browMat = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.6 });
  const [sx, sy] = E.scale || [1, 1], cover = E.cover ?? 0.62, tilt = E.tilt ?? 0;
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(s * 0.061, 1.03, 0.124); g.rotation.z = s * tilt; g.scale.set(sx, sy, 1); root.add(g);
    if (E.smile) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.02, 24, 16), lidMat); cap.scale.z = 0.45; g.add(cap);
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.0045, 8, 20, Math.PI), lash); arc.position.set(0, -0.008, r * 0.47); g.add(arc);
    } else {
      g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), white));
      const look = new THREE.Group(); look.rotation.set(0.06, -s * 0.04, 0); g.add(look);
      const ir = new THREE.Mesh(new THREE.SphereGeometry(r * 1.006, 28, 18, 0, Math.PI * 2, 0, E.irisSize ?? 0.64), iris); ir.rotation.x = Math.PI / 2; look.add(ir);
      const pu = new THREE.Mesh(new THREE.SphereGeometry(r * 1.009, 28, 18, 0, Math.PI * 2, 0, (E.irisSize ?? 0.64) * 0.46), pupil); pu.rotation.x = Math.PI / 2; look.add(pu);
      const sh1 = new THREE.Mesh(new THREE.SphereGeometry(0.0072, 10, 8), shine); sh1.position.set(0.011, 0.012, r * 0.97); g.add(sh1);
      if ((E.shine ?? 1) > 1) { const sh2 = new THREE.Mesh(new THREE.SphereGeometry(0.0038, 8, 6), shine); sh2.position.set(-0.008, -0.009, r * 0.99); g.add(sh2); }
      // upper lid: a cap around +y, tilted forward; lash line on its rim
      const lid = new THREE.Group(); lid.rotation.x = 0.12; g.add(lid);
      const rl = r * 1.04;
      lid.add(new THREE.Mesh(new THREE.SphereGeometry(rl, 28, 14, 0, Math.PI * 2, 0, cover), lidMat));
      const rim = new THREE.Mesh(new THREE.TorusGeometry(rl * Math.sin(cover), 0.0022 * (E.lash ?? 1), 6, 30, Math.PI).rotateX(Math.PI / 2), lash);
      rim.position.y = rl * Math.cos(cover); lid.add(rim);
      if (E.flick) for (const k of [0, 1]) { const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0022, 0.012, 3, 6), lash); f.position.set(s * (rl * Math.sin(cover) - 0.002), rl * Math.cos(cover) + 0.006 + k * 0.004, 0.012 - k * 0.008); f.rotation.z = -s * (0.9 + k * 0.3); lid.add(f); }
      if (E.lower) { const lo = new THREE.Group(); lo.rotation.x = -0.35; g.add(lo); lo.add(new THREE.Mesh(new THREE.SphereGeometry(rl * 0.99, 28, 10, 0, Math.PI * 2, Math.PI - E.lower, E.lower), lidMat)); }
    }
    const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.0062, 0.038, 4, 8).rotateZ(Math.PI / 2 - s * (0.1 + (E.brow ?? 0))), browMat);
    brow.position.set(s * 0.064, 1.098 + (E.brow ?? 0) * 0.01, 0.16); root.add(brow);
  }
}
