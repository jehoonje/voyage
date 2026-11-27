// One clock for the whole world: the time of day comes from the server's time, so every player
// sees the same dawn, dusk and night (and the night-only fish bite for everyone at once).
import { supabase } from './supabase.js';
import { DAY_LENGTH } from './sky.js';

const PHASE = 0.3; // where in the day the epoch falls, so launch day doesn't start at midnight
let offset = 0, synced = false, shift = 0;

/** ask the server for its time and remember how far this device's clock is off */
export async function syncClock() {
  try {
    const t0 = Date.now();
    const { data, error } = await supabase.rpc('server_now');
    const t1 = Date.now();
    if (error || typeof data !== 'number') return false;
    offset = data - (t0 + t1) / 2; // assume the reply took as long to come back as the ask took to go
    synced = true;
    return true;
  } catch { return false; }
}

/** milliseconds since the epoch, on the server's clock (this device's until the first sync) */
export const serverNow = () => Date.now() + offset;

/** 0..1 through the shared day (0.25 sunrise, 0.5 noon, 0.75 sunset) */
export const worldTime = () => (((serverNow() / 1000 / DAY_LENGTH + PHASE + shift) % 1) + 1) % 1;

/** testing aid (?t=): pin today's clock to a given time of day, still flowing from there */
export function pinTime(t) { shift = 0; shift = t - worldTime(); }

/** 'night' | 'dawn' | 'day' | 'dusk' — what fish care about */
export function partOfDay(t = worldTime()) {
  if (t < 0.2 || t > 0.82) return 'night';
  if (t < 0.3) return 'dawn';
  if (t > 0.7) return 'dusk';
  return 'day';
}

export const clockSynced = () => synced;
setInterval(syncClock, 10 * 60 * 1000); // devices drift; check again now and then
