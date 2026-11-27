// The shared, lasting parts of the world in Supabase: campfires (camps), signposts, and who found
// each region first. Anyone can read them; only signed-in players can add their own (row-level
// security enforces that). Guests and the offline test mode simply keep things to themselves.
import { supabase } from './supabase.js';
import { store } from './store.js';
import { serverNow } from './clock.js';

const NEAR = 700; // metres around the player to load

export function createWorldDB({ offline = false } = {}) {
  const canWrite = () => !offline && store.mode === 'account' && !!store.uid;
  const firstCache = new Map(); // region → name | null
  let loadedAt = null;

  const fireRow = (r) => ({ id: r.id, x: r.x, y: r.y, z: r.z, owner: r.owner, ownerName: r.owner_name, mine: r.owner === store.uid, litUntil: Date.parse(r.lit_until) });
  const signRow = (r) => ({ id: r.id, x: r.x, y: r.y, z: r.z, face: r.face, text: r.text, ownerName: r.owner_name, mine: r.owner === store.uid });

  return {
    get canWrite() { return canWrite(); },
    /** fires and signs around a point; skipped if we loaded nearby recently */
    async nearby(x, z, force = false) {
      if (offline) return null;
      if (!force && loadedAt && Math.hypot(loadedAt[0] - x, loadedAt[1] - z) < NEAR / 3) return null;
      loadedAt = [x, z];
      const box = (q) => q.gte('x', x - NEAR).lte('x', x + NEAR).gte('z', z - NEAR).lte('z', z + NEAR);
      try {
        const [f, s] = await Promise.all([
          box(supabase.from('campfires').select('id,x,y,z,owner,owner_name,lit_until')).limit(200),
          box(supabase.from('signposts').select('id,x,y,z,face,text,owner,owner_name')).limit(200),
        ]);
        return { fires: (f.data || []).map(fireRow), signs: (s.data || []).map(signRow) };
      } catch { return null; }
    },
    /** your own camps anywhere in the world (travel targets) */
    async myCamps() {
      if (!canWrite()) return [];
      const { data } = await supabase.from('campfires').select('id,x,y,z,owner,owner_name,lit_until').eq('owner', store.uid).order('created_at', { ascending: false });
      return (data || []).map(fireRow);
    },
    async makeFire({ x, y, z, name, litUntil }) {
      if (!canWrite()) return null;
      const { data, error } = await supabase.from('campfires').insert({ x, y, z, owner_name: name, lit_until: new Date(litUntil).toISOString() }).select('id').single();
      return error ? null : data.id;
    },
    async setLit(id, litUntil) {
      if (!canWrite() || !id) return;
      await supabase.from('campfires').update({ lit_until: new Date(litUntil).toISOString() }).eq('id', id);
    },
    async putSign({ x, y, z, face, text, name }) {
      if (!canWrite()) return null;
      const { data, error } = await supabase.from('signposts').insert({ x, y, z, face, text, owner_name: name }).select('id').single();
      return error ? null : data.id;
    },
    async removeSign(id) { if (canWrite()) await supabase.from('signposts').delete().eq('id', id); },
    /**
     * try to be the first to a region; returns { first: true } if you were,
     * { first: false, name } if someone else got there first, or null if unknown
     */
    async claimFirst(region, name) {
      if (offline) return null;
      if (firstCache.has(region)) { const n = firstCache.get(region); return n ? { first: false, name: n } : null; }
      try {
        if (canWrite()) {
          const { error } = await supabase.from('region_firsts').insert({ region, name });
          if (!error) { firstCache.set(region, name); return { first: true }; }
        }
        const { data } = await supabase.from('region_firsts').select('name,user_id').eq('region', region).maybeSingle();
        const n = data ? data.name : null;
        firstCache.set(region, n);
        if (data && data.user_id === store.uid) return { first: true, again: true };
        return n ? { first: false, name: n } : null;
      } catch { return null; }
    },
    /** who found a region first (cached), for the map and the place label */
    firstOf(region) { return firstCache.get(region) || null; },
    now: serverNow,
  };
}
