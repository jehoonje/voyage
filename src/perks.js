// What each of the nine terrains gives you the first time you set foot on it.
// Perks are worked out from the terrains you've found, so older saves get them too.
export const PERKS = {
  meadow: { text: 'See farther: map reveal radius +1', reveal: 1 },
  forest: { text: 'Woodcraft: chopping can give up to 4 wood', woodMax: 1 },
  jungle: { text: 'Bigger bag: +3 slots', slots: 3 },
  beach: { text: 'Beachcomber: +3 bag slots', slots: 3 },
  desert: { text: 'Long strides: running speed +5%', run: 0.05 },
  river: { text: 'Patient angler: bites come 20% sooner', bite: 0.2 },
  sea: { text: 'Strong swimmer: swimming speed +20%', swim: 0.2 },
  mountain: { text: 'Lookout: map reveal radius +1', reveal: 1 },
  snow: { text: 'Steady hands: more time to strike a bite', strike: 0.35 },
};
export const BASE_SLOTS = 6, BASE_REVEAL = 3;

/** totals for a set of found terrains */
export function perksFor(biomes) {
  const o = { slots: BASE_SLOTS, reveal: BASE_REVEAL, woodMax: 3, run: 1, swim: 1, bite: 1, strike: 0 };
  for (const b of biomes) {
    const p = PERKS[b];
    if (!p) continue;
    o.slots += p.slots || 0; o.reveal += p.reveal || 0; o.woodMax += p.woodMax || 0;
    o.run += p.run || 0; o.swim += p.swim || 0; o.bite -= p.bite || 0; o.strike += p.strike || 0;
  }
  return o;
}
