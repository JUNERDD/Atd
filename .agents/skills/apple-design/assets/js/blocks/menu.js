/* menu.js — AppleBlocks.menu.init(root = document). Classic script, no dependencies. For [popover].menu and [popover].popover:
   - Anchors the surface to the button that opened it: CSS anchor positioning where supported (anchor-name, position-anchor
     and position-area set inline), otherwise fixed placement beside the button, kept in place on resize and scroll.
   - Sets --motion-origin to the corner nearest the button, so .motion-pop grows out of it (MOT-4), and keeps aria-expanded.
   - Menus: focus goes to the checked or first item on open; ArrowDown/ArrowUp (wrapping), Home/End, type-ahead; Tab closes.
     Choosing an item toggles aria-checked (menuitemcheckbox, menuitemradio per role="group") and closes the menu; focus
     returns to the button. ArrowDown / ArrowUp on the button opens the menu on its first / last item.
   Esc and light dismiss are the browser's. Idempotent: call again after adding menus or buttons. */
(() => {
  const blocks = (globalThis.AppleBlocks = globalThis.AppleBlocks || {});
  if (typeof HTMLElement === 'undefined' || !('popover' in HTMLElement.prototype)) {
    blocks.menu = { init() {} };
    return;
  }

  const ITEM = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
  const anchorable =
    CSS.supports('position-anchor: --a') && CSS.supports('position-area: bottom span-left');
  const compact = matchMedia('(max-width: 30rem)'); // same breakpoint as menu.css: .popover becomes a bottom card
  const bound = new WeakSet(),
    opener = new WeakMap(),
    atEnd = new WeakMap(),
    refocus = new WeakMap(),
    placed = new Set();
  let seq = 0,
    frame = 0;

  const root = () => document.documentElement;
  const isCard = (pop) => compact.matches && pop.matches('.popover');
  const invokersOf = (pop) =>
    (pop.id
      ? [...document.querySelectorAll(`[popovertarget="${CSS.escape(pop.id)}"]`)]
      : []
    ).filter((b) => !pop.contains(b) && b.getAttribute('popovertargetaction') !== 'hide');
  const items = (menu) =>
    [...menu.querySelectorAll(ITEM)].filter(
      (el) => el.closest('[popover]') === menu && el.getClientRects().length > 0,
    );
  const isOff = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true';

  function side(btn) {
    // open below/above, aligned to the button's nearer edge
    const r = btn.getBoundingClientRect();
    return {
      r,
      below: r.top + r.height / 2 < root().clientHeight / 2,
      end: r.left + r.width / 2 > root().clientWidth / 2,
    };
  }
  function place(pop, btn) {
    // fallback without CSS anchor positioning
    const { r, below, end } = side(btn),
      gap = 8,
      pad = 8,
      vw = root().clientWidth,
      vh = root().clientHeight,
      s = pop.style;
    s.inset = 'auto';
    s.margin = '0';
    if (below) {
      s.top = `${r.bottom + gap}px`;
      s.maxHeight = `${vh - r.bottom - gap - pad}px`;
    } else {
      s.bottom = `${vh - r.top + gap}px`;
      s.maxHeight = `${r.top - gap - pad}px`;
    }
    if (end) s.right = `${Math.max(pad, vw - r.right)}px`;
    else s.left = `${Math.max(pad, r.left)}px`;
  }
  function unplace(pop) {
    for (const p of ['inset', 'margin', 'maxHeight', 'positionArea']) pop.style[p] = '';
  }
  function anchor(pop, btn, below, end) {
    // CSS anchor positioning; position-try-fallbacks still flip it
    let name = (btn.style.anchorName || getComputedStyle(btn).anchorName || 'none')
      .split(',')[0]
      .trim();
    if (name === 'none' || !name) {
      name = `--apple-menu-${++seq}`;
      btn.style.anchorName = name;
    }
    pop.style.positionAnchor = name;
    pop.style.positionArea = `${below ? 'bottom' : 'top'} ${end ? 'span-left' : 'span-right'}`;
  }

  function onBeforeToggle(e) {
    const pop = e.currentTarget;
    if (e.newState === 'open') {
      const btn = e.source || opener.get(pop) || invokersOf(pop)[0];
      if (!btn) return;
      opener.set(pop, btn);
      if (isCard(pop)) {
        unplace(pop);
        pop.style.removeProperty('--motion-origin');
      } else {
        const { below, end } = side(btn);
        pop.style.setProperty(
          '--motion-origin',
          `${below ? 'top' : 'bottom'} ${end ? 'right' : 'left'}`,
        );
        if (anchorable) anchor(pop, btn, below, end);
        else {
          place(pop, btn);
          placed.add(pop);
        }
      }
      btn.setAttribute('aria-expanded', 'true');
    } else {
      placed.delete(pop);
      refocus.set(pop, pop.contains(document.activeElement)); // Esc or a choice, not a click elsewhere
      for (const b of invokersOf(pop)) b.setAttribute('aria-expanded', 'false');
    }
  }
  function onToggle(e) {
    const pop = e.currentTarget,
      btn = opener.get(pop);
    if (e.newState === 'closed') {
      // Safari may not return focus to a button it never focused
      const now = document.activeElement;
      if (refocus.get(pop) && btn && (!now || now === document.body || pop.contains(now)))
        btn.focus({ preventScroll: true });
      return;
    }
    if (!pop.matches('.menu') || pop.contains(document.activeElement)) return; // autofocus already placed focus
    const list = items(pop);
    const first = atEnd.get(pop)
      ? list[list.length - 1]
      : list.find((el) => el.getAttribute('aria-checked') === 'true') || list[0];
    atEnd.delete(pop);
    if (first) first.focus({ preventScroll: true });
  }

  function onMenuKey(e) {
    const menu = e.currentTarget,
      list = items(menu);
    if (!list.length || e.altKey || e.ctrlKey || e.metaKey) return;
    const i = list.indexOf(document.activeElement);
    let next = -1;
    switch (e.key) {
      case 'ArrowDown':
        next = (i + 1) % list.length;
        break;
      case 'ArrowUp':
        next = i <= 0 ? list.length - 1 : i - 1;
        break;
      case 'Home':
      case 'PageUp':
        next = 0;
        break;
      case 'End':
      case 'PageDown':
        next = list.length - 1;
        break;
      case 'Tab': {
        // close, then let Tab move on from the button
        const btn = opener.get(menu);
        menu.hidePopover();
        if (btn) btn.focus({ preventScroll: true });
        return;
      }
      case ' ':
        if (document.activeElement && document.activeElement.matches('a[role^="menuitem"]')) {
          e.preventDefault();
          document.activeElement.click();
        }
        return;
      default:
        if (e.key.length !== 1) return;
        for (let n = 1; n <= list.length; n++) {
          // type-ahead: next item starting with the typed letter
          const el = list[(i + n) % list.length];
          if (el.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase())) {
            next = list.indexOf(el);
            break;
          }
        }
    }
    if (next >= 0) {
      e.preventDefault();
      list[next].focus();
    }
  }
  function onMenuClick(e) {
    const menu = e.currentTarget,
      item = e.target.closest && e.target.closest(ITEM);
    if (!item || !menu.contains(item) || isOff(item)) return;
    const role = item.getAttribute('role');
    if (role === 'menuitemcheckbox')
      item.setAttribute('aria-checked', String(item.getAttribute('aria-checked') !== 'true'));
    if (role === 'menuitemradio') {
      const group = item.closest('[role="group"]');
      for (const r of (group || menu).querySelectorAll('[role="menuitemradio"]')) {
        if (r.closest('[role="group"]') === group)
          r.setAttribute('aria-checked', String(r === item));
      }
    }
    const sub = item.getAttribute('aria-haspopup');
    if (sub && sub !== 'false') return; // opens something else; keep the menu
    if (menu.matches(':popover-open')) menu.hidePopover();
  }

  function bindInvoker(btn, pop) {
    if (bound.has(btn)) return;
    bound.add(btn);
    if (!btn.hasAttribute('aria-expanded'))
      btn.setAttribute('aria-expanded', String(pop.matches(':popover-open')));
    btn.addEventListener('click', () => opener.set(pop, btn)); // runs before the popovertarget action
    if (!pop.matches('.menu')) return;
    if (!btn.hasAttribute('aria-haspopup')) btn.setAttribute('aria-haspopup', 'menu');
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      opener.set(pop, btn);
      atEnd.set(pop, e.key === 'ArrowUp');
      if (!pop.matches(':popover-open')) pop.showPopover({ source: btn });
    });
  }

  function init(scope = document) {
    const pops = scope.querySelectorAll
      ? [...scope.querySelectorAll('.menu[popover], .popover[popover]')]
      : [];
    if (scope.matches && scope.matches('.menu[popover], .popover[popover]')) pops.push(scope);
    for (const pop of pops) {
      if (!bound.has(pop)) {
        bound.add(pop);
        pop.addEventListener('beforetoggle', onBeforeToggle);
        pop.addEventListener('toggle', onToggle);
        if (pop.matches('.menu')) {
          pop.addEventListener('keydown', onMenuKey);
          pop.addEventListener('click', onMenuClick);
        }
      }
      for (const btn of invokersOf(pop)) bindInvoker(btn, pop);
    }
  }

  const follow = () => {
    // JS-placed surfaces track their button
    frame = 0;
    for (const pop of placed) {
      const btn = opener.get(pop);
      if (btn) place(pop, btn);
    }
  };
  const schedule = () => {
    if (placed.size && !frame) frame = requestAnimationFrame(follow);
  };
  addEventListener('resize', schedule, { passive: true });
  addEventListener('scroll', schedule, { passive: true, capture: true });

  blocks.menu = { init };
})();
