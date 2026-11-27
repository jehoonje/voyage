// Where the game keeps its saves.
//  · guest: this tab only (memory). A one-time session: reload and it's gone.
//  · account: one row in Supabase per player (public.saves), plus a copy in this browser so a save that
//    didn't reach the server (offline, tab closed mid-upload) is pushed up next time instead of lost.
// Keys are the game's old localStorage names; values are plain objects / numbers.
import { supabase } from './supabase.js';

const FIELD = { 'mjdr-save': 'progress', 'mjdr-hero': 'look', 'mjdr-time': 'time_of_day' };
const LEGACY = Object.keys(FIELD); // saves from before accounts lived in localStorage under these keys
const FLUSH_AFTER = 15000; // batch writes; leaving or backgrounding the page flushes at once

let mode = 'guest', uid = null, row = {}, timer = 0, flushing = null, queued = false;
const mem = new Map();
const backupKey = () => 'voyage-save:' + uid;

function readLocal(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function writeLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } }

async function flush() {
  clearTimeout(timer); timer = 0;
  if (mode !== 'account') return;
  if (flushing) { queued = true; return flushing; }
  const body = { user_id: uid, progress: row.progress ?? null, look: row.look ?? null, time_of_day: row.time_of_day ?? null };
  flushing = supabase.from('saves').upsert(body).then(({ error }) => {
    if (!error) writeLocal(backupKey(), { ...row, pending: false, at: Date.now() });
    else console.warn('save failed, kept locally', error.message);
  }).finally(() => { flushing = null; if (queued) { queued = false; flush(); } });
  return flushing;
}

export const store = {
  get mode() { return mode; },
  /** the signed-in player's id (null for a guest) */
  get uid() { return uid; },
  get(key) {
    if (mode === 'guest') return mem.has(key) ? mem.get(key) : null;
    return row[FIELD[key]] ?? null;
  },
  set(key, value) {
    if (mode === 'guest') { mem.set(key, value); return; }
    row[FIELD[key]] = value;
    writeLocal(backupKey(), { ...row, pending: true, at: Date.now() });
    if (!timer) timer = setTimeout(flush, FLUSH_AFTER);
  },
  /** push anything waiting now (leaving the page, going to the background) */
  flush,

  useGuest() { mode = 'guest'; uid = null; row = {}; mem.clear(); },

  /** switch to a signed-in player's save; returns whether an old, pre-account save was brought in */
  async useAccount(user) {
    mode = 'account'; uid = user.id; row = {};
    const { data, error } = await supabase.from('saves').select('progress, look, time_of_day, updated_at').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    const local = readLocal(backupKey());
    const serverAt = data ? Date.parse(data.updated_at) : 0;
    if (local && local.pending && local.at > serverAt) { // this browser has a newer save the server never got
      row = { progress: local.progress, look: local.look, time_of_day: local.time_of_day };
      await flush();
      return false;
    }
    if (data) { row = { progress: data.progress, look: data.look, time_of_day: data.time_of_day }; writeLocal(backupKey(), { ...row, pending: false, at: serverAt }); return false; }
    // a brand-new account: carry over progress made on this device before accounts existed
    const old = { progress: readLocal('mjdr-save'), look: readLocal('mjdr-hero'), time_of_day: readLocal('mjdr-time') };
    if (old.progress || old.look) {
      row = old;
      await flush();
      try { for (const k of LEGACY) localStorage.removeItem(k); } catch { /* storage unavailable */ }
      return !!old.progress;
    }
    return false;
  },
};

addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
