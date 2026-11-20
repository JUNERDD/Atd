// window.atd: the only way a mini app page reaches anything outside itself. The page has no
// network and no storage of its own; it reads its data here and changes it through Atd, which
// checks every change against the app's fields and writes it where the widget reads it too.
// The host puts this script before the page, with the data the page starts from in #atd-boot.
(() => {
  'use strict';

  const boot = JSON.parse(document.getElementById('atd-boot').textContent);
  const bridge =
    window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.atd;
  const listeners = new Set();
  const numberFormat = new Intl.NumberFormat(boot.locale, { maximumFractionDigits: 2 });

  const send = (message) =>
    bridge ? bridge.postMessage(message) : Promise.reject(new Error('Atd is not available'));

  // JavaScriptCore's stack has no message, so both go to Atd, which asks the model to fix it.
  const report = (error) => {
    const text = error && error.message ? `${error.message}\n${error.stack || ''}` : String(error);
    send({ op: 'error', message: text.slice(0, 600) }).catch(() => {});
  };

  const notify = () => {
    for (const listener of listeners) {
      try {
        listener(atd.data, atd);
      } catch (error) {
        report(error);
      }
    }
  };

  const take = (snapshot) => {
    atd.data = snapshot.data;
    atd.stats = snapshot.stats;
    atd.today = snapshot.today;
    if (snapshot.ledger) Object.assign(ledger, snapshot.ledger);
    notify();
  };

  // Every change resolves with what it made (an inserted record, a logged expense) once Atd has
  // stored it, after the page's listeners saw the new data; it rejects with Atd's reason.
  const change = async (message) => {
    const reply = JSON.parse(await send(message));
    take(reply.snapshot);
    return reply.result === undefined ? atd.data : reply.result;
  };

  const ledger = {
    add: (expense) => change({ op: 'ledger.add', expense }),
    remove: (id) => change({ op: 'ledger.remove', id }),
  };

  const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  const atd = {
    data: boot.snapshot.data,
    stats: boot.snapshot.stats,
    today: boot.snapshot.today,
    locale: boot.locale,
    ready: Promise.resolve(),
    onData(listener) {
      listeners.add(listener);
      try {
        listener(atd.data, atd);
      } catch (error) {
        report(error);
      }
      return () => listeners.delete(listener);
    },
    set: (field, value) => change({ op: 'set', field, value }),
    add: (field, amount, day) => change({ op: 'add', field, amount, day: day ?? null }),
    put: (field, value, day) =>
      change({ op: 'put', field, value: value ?? null, day: day ?? null }),
    insert: (list, record) => change({ op: 'insert', list, record }),
    update: (list, id, changes) => change({ op: 'update', list, id, changes }),
    remove: (list, id) => change({ op: 'remove', list, id }),
    ui: {
      esc: (text) => String(text ?? '').replace(/[&<>"']/g, (c) => escapeMap[c]),
      number: (value) => numberFormat.format(Number(value) || 0),
      ring(fraction, size = 160, stroke = 16) {
        const r = (size - stroke) / 2;
        const c = 2 * Math.PI * r;
        const f = Math.max(0, Math.min(1, Number(fraction) || 0));
        const mid = size / 2;
        return (
          `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">` +
          `<circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="var(--hl)" ` +
          `stroke-width="${stroke}" stroke-dasharray="${f * c} ${c}" ` +
          `transform="rotate(-90 ${mid} ${mid})"/>` +
          `<circle cx="${mid}" cy="${mid}" r="${r + stroke / 2}" fill="none" ` +
          `stroke="var(--line)" stroke-width="1.3"/>` +
          `<circle cx="${mid}" cy="${mid}" r="${r - stroke / 2}" fill="none" ` +
          `stroke="var(--line)" stroke-width="1.3"/></svg>`
        );
      },
      bars(values, { labels, height = 64, all = false } = {}) {
        const top = Math.max(1, ...values.map((v) => Number(v) || 0));
        const columns = values.map((v, i) => {
          const h = Math.max(3, Math.round(((Number(v) || 0) / top) * height));
          const on = all || i === values.length - 1 ? ' class="on"' : '';
          const label = labels ? `<small>${atd.ui.esc(labels[i])}</small>` : '';
          return `<span><i${on} style="height:${h}px"></i>${label}</span>`;
        });
        return `<div class="bars" style="height:auto" aria-hidden="true">${columns.join('')}</div>`;
      },
      meter(fraction) {
        const f = Math.max(0, Math.min(1, Number(fraction) || 0));
        return `<span class="meter" aria-hidden="true"><i style="width:${f * 100}%"></i></span>`;
      },
    },
  };
  if (boot.snapshot.ledger) atd.ledger = Object.assign(ledger, boot.snapshot.ledger);

  // Atd pushes the data again after anything else changed it: a widget button, another page, an
  // expense logged elsewhere.
  Object.defineProperty(window, '__atdPush', { value: (text) => take(JSON.parse(text)) });
  window.atd = atd;

  window.addEventListener('error', (event) => report(event.error || event.message));
  window.addEventListener('unhandledrejection', (event) => report(event.reason));

  // The document has no origin of its own, so WebKit hides what an uncaught error says
  // ("Script error."). Event handlers and timers are wrapped to report the error themselves.
  const guarded = new WeakMap();
  const guard = (fn) => {
    if (typeof fn !== 'function') return fn;
    if (!guarded.has(fn)) {
      guarded.set(fn, function (...args) {
        try {
          return fn.apply(this, args);
        } catch (error) {
          report(error);
        }
      });
    }
    return guarded.get(fn);
  };
  const { addEventListener, removeEventListener } = EventTarget.prototype;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    return addEventListener.call(this, type, guard(listener), options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    return removeEventListener.call(this, type, guard(listener), options);
  };
  for (const name of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask']) {
    const original = window[name];
    window[name] = (fn, ...rest) => original.call(window, guard(fn), ...rest);
  }
  for (const target of [HTMLElement.prototype, Document.prototype, Window.prototype]) {
    for (const key of Object.getOwnPropertyNames(target)) {
      const property = key.startsWith('on') && Object.getOwnPropertyDescriptor(target, key);
      if (!property || !property.set) continue;
      Object.defineProperty(target, key, {
        ...property,
        set(fn) {
          property.set.call(this, guard(fn));
        },
      });
    }
  }

  // <i class="sym" data-name="drop.fill"></i> becomes that SF Symbol, in the text's color.
  const symbols = new Map();
  let pending = null;
  const paint = (element) => {
    const url = symbols.get(element.dataset.name);
    if (url) element.style.setProperty('--sym', `url("${url}")`);
  };
  const scan = () => {
    pending = null;
    const elements = [...document.querySelectorAll('i.sym[data-name]')];
    const missing = [...new Set(elements.map((e) => e.dataset.name))].filter(
      (n) => !symbols.has(n),
    );
    elements.forEach(paint);
    if (missing.length === 0) return;
    missing.forEach((name) => symbols.set(name, null));
    send({ op: 'symbols', names: missing.slice(0, 64) })
      .then((reply) => {
        const images = JSON.parse(reply);
        for (const name of Object.keys(images)) symbols.set(name, images[name]);
        document.querySelectorAll('i.sym[data-name]').forEach(paint);
      })
      .catch(() => {});
  };
  new MutationObserver(() => {
    pending = pending || requestAnimationFrame(scan);
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', scan);
})();
