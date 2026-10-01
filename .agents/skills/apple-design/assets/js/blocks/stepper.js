/* stepper.js — AppleBlocks.stepper.init(root = document). Classic script; optional use of globalThis.AppleFeedback.
   Steps on touch-down, then repeats while held and speeds up (≈ UIStepper autorepeat); sliding off stops it (FB-1).
   Limits: aria-disabled on the − or + half, so a focused half keeps focus. aria-busy="true" on .stepper ignores presses.
   Values are announced (throttled to one per 0.3 s, last value always) because focus stays on the button (FB-10).
   The controlled field fires `input` and `change` after each step. Idempotent: call again after adding steppers. */
(() => {
  const DELAY = 500,
    FIRST = 150,
    FASTEST = 40,
    SPEEDUP = 0.86,
    SLOP = 24; // ms, ms, ms, ×/repeat, px (≈)
  const bound = new WeakSet();

  const fieldOf = (stepper) => {
    const id = stepper.getAttribute('aria-controls');
    const el = id
      ? document.getElementById(id)
      : stepper.parentElement && stepper.parentElement.querySelector('input[type="number"]');
    return el instanceof HTMLInputElement ? el : null;
  };
  const isOff = (btn) => btn.disabled || btn.getAttribute('aria-disabled') === 'true';

  function sync(stepper, field) {
    const v = field.valueAsNumber;
    const min = field.min === '' ? -Infinity : Number(field.min);
    const max = field.max === '' ? Infinity : Number(field.max);
    for (const btn of stepper.querySelectorAll('.stepper__btn')) {
      if (btn.disabled) continue;
      const down = Number(btn.dataset.step) < 0;
      const atLimit = field.disabled || (Number.isFinite(v) && (down ? v <= min : v >= max));
      if (atLimit) btn.setAttribute('aria-disabled', 'true');
      else btn.removeAttribute('aria-disabled');
    }
  }

  function step(stepper, field, btn) {
    if (isOff(btn) || field.disabled || stepper.getAttribute('aria-busy') === 'true') return false;
    const n = Math.abs(Number(btn.dataset.step)) || 1;
    const before = field.value;
    try {
      if (Number(btn.dataset.step) < 0) field.stepDown(n);
      else field.stepUp(n);
    } catch {
      return false;
    }
    if (field.value === before) return false;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    sync(stepper, field);
    return true;
  }

  let lastSaid = 0,
    sayTimer = 0;
  function say(field) {
    const announce = globalThis.AppleFeedback && globalThis.AppleFeedback.announce;
    if (typeof announce !== 'function') return;
    clearTimeout(sayTimer);
    sayTimer = setTimeout(
      () => {
        lastSaid = performance.now();
        announce(field.value);
      },
      Math.max(0, 300 - (performance.now() - lastSaid)),
    );
  }

  function bind(stepper) {
    const field = fieldOf(stepper);
    if (!field || bound.has(stepper)) {
      if (field) sync(stepper, field);
      return;
    }
    bound.add(stepper);
    let held = null,
      box = null,
      timer = 0,
      wait = FIRST,
      stepped = null,
      press = 0;

    const stop = () => {
      clearTimeout(timer);
      if (held) held.removeAttribute('data-pressed');
      held = box = null;
    };
    const repeat = () => {
      if (!held || !step(stepper, field, held)) return stop(); // a limit ends the run
      say(field);
      wait = Math.max(FASTEST, wait * SPEEDUP);
      timer = setTimeout(repeat, wait);
    };

    stepper.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest && e.target.closest('.stepper__btn');
      if (!btn || !stepper.contains(btn) || e.button !== 0 || !e.isPrimary || isOff(btn)) return;
      stop();
      held = btn;
      box = btn.getBoundingClientRect();
      stepped = btn;
      press += 1;
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable: moves and release still bubble here */
      }
      btn.setAttribute('data-pressed', '');
      if (step(stepper, field, btn)) say(field);
      wait = FIRST;
      timer = setTimeout(repeat, DELAY);
    });
    stepper.addEventListener(
      'pointermove',
      (e) => {
        if (!held || !box) return;
        const out =
          e.clientX < box.left - SLOP ||
          e.clientX > box.right + SLOP ||
          e.clientY < box.top - SLOP ||
          e.clientY > box.bottom + SLOP;
        if (out) stop();
      },
      { passive: true },
    );
    const release = () => {
      // forget the press once its (possibly late) click has passed
      stop();
      const id = press;
      setTimeout(() => {
        if (id === press) stepped = null;
      }, 400);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
      stepper.addEventListener(type, release);
    addEventListener('blur', stop);
    stepper.addEventListener('contextmenu', (e) => {
      if (e.target.closest && e.target.closest('.stepper__btn')) e.preventDefault();
    });
    stepper.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Enter' || e.key === ' ') stepped = null;
      },
      true,
    );
    // Keyboard and assistive tech activate with a click and no pointerdown; a pointer press already stepped.
    stepper.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.stepper__btn');
      if (!btn || !stepper.contains(btn)) return;
      if (stepped === btn) {
        stepped = null;
        return;
      }
      if (step(stepper, field, btn)) say(field);
    });
    field.addEventListener('input', () => sync(stepper, field));
    if (field.form)
      field.form.addEventListener('reset', () => setTimeout(() => sync(stepper, field)));
    sync(stepper, field);
  }

  function init(root = document) {
    const list =
      root.matches && root.matches('.stepper')
        ? [root]
        : root.querySelectorAll
          ? root.querySelectorAll('.stepper')
          : [];
    for (const stepper of list) bind(stepper);
  }

  (globalThis.AppleBlocks = globalThis.AppleBlocks || {}).stepper = { init };
})();
