// Cooking a fish at a lit campfire: eat it for a while of quicker feet and (for better fish) quicker bites.
// Buffs run on the shared clock, so they keep counting down while you're away.
export const COOK = {
  Common: { speed: 0.1, bite: 0, secs: 180, text: 'moving 10% faster for 3 min' },
  Uncommon: { speed: 0.15, bite: 0.25, secs: 240, text: 'faster feet and quicker bites for 4 min' },
  Rare: { speed: 0.25, bite: 0.4, secs: 360, text: 'much faster feet and quicker bites for 6 min' },
};

/** "2:05" */
export const mmss = (ms) => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

/** the HUD chips for active buffs */
export function buffChips(progress) {
  const out = [];
  const sp = progress.buff('speed'), bi = progress.buff('bite');
  if (sp.k) out.push(`Swift +${Math.round(sp.k * 100)}% · ${mmss(sp.left)}`);
  if (bi.k) out.push(`Lucky line · ${mmss(bi.left)}`);
  return out;
}
