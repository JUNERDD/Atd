/* slider.js — AppleBlocks.slider.init(root = document). Classic script, no dependencies.
   Keeps --value (0–1) on each input.slider in step with the thumb (input, change, form reset) and sets [data-pressed]
   while the thumb is held, which turns it into the glass lens. Idempotent; calling init() again re-syncs values set
   from script (setting .value fires no event). */
(() => {
  const bound = new WeakSet();

  const sync = (el) => {
    const min = el.min === '' ? 0 : Number(el.min);
    const max = el.max === '' ? 100 : Number(el.max);
    const v = el.valueAsNumber;
    const f =
      max > min && Number.isFinite(v) ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0;
    el.style.setProperty('--value', String(Math.round(f * 1e4) / 1e4));
  };

  function bind(el) {
    if (bound.has(el)) return;
    bound.add(el);
    const release = () => {
      el.removeAttribute('data-pressed');
      removeEventListener('pointerup', release, true);
      removeEventListener('pointercancel', release, true);
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !e.isPrimary || el.disabled) return;
      el.setAttribute('data-pressed', '');
      addEventListener('pointerup', release, true); // the release may land outside the input
      addEventListener('pointercancel', release, true);
    });
    el.addEventListener('lostpointercapture', release);
    el.addEventListener('blur', release);
    el.addEventListener('input', () => sync(el));
    el.addEventListener('change', () => sync(el));
    if (el.form) el.form.addEventListener('reset', () => setTimeout(() => sync(el)));
  }

  function init(root = document) {
    const list =
      root.matches && root.matches('input.slider')
        ? [root]
        : root.querySelectorAll
          ? root.querySelectorAll('input.slider')
          : [];
    for (const el of list) {
      if (el.type !== 'range') continue;
      bind(el);
      sync(el);
    }
  }

  (globalThis.AppleBlocks = globalThis.AppleBlocks || {}).slider = { init };
})();
