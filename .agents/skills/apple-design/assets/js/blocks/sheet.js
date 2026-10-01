/* @block sheet (JS) — classic script, no imports. Optional: globalThis.AppleMotion (morph, drag physics).
   Without JS the sheet still opens and closes with native invoker commands (commandfor/command) or
   showModal()/close(); this adds: morph from the source button (MOT-4), drag to dismiss with velocity
   (MOT-3), grabber tap to switch detents, light dismiss, focus return, and the framed-mockup mode: inside
   [data-app-frame] the sheet opens with show() in the frame, dims it, and makes the rest of the page inert.
   Markup: <button commandfor="settings" command="show-modal">…</button> <dialog class="sheet" id="settings">…
   API: AppleBlocks.sheet.init(root = document); .open(sheet, source?); .close(sheet). Idempotent. */
(() => {
  const blocks = (globalThis.AppleBlocks ||= {});
  if (blocks.sheet) return;
  const motion = () => globalThis.AppleMotion; // read late: the ES module may load after this script
  const bound = new WeakSet();
  const state = new WeakMap(); // sheet -> { source, inerted, frame, onFrameClick }
  const INTERACTIVE = 'button, a[href], input, select, textarea, label, [tabindex]';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canMorph = (from) =>
    !!(motion() && document.startViewTransition && !reduced() && from?.isConnected);

  function open(sheet, source) {
    if (!sheet || sheet.open) return;
    const frame = sheet.closest('[data-app-frame]');
    const st = { source: source || document.activeElement, inerted: [], frame };
    state.set(sheet, st);
    sheet.style.translate = ''; // clear a previous drag-dismiss offset
    const show = () => {
      if (sheet.open) return; // a second open() while a morph was pending
      if (!frame) {
        sheet.showModal();
        return;
      } // top layer: inert page, Esc, ::backdrop
      sheet.show(); // framed mockup: stay inside the frame (web.md §5)
      for (let el = sheet; el !== document.body && el.parentElement; el = el.parentElement) {
        // the rest of the page goes inert
        for (const sib of el.parentElement.children) {
          if (sib !== el && !sib.inert) {
            sib.inert = true;
            st.inerted.push(sib);
          }
        }
      }
      st.onFrameClick = (e) => {
        if (!sheet.contains(e.target)) close(sheet);
      };
      setTimeout(() => {
        if (state.get(sheet) === st) frame.addEventListener('click', st.onFrameClick);
      }); // not the opening click
    };
    if (canMorph(st.source)) morph(sheet, show, st.source, sheet);
    else show();
  }

  // Morph between the source control and the sheet with a view transition (MOT-4), framed or not. The CSS slide and
  // the framed dim sit out; the snapshot can't blur what's behind it, so the sheet goes near-opaque meanwhile.
  function morph(sheet, update, from, to) {
    sheet.style.transition = 'none';
    sheet.style.outlineColor = 'transparent';
    sheet.dataset.morphing = '';
    motion()
      .morph(update, { from, to })
      .finally(() => {
        sheet.style.transition = sheet.style.outlineColor = ''; // the framed dim then fades in (CSS)
        delete sheet.dataset.morphing;
      });
  }

  function close(sheet, { morph: back = true } = {}) {
    if (!sheet?.open) return;
    const source = state.get(sheet)?.source;
    if (back && canMorph(source)) morph(sheet, () => sheet.close(), sheet, source);
    else sheet.close();
  }

  function cleanup(sheet) {
    // runs on every close: Esc, form[method=dialog], JS
    const st = state.get(sheet);
    if (!st) return;
    state.delete(sheet);
    st.inerted.forEach((el) => {
      el.inert = false;
    });
    if (st.onFrameClick) st.frame.removeEventListener('click', st.onFrameClick);
    if (st.source?.isConnected) st.source.focus({ preventScroll: true }); // focus return
  }

  // Keep the visual top where it was while the height changes, then settle (grabber tap / detent drag).
  function setDetent(sheet, detent, y, v) {
    const M = motion();
    const top = sheet.getBoundingClientRect().top;
    sheet.dataset.detent = detent;
    const dy = top - (sheet.getBoundingClientRect().top - y);
    if (!M || reduced()) {
      sheet.style.translate = '';
      return null;
    }
    sheet.style.translate = `0 ${dy}px`; // no one-frame jump before the spring's first frame
    return M.animateSpring(dy, 0, {
      velocity: v,
      bounce: 0,
      onUpdate: (p) => {
        sheet.style.translate = p ? `0 ${p}px` : '';
      },
    });
  }

  function bindDrag(sheet) {
    let y = 0,
      grabY = 0,
      startY = 0,
      id = null,
      moved = false,
      vt = null,
      anim = null,
      handle = null;
    const set = (p) => {
      y = p;
      sheet.style.translate = p ? `0 ${p}px` : '';
    };
    sheet.addEventListener('pointerdown', (e) => {
      const M = motion();
      handle = e.target.closest('.sheet__grabber, .sheet__header');
      const onControl = e.target.closest(INTERACTIVE) && !e.target.closest('.sheet__grabber');
      if (!M || !handle || onControl || e.button !== 0 || !sheet.open) return;
      anim?.stop();
      y = parseFloat(sheet.style.translate.split(' ')[1]) || 0; // grab mid-flight where it is
      vt = new M.VelocityTracker();
      id = e.pointerId;
      grabY = e.clientY - y;
      startY = e.clientY;
      moved = false;
      handle.setPointerCapture(id);
    });
    sheet.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerId !== id || !vt) return;
        if (!moved && Math.abs(e.clientY - startY) < 10) return; // ~10 pt before a touch becomes a drag
        moved = true;
        const raw = e.clientY - grabY;
        set(raw >= 0 ? raw : -motion().rubberBand(-raw, sheet.offsetHeight)); // resist upward (MOT-3)
        vt.add(y, e.timeStamp);
      },
      { passive: true },
    );
    const release = (e) => {
      if (e.pointerId !== id || !vt) return;
      const M = motion(),
        v = vt.velocity(e.timeStamp);
      id = null;
      vt = null;
      const detent = sheet.dataset.detent;
      if (!moved) {
        // tap: cycle detents like the native grabber
        if (e.type === 'pointerup' && handle.matches('.sheet__grabber') && detent) {
          anim = setDetent(sheet, detent === 'large' ? 'medium' : 'large', 0, 0);
        }
        return;
      }
      const h = sheet.offsetHeight,
        end = y + M.project(v); // projection decides, not position (MOT-8)
      if (end > h / 2) {
        const r = sheet.getBoundingClientRect();
        const bottom = sheet.matches(':modal')
          ? innerHeight
          : (sheet.offsetParent?.getBoundingClientRect().bottom ?? innerHeight);
        anim = M.animateSpring(y, y + bottom - r.top + 24, {
          velocity: v,
          bounce: 0,
          onUpdate: set,
          onDone: () => close(sheet, { morph: false }), // already off-screen; the CSS exit runs hidden
        });
      } else if (detent && (detent === 'large' ? end > h / 4 : end < -h / 4)) {
        anim = setDetent(sheet, detent === 'large' ? 'medium' : 'large', y, v);
        y = 0;
      } else {
        anim = M.animateSpring(y, 0, {
          velocity: v,
          bounce: M.reducedMotion() ? 0 : 0.2,
          onUpdate: set,
        });
      }
    };
    sheet.addEventListener('pointerup', release);
    sheet.addEventListener('pointercancel', release);
  }

  function bind(sheet) {
    if (bound.has(sheet)) return;
    bound.add(sheet);
    sheet.addEventListener('command', (e) => {
      // native invoker commands (commandfor/command)
      if (e.command === 'show-modal' || e.command === 'show') {
        e.preventDefault();
        open(sheet, e.source);
      } else if (e.command === 'close' || e.command === 'request-close') {
        e.preventDefault();
        close(sheet);
      }
    });
    sheet.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(sheet);
    }); // Esc on a modal sheet
    sheet.addEventListener('keydown', (e) => {
      // Esc on a framed (non-modal) sheet
      if (e.key === 'Escape' && !sheet.matches(':modal')) {
        e.preventDefault();
        close(sheet);
      }
    });
    sheet.addEventListener('close', () => cleanup(sheet));
    sheet.addEventListener('click', (e) => {
      // light dismiss: a click on ::backdrop targets the dialog
      if (e.target !== sheet) return;
      const r = sheet.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        close(sheet);
    });
    bindDrag(sheet);
  }

  let fallback = false;
  function init(root = document) {
    root.querySelectorAll('dialog.sheet').forEach(bind);
    if (!fallback && !('commandForElement' in HTMLButtonElement.prototype)) {
      // no native invoker commands
      fallback = true;
      document.addEventListener('click', (e) => {
        const btn = e.target.closest?.('button[commandfor]');
        const sheet = btn && document.getElementById(btn.getAttribute('commandfor'));
        if (!sheet?.matches('dialog.sheet')) return;
        bind(sheet);
        const cmd = btn.getAttribute('command');
        if (cmd === 'show-modal' || cmd === 'show') open(sheet, btn);
        else if (cmd === 'close' || cmd === 'request-close') close(sheet);
      });
    }
  }

  blocks.sheet = { init, open, close };
})();
