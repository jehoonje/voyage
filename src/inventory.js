// Bag panel with three tabs: what you carry (slots), the field guide (every fish, how many, your
// best size), and terrain (the nine terrains and the perk each one gave). Plus the "+1" pickup flash.
import { CAMP_COST, SIGN_COST } from './actions.js';
import { SPECIES } from './fishing.js';
import { PERKS } from './perks.js';
import { BIOME_NAME } from './world.js';
import { COOK } from './cooking.js';

const ICON_WOOD = `<svg viewBox="0 0 40 40" aria-hidden="true">
  <rect x="4" y="13" width="24" height="14" rx="2" fill="#7a5532"/>
  <path d="M8 16h14M7 20h17M9 24h12" stroke="#5c3f24" stroke-width="1.4" stroke-linecap="round"/>
  <ellipse cx="29" cy="20" rx="7" ry="7" fill="#e3c08a"/>
  <circle cx="29" cy="20" r="4.4" fill="none" stroke="#b98d55" stroke-width="1.2"/>
  <circle cx="29" cy="20" r="1.8" fill="#b98d55"/>
</svg>`;

/** a little fish icon in a species' colours */
const fishIcon = (body, fin, long = false) => `<svg viewBox="0 0 40 40" aria-hidden="true">
  ${long ? `<path d="M3 20c4-4 20-5 28-1l6-3v8l-6-3c-8 4-24 3-28-1z" fill="${body}"/>`
    : `<path d="M6 20c5-8 15-10 22-4l6-5v18l-6-5c-7 6-17 4-22-4z" fill="${body}"/><path d="M15 12c3-3 8-3 10 0zM15 28c3 3 8 3 10 0z" fill="${fin}"/>`}
  <circle cx="${long ? 8 : 12}" cy="18.5" r="1.8" fill="#111"/>
</svg>`;
const BASE_COL = { minnow: ['#c98fb0', '#b0789a'], clown: ['#e8741c', '#f4f2ea'], tang: ['#2f5fb0', '#f2c21a'], snapper: ['#d0503a', '#e89a3a'] };
const hex = (c) => '#' + c.map((v) => Math.round(Math.min(1, v) * 255).toString(16).padStart(2, '0')).join('');

export const ITEMS = {
  wood: { name: 'Wood', desc: `From chopping trees. A camp takes ${CAMP_COST}, a sign ${SIGN_COST}. Doesn't take a bag slot.`, icon: ICON_WOOD },
};
for (const [id, sp] of Object.entries(SPECIES)) {
  const [b, f] = sp.tint ? [hex(sp.tint), hex(sp.tint.map((v) => v * 0.75))] : BASE_COL[sp.model];
  const cook = COOK[sp.rarity];
  ITEMS['fish_' + id] = { name: sp.label, desc: `${sp.hint}. Cooked: ${cook.text}.`, icon: fishIcon(b, f, !!sp.stretch), species: id };
}

const TERRAINS = ['meadow', 'forest', 'jungle', 'beach', 'desert', 'river', 'sea', 'mountain', 'snow'];

