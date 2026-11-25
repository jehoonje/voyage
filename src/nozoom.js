// Web app, not a web page: no double-tap zoom, no pinch zoom of the page itself.
// (The game's own pinch-to-zoom is handled on the touch layer in input.js.)
export function preventPageZoom() {
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  // iOS still zooms on a quick second tap of some elements: swallow it, but keep the tap working
  let last = 0;
  document.addEventListener('touchend', (e) => {
    const now = e.timeStamp;
    if (now - last < 320 && e.changedTouches.length === 1 && !e.target.closest('input,textarea,select')) {
      e.preventDefault();
      const hit = e.target.closest('button,label,[role=tab]');
      if (hit) hit.click();
    }
    last = now;
  }, { passive: false });
  // two-finger zoom on trackpads (ctrl+wheel)
  addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
}
