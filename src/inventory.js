// Bag: bag button with a count badge, a panel listing items, and a "+1" pickup flash.
import { CAMP_COST } from './actions.js';

const ICON_WOOD = `<svg viewBox="0 0 40 40" aria-hidden="true">
  <rect x="4" y="13" width="24" height="14" rx="2" fill="#7a5532"/>
  <path d="M8 16h14M7 20h17M9 24h12" stroke="#5c3f24" stroke-width="1.4" stroke-linecap="round"/>
  <ellipse cx="29" cy="20" rx="7" ry="7" fill="#e3c08a"/>
  <circle cx="29" cy="20" r="4.4" fill="none" stroke="#b98d55" stroke-width="1.2"/>
  <circle cx="29" cy="20" r="1.8" fill="#b98d55"/>
</svg>`;

/** a little fish icon in a species' colours */
const fishIcon = (body, fin, eye = '#111') => `<svg viewBox="0 0 40 40" aria-hidden="true">
  <path d="M6 20c5-8 15-10 22-4l6-5v18l-6-5c-7 6-17 4-22-4z" fill="${body}"/>
  <path d="M15 12c3-3 8-3 10 0zM15 28c3 3 8 3 10 0z" fill="${fin}"/>
  <circle cx="12" cy="18.5" r="1.8" fill="${eye}"/>
</svg>`;

export const ITEMS = {
  wood: { name: 'Wood', desc: `One piece for each tree you chop. Making camp takes ${CAMP_COST}.`, icon: ICON_WOOD },
  fish_minnow: { name: 'Minnow', desc: 'A small fish of rivers and shallows.', icon: fishIcon('#c98fb0', '#b0789a') },
  fish_clown: { name: 'Clownfish', desc: 'Orange with white bands; lives in the sea.', icon: fishIcon('#e8741c', '#f4f2ea') },
  fish_tang: { name: 'Blue tang', desc: 'A bright blue reef fish with a yellow fin.', icon: fishIcon('#2f5fb0', '#f2c21a') },
  fish_snapper: { name: 'Red snapper', desc: 'The big one. Rivers and sea.', icon: fishIcon('#d0503a', '#e89a3a') },
};

export function createInventory(progress) {
  const $ = (id) => document.getElementById(id);
  const btn = $('bagBtn'), panel = $('bag'), list = $('bagList'), empty = $('bagEmpty'), badge = $('bagCount'), pickup = $('pickup');

  function render() {
    const rows = Object.keys(ITEMS).filter((id) => progress.count(id) > 0);
    const total = rows.reduce((s, id) => s + progress.count(id), 0);
    badge.hidden = total === 0;
    badge.textContent = total > 99 ? '99+' : total;
    empty.hidden = rows.length > 0;
    list.innerHTML = rows.map((id) => {
      const it = ITEMS[id];
      return `<li><span class="ico">${it.icon}</span><span class="txt"><b>${it.name}</b><small>${it.desc}</small></span><span class="num">×${progress.count(id)}</span></li>`;
    }).join('');
  }
  const setOpen = (open) => { panel.hidden = !open; btn.setAttribute('aria-expanded', open); if (open) render(); };

  btn.addEventListener('click', () => setOpen(panel.hidden));
  $('bagClose').addEventListener('click', () => setOpen(false));
  progress.onItems(render);
  addEventListener('keydown', (e) => { if (e.code === 'KeyI') setOpen(panel.hidden); });
  render();

  let timer = 0;
  return {
    close: () => setOpen(false),
    /** brief floating label, e.g. "나무 조각 +1" */
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