export function createInventory(progress, { canCook, onCook, bitingNow } = {}) {
  const $ = (id) => document.getElementById(id);
  const btn = $('bagBtn'), panel = $('bag'), list = $('bagList'), empty = $('bagEmpty'), badge = $('bagCount'), pickup = $('pickup');
  let tab = 'bag';

  function renderBag() {
    const rows = Object.keys(ITEMS).filter((id) => progress.count(id) > 0);
    const total = rows.reduce((s, id) => s + progress.count(id), 0);
    badge.hidden = total === 0;
    badge.textContent = total > 99 ? '99+' : total;
    if (panel.hidden) return;
    const sl = progress.slots(), cook = canCook && canCook();
    $('bagSlots').textContent = `${sl.used} / ${sl.max} slots used` + (cook ? ' · by a fire: cook a fish for a boost' : '');
    empty.hidden = rows.length > 0;
    list.innerHTML = rows.map((id) => {
      const it = ITEMS[id];
      const use = cook && it.species ? `<button class="use" data-cook="${it.species}">Cook</button>` : '';
      return `<li><span class="ico">${it.icon}</span><span class="txt"><b>${it.name}</b><small>${it.desc}</small></span><span class="num">×${progress.count(id)}${use}</span></li>`;
    }).join('');
  }

  function renderFish() {
    const codex = progress.state.codex, now = new Set(bitingNow ? bitingNow() : []);
    const ids = Object.keys(SPECIES), got = ids.filter((id) => codex[id] && codex[id].n > 0).length;
    $('fishCount').textContent = `${got} / ${ids.length} species caught` + (now.size ? ' · blue tags: biting where you stand' : '');
    $('fishList').innerHTML = ids.map((id) => {
      const sp = SPECIES[id], c = codex[id], it = ITEMS['fish_' + id];
      const tags = `<span class="tag${sp.rarity === 'Rare' ? ' rare' : ''}">${sp.rarity}</span>${now.has(id) ? '<span class="tag now">Biting now</span>' : ''}`;
      if (!c || !c.n) return `<li class="locked"><span class="ico">${it.icon}</span><span class="txt"><b>${sp.label}${tags}</b><small>${sp.hint} · ${sp.cm[0]}–${sp.cm[1]} cm</small></span><span class="num">–</span></li>`;
      return `<li><span class="ico">${it.icon}</span><span class="txt"><b>${sp.label}${tags}</b><small>${sp.hint} · first caught in ${BIOME_NAME[c.where] || 'the wild'}</small></span><span class="num">${c.best} cm<small>best · ×${c.n}</small></span></li>`;
    }).join('');
  }

  function renderLand() {
    const found = progress.state.biomes;
    $('landCount').textContent = `${TERRAINS.filter((b) => found.has(b)).length} / 9 terrains found · each one gives a perk`;
    $('landList').innerHTML = TERRAINS.map((b) => {
      const has = found.has(b);
      return `<li class="${has ? '' : 'locked'}"><span class="ico"><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="14" fill="${has ? '#e8b15a' : '#6b6b6b'}"/><path d="M12 24l5-7 4 5 3-3 4 5z" fill="#2a1a06"/></svg></span>
        <span class="txt"><b>${BIOME_NAME[b]}</b><small>${has ? PERKS[b].text : 'Find this terrain to unlock: ' + PERKS[b].text}</small></span><span class="num">${has ? '✓' : ''}</span></li>`;
    }).join('');
  }

  function render() {
    renderBag();
    if (panel.hidden) return;
    if (tab === 'fish') renderFish();
    if (tab === 'land') renderLand();
  }
  function show(which) {
    tab = which;
    for (const [t, pane] of [['bag', 'paneBag'], ['fish', 'paneFish'], ['land', 'paneLand']]) {
      $(pane).hidden = t !== which;
      panel.querySelector(`[data-tab="${t}"]`).setAttribute('aria-selected', t === which);
    }
    render();
  }
  const setOpen = (open, which) => { panel.hidden = !open; btn.setAttribute('aria-expanded', open); if (open) show(which || tab); };

  btn.addEventListener('click', () => setOpen(panel.hidden));
  $('bagClose').addEventListener('click', () => setOpen(false));
  panel.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-cook]'); if (b && onCook) onCook(b.dataset.cook); });
  progress.onItems(render);
  addEventListener('keydown', (e) => { if (e.code === 'KeyI') setOpen(panel.hidden); if (e.code === 'KeyG') setOpen(panel.hidden || tab !== 'fish', 'fish'); });
  render();

  let timer = 0;
  return {
    close: () => setOpen(false),
    open: (which) => setOpen(true, which),
    refresh: render,
    flash(text) {
      pickup.textContent = text;
      pickup.classList.remove('on');
      void pickup.offsetWidth; // restart the animation
      pickup.classList.add('on');
      clearTimeout(timer);
      timer = setTimeout(() => pickup.classList.remove('on'), 1400);
    },
  };
}
