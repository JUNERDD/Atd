/* navbar.js — AppleBlocks.navbar.init(root = document). Classic script, no dependencies.
   Fallback only: where scroll-driven animations are unsupported (Firefox, Safari before 26), toggles .is-scrolled on the
   navbar's scroller (the closest .motion-scroller, else the page) once it scrolls past data-scroll-threshold (default 40 px),
   which swaps the large title for the inline title and shows the scroll edge. With scroll-driven animations the CSS does it
   and this is a no-op. Idempotent. */
(() => {
  const blocks = (globalThis.AppleBlocks = globalThis.AppleBlocks || {});
  const native = typeof CSS !== 'undefined' && CSS.supports('animation-timeline: scroll()');
  const bound = new WeakSet();

  function bind(bar) {
    if (bound.has(bar)) return;
    bound.add(bar);
    const found = bar.closest('.motion-scroller');
    const page = !found || found === document.documentElement || found === document.body;
    const scroller = page ? document.scrollingElement || document.documentElement : found;
    const flag = page ? document.documentElement : found;
    const threshold = Number(bar.dataset.scrollThreshold) || 40;
    const update = () => flag.classList.toggle('is-scrolled', scroller.scrollTop > threshold);
    (page ? window : scroller).addEventListener('scroll', update, { passive: true });
    update();
  }

  function init(root = document) {
    if (native) return;
    const bars =
      root.matches && root.matches('.navbar')
        ? [root]
        : root.querySelectorAll
          ? root.querySelectorAll('.navbar')
          : [];
    for (const bar of bars) bind(bar);
  }

  blocks.navbar = { init };
})();
