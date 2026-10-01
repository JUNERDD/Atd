/* apple-interactions.js — apple-design web kit, one dependency-free ES module (web.md §2).
   Exports exactly two objects, each mirrored on globalThis for code that runs after the module loaded:
     import { AppleMotion, AppleFeedback } from './apple-interactions.js';
   AppleMotion   = motion.md §14: springs, rAF spring, rubber band, projection, velocity, morph, FLIP.
   AppleFeedback = interaction-feedback.md §11: initPressStates, initGlassGlint, announce, enableActiveStates.
   Classic <script> (no modules): python3 scripts/build_kit.py <blocks> --js kit.js  (strips `export`, wraps in an IIFE).
   Single-file deliverables: leave an empty <script data-kit> in the page and let build_kit.py … --minify --inline
   fill it (web.md §1); copy single functions only when Python isn't available.
   No JS at all? The iOS Safari :active shim is one line:
     document.addEventListener('touchstart', () => {}, { passive: true }); */

/* ---- motion helpers (motion.md §14) ---- */
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Unit-step spring, same model as SwiftUI Spring(duration:bounce:): returns progress 0→1 at t seconds.
   velocity = initial velocity as a fraction of the total distance per second (UIKit convention). */
function springAt(t, { duration = 0.5, bounce = 0, velocity = 0 } = {}) {
  const w = (2 * Math.PI) / duration,
    z = bounce >= 0 ? 1 - bounce : 1 / (1 + bounce);
  if (Math.abs(z - 1) < 1e-6) return 1 - Math.exp(-w * t) * (1 + (w - velocity) * t);
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    return (
      1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w - velocity) / wd) * Math.sin(wd * t))
    );
  }
  const r = w * Math.sqrt(z * z - 1),
    a = -z * w;
  return 1 - Math.exp(a * t) * (Math.cosh(r * t) - ((a + velocity) / r) * Math.sinh(r * t));
}

/* Seconds until the spring stays within eps of its target. */
function settleTime(opts, eps = 1e-3) {
  let T = 0;
  for (let t = 0; t < 10; t += 1e-3) if (Math.abs(springAt(t, opts) - 1) >= eps) T = t;
  return Math.ceil(T * 100) / 100;
}

/* CSS linear() easing + duration (ms) for any spring; one stop per 60 Hz frame. */
function springEasing(opts = {}) {
  const T = settleTime(opts),
    n = Math.max(2, Math.ceil(T * 60)),
    stops = [];
  for (let i = 0; i <= n; i++) stops.push(i === n ? 1 : +springAt((i / n) * T, opts).toFixed(4));
  return { easing: `linear(${stops.join(', ')})`, duration: Math.round(T * 1000) };
}

/* rAF spring from → to with velocity handoff (units/s). Retarget by calling stop() and starting a new one. */
function animateSpring(
  from,
  to,
  { duration = 0.5, bounce = 0, velocity = 0, onUpdate, onDone } = {},
) {
  const dist = to - from,
    opts = { duration, bounce, velocity: dist ? velocity / dist : 0 };
  let raf = 0,
    t0 = 0,
    value = from,
    vel = velocity;
  const frame = (now) => {
    t0 ||= now;
    const t = (now - t0) / 1000,
      p = springAt(t, opts),
      h = 1e-3;
    const dp = (springAt(t + h, opts) - springAt(t - h, opts)) / (2 * h); // progress per second
    value = from + dist * p;
    vel = dist * dp;
    const done = Math.abs(1 - p) < 1e-3 && Math.abs(dp) < 1e-2; // unit-independent
    if (done) {
      value = to;
      vel = 0;
      onUpdate?.(to);
      onDone?.();
    } else {
      onUpdate?.(value);
      raf = requestAnimationFrame(frame);
    }
  };
  if (!dist) {
    onUpdate?.(to);
    onDone?.();
  } else raf = requestAnimationFrame(frame);
  return { stop: () => (cancelAnimationFrame(raf), { value, velocity: vel }) };
}

/* UIScrollView-style rubber band (community-derived constant 0.55). offset ≥ 0, dimension > 0. */
const rubberBand = (offset, dimension, c = 0.55) =>
  (1 - 1 / ((offset * c) / dimension + 1)) * dimension;

