// Player physics, tuned for feel over realism:
// acceleration and inertia, slope-dependent speed, sliding on very steep ground,
// collision with trunks / rocks / cactus / fires, hopping onto rocks, buoyant swimming.
import { sample } from './world.js';

export const WALK = 3.6, RUN = 7;
export const SWIM_DEPTH = -1.15, SWIM_Y = -1.1;
const G = 26, RADIUS = 0.35, JUMP_V = 9.5;
const RATE = { ground: 9, brake: 12, air: 1.6, water: 3 }; // how fast velocity follows input (1/s)
const SLIDE_FROM = 1.15; // grade (rise/run) where the ground starts pushing you down (~49°)
const STICK = 0.6; // stay glued to downhill ground within this gap

const h = (x, z) => sample(x, z).h;

export function createPhysics(world, fires) {
  const solids = [];

  function collide(P) {
    world.solidsNear(P.x, P.z, solids);
    for (const f of fires.colliders()) solids.push(f);
    let support = -Infinity;
    for (const s of solids) {
      const dx = P.x - s.x, dz = P.z - s.z, rr = s.r + RADIUS, d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      // above a low obstacle: stand on it instead of bumping into it
      if (P.y > s.top - 0.3) {
        if (d2 < s.r * s.r) support = Math.max(support, s.top);
        continue;
      }
      const d = Math.sqrt(d2) || 1e-4, nx = dx / d, nz = dz / d;
      P.x = s.x + nx * rr;
      P.z = s.z + nz * rr;
      const vn = P.vx * nx + P.vz * nz;
      if (vn < 0) { P.vx -= vn * nx; P.vz -= vn * nz; } // slide along it
    }
    return support;
  }

  return {
    jump(P) {
      if (!P.grounded || P.swim) return false;
      P.vy = JUMP_V; P.grounded = false; P.jumping = true;
      return true;
    },

    /**
     * wx, wz: wished direction scaled by stick magnitude (0..1).
     * Returns { impact } (downward speed on landing) and { splash } (entry speed into water).
     */
    step(P, dt, wx, wz, run) {
      const out = { impact: 0, splash: 0 };
      const e = 0.6;
      const gx = (h(P.x + e, P.z) - h(P.x - e, P.z)) / (2 * e);
      const gz = (h(P.x, P.z + e) - h(P.x, P.z - e)) / (2 * e);
      const grade = Math.hypot(gx, gz);

      // target velocity
      let top = run ? RUN : WALK;
      if (P.swim) top *= 0.55;
      let tx = wx * top, tz = wz * top;
      const tl = Math.hypot(tx, tz);
      if (P.grounded && !P.swim && tl > 0) {
        const up = (tx * gx + tz * gz) / tl; // rise per metre along the move
        let f = up > 0 ? 1 / (1 + up * 1.3) : Math.min(1.15, 1 - up * 0.15);
        if (grade > 1.5 && up > 0) f *= Math.max(0, 1 - (grade - 1.5) * 1.5); // walls stop you
        tx *= f; tz *= f;
      }
      const rate = P.swim ? RATE.water : !P.grounded ? RATE.air : tl > 0 ? RATE.ground : RATE.brake;
      const k = Math.min(1, dt * rate);
      P.vx += (tx - P.vx) * k;
      P.vz += (tz - P.vz) * k;

      // very steep ground pushes you downhill
      P.sliding = P.grounded && !P.swim && grade > SLIDE_FROM;
      if (P.sliding) {
        const s = (grade - SLIDE_FROM) * 40 * dt;
        P.vx -= (gx / grade) * s;
        P.vz -= (gz / grade) * s;
      }

      P.x += P.vx * dt;
      P.z += P.vz * dt;
      const support = collide(P);
      const ground = Math.max(h(P.x, P.z), support);

      if (ground < SWIM_DEPTH && P.y < SWIM_Y + 0.6) {
        // buoyancy: a damped spring toward the surface gives a natural bob
        if (!P.swim) out.splash = Math.max(0, -P.vy);
        P.swim = true;
        P.vy += ((SWIM_Y - P.y) * 30 - P.vy * 6) * dt;
        P.y += P.vy * dt;
        P.grounded = true; P.jumping = false;
      } else {
        P.swim = false;
        P.vy -= G * dt;
        P.y += P.vy * dt;
        if (P.y <= ground) {
          if (!P.grounded) out.impact = -P.vy;
          P.y = ground; P.vy = 0; P.grounded = true; P.jumping = false;
        } else if (P.grounded && !P.jumping && P.y - ground < STICK) {
          P.y = ground; P.vy = 0; // follow the slope down instead of hopping
        } else {
          P.grounded = false;
        }
      }
      return out;
    },
  };
}