/* Momentum projection (WWDC18): distance travelled while decelerating from velocity (px/s).
   rate is per millisecond: 0.998 ≈ UIScrollView .normal, 0.99 ≈ .fast. */
const project = (velocity, rate = 0.998) => ((velocity / 1000) * rate) / (1 - rate);

/* Velocity over the last ~100 ms of pointer samples; 0 if the finger paused before release. */
class VelocityTracker {
  #s = [];
  add(x, t = performance.now()) {
    this.#s.push([t, x]);
    while (this.#s.length > 2 && t - this.#s[0][0] > 100) this.#s.shift();
  }
  velocity(now = performance.now()) {
    const s = this.#s;
    if (s.length < 2 || now - s[s.length - 1][0] > 60) return 0;
    const [ta, xa] = s[0],
      [tb, xb] = s[s.length - 1];
    return tb > ta ? ((xb - xa) / (tb - ta)) * 1000 : 0;
  }
}

/* Morph `from` into `to` with a same-document View Transition (shared name "motion-morph").
   Reduce Motion or no support: plain root cross-fade / instant update. `to` may be a function
   returning the element after update() ran. */
function morph(update, { from, to } = {}) {
  if (!document.startViewTransition) {
    update();
    return Promise.resolve();
  }
  const named = !reducedMotion();
  let target = null;
  if (named && from) from.style.viewTransitionName = 'motion-morph';
  const vt = document.startViewTransition(() => {
    if (from) from.style.viewTransitionName = '';
    update();
    target = typeof to === 'function' ? to() : to;
    if (named && target) target.style.viewTransitionName = 'motion-morph';
  });
  return vt.finished.finally(() => {
    if (target) target.style.viewTransitionName = '';
  });
}

/* FLIP fallback: animate an element from its old box to its new box after mutate(). */
function flip(el, mutate, { duration = 0.5, bounce = 0 } = {}) {
  const a = el.getBoundingClientRect();
  mutate();
  const b = el.getBoundingClientRect();
  if (reducedMotion()) return el.animate({ opacity: [0, 1] }, { duration: 200, easing: 'ease' });
  const { easing, duration: ms } = springEasing({ duration, bounce });
  return el.animate(
    [
      {
        transformOrigin: '0 0',
        transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`,
      },
      { transformOrigin: '0 0', transform: 'none' },
    ],
    { duration: ms, easing },
  );
}

export const AppleMotion = {
  reducedMotion,
  springAt,
  settleTime,
  springEasing,
  animateSpring,
  rubberBand,
  project,
  VelocityTracker,
  morph,
  flip,
};
globalThis.AppleMotion = AppleMotion;

/* ---- feedback helpers (interaction-feedback.md §11) ---- */
const PRESSABLE =
  '.pressable, .btn-glass, .btn-prominent, .btn-bordered, .btn-tinted, .btn-filled, .btn-plain, ' +
  '.toolbar-btn, .tabbar__item, a.list__row, button.list__row, .segmented > label, .switch, ' +
  '.glass-interactive, .alert__action, .menu__item, .field__clear, .field__cancel';
const IN_SCROLL = 'a.list__row, button.list__row'; // rows scroll: delay their highlight for touch
const GLASS = '.glass-interactive, .btn-glass, .btn-prominent, .toolbar-group, .tabbar';
const initialized = { press: new WeakSet(), glint: new WeakSet(), active: new WeakSet() };

/* iOS Safari applies :active only when a touch listener exists (Safari Web Content Guide).
   One passive no-op listener per root; calling it again is a no-op. initPressStates() calls it. */
function enableActiveStates(root = document) {
  if (initialized.active.has(root)) return;
  initialized.active.add(root);
  root.addEventListener('touchstart', () => {}, { passive: true });
}

/* Press tracking (FB-1): pressed look on touch-down, cancel past `slop` px, re-arm on return, a release in the
   margin still acts once, scrolling rows don't flash. Sets <html data-press-tracking> so CSS reads [data-pressed].
   Idempotent per root (safe under React StrictMode double effects). */
function initPressStates(root = document, { slop = 24, rowDelay = 100 } = {}) {
  // px, ms (≈)
  enableActiveStates(root);
  if (initialized.press.has(root)) return;
  initialized.press.add(root);
  let el = null,
    id = null,
    box = null,
    timer = 0,
    ready = false,
    over = false,
    echo = null;
  const near = (e, pad) =>
    e.clientX >= box.left - pad &&
    e.clientX <= box.right + pad &&
    e.clientY >= box.top - pad &&
    e.clientY <= box.bottom + pad;
  const show = () => el?.toggleAttribute('data-pressed', ready && over);
  const end = () => {
    clearTimeout(timer);
    el?.removeAttribute('data-pressed');
    el = id = box = null;
  };
  document.documentElement.setAttribute('data-press-tracking', '');

  root.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    const target = e.target.closest?.(PRESSABLE);
    if (!target || target.matches(':disabled, [aria-disabled="true"]')) return;
    end();
    el = target;
    id = e.pointerId;
    box = el.getBoundingClientRect();
    over = true;
    ready = !(e.pointerType === 'touch' && el.matches(IN_SCROLL));
    if (!ready)
      timer = setTimeout(() => {
        ready = true;
        show();
      }, rowDelay);
    show(); // pressed look on touch-down, not on release
  });
  root.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerId !== id || !el) return;
      over = near(e, slop); // leaving the margin cancels, returning re-arms
      show();
    },
    { passive: true },
  );
  root.addEventListener('pointerup', (e) => {
    if (e.pointerId !== id || !el) return;
    const target = el,
      inMargin = near(e, slop),
      inside = near(e, 0),
      quickRowTap = !ready && inside;
    end();
    if (quickRowTap) {
      // tapped faster than the row delay: flash once
      target.setAttribute('data-pressed', '');
      setTimeout(() => target.removeAttribute('data-pressed'), rowDelay);
    }
    if (inMargin && !inside) {
      // released in the margin still counts (UIKit-like)
      echo = target;
      setTimeout(() => {
        echo = null;
      }, 400);
      target.click();
    }
  });
  root.addEventListener('pointercancel', (e) => {
    if (e.pointerId === id) end();
  }); // a scroll took over
  root.addEventListener('dragstart', (e) => {
    // a native link or image drag would cancel the press for good
    if (e.target.closest?.(PRESSABLE)) e.preventDefault();
  });
  root.addEventListener('keydown', (e) => {
    if (e.repeat || !(e.key === 'Enter' || (e.key === ' ' && !e.target.closest?.('a')))) return;
    e.target.closest?.(PRESSABLE)?.setAttribute('data-pressed', '');
  });
  for (const type of ['keyup', 'focusout']) {
    root.addEventListener(type, (e) =>
      e.target.closest?.(PRESSABLE)?.removeAttribute('data-pressed'),
    );
  }
  root.addEventListener(
    'click',
    (e) => {
      const nativeEcho = e.isTrusted && echo?.contains(e.target); // browser also clicked: act only once
      if (nativeEcho) echo = null;
      if (nativeEcho || e.target.closest?.('[aria-disabled="true"]')) {
        // aria-disabled stays focusable, never acts
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
}

/* Glass glint (FB-12): light follows the pointer (--px/--py on the glass element); starts under the finger on touch. */
function initGlassGlint(root = document) {
  if (initialized.glint.has(root)) return;
  initialized.glint.add(root);
  const place = (e) => {
    const el = e.target.closest?.(GLASS);
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--px', `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty('--py', `${((e.clientY - r.top) / r.height) * 100}%`);
  };
  root.addEventListener('pointerdown', place); // light starts under the finger
  root.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'touch') place(e);
    },
    { passive: true },
  );
}

/* Live-region announcement (FB-10): #feedback-status (polite) or #feedback-alert (assertive), created on demand. */
function announce(message, { assertive = false } = {}) {
  const id = assertive ? 'feedback-alert' : 'feedback-status';
  let region = document.getElementById(id);
  if (!region) {
    region = document.createElement('div');
    region.id = id;
    region.className = 'sr-only';
    region.setAttribute('role', assertive ? 'alert' : 'status');
    document.body.append(region);
  }
  region.textContent = '';
  setTimeout(() => {
    region.textContent = message;
  }, 100); // change after insertion so it is spoken
}

export const AppleFeedback = { initPressStates, initGlassGlint, announce, enableActiveStates };
globalThis.AppleFeedback = AppleFeedback;
