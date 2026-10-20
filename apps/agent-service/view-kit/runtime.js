/*
 * Generative view runtime, inlined unchanged into the <head> of every view document, before the
 * agent's markup. It defines `window.atd` and talks to the host frame over postMessage (JSON-RPC
 * 2.0). Method names, limits and payload shapes mirror packages/agent-contracts/src/views.ts and
 * view-protocol.ts, their source of truth; a view cannot import them, so change them together.
 * `atd.surface` says where the view shows: the window, where the user works, or the widget, a
 * glance inline in the conversation. A widget only shows: it cannot send, open links or save
 * state, and its `data-atd-send` controls and links do nothing.
 */
(() => {
  'use strict';

  const PROTOCOL_VERSION = '2026-01-26';
  const Method = {
    initialize: 'ui/initialize',
    initialized: 'ui/notifications/initialized',
    sizeChanged: 'ui/notifications/size-changed',
    message: 'ui/message',
    openLink: 'ui/open-link',
    state: 'atd/notifications/state',
    error: 'atd/notifications/error',
    hostContextChanged: 'ui/notifications/host-context-changed',
    data: 'atd/notifications/data',
  };
  const MESSAGE_MAX = 10_000; // VIEW_MESSAGE_MAX
  const STATE_MAX_BYTES = 65_536; // VIEW_STATE_MAX_BYTES
  const ERROR_TEXT_MAX = 2000; // ViewErrorParamsSchema
  const ERROR_REPORTS_MAX = 5;
  const REQUEST_TIMEOUT_MS = 15_000;
  const SAVE_DELAY = 250;
  const BUTTON_TYPES = new Set(['submit', 'button', 'reset', 'image']);
  const NOT_LABEL_TEXT = 'select, textarea, [aria-hidden="true"]';
  const LOCALE = /^[a-z]{2,8}(-[a-z0-9]{1,8}){0,3}$/i; // at most 35 characters, as views.ts allows

  const root = document.documentElement;
  const isWidget = root.dataset.surface === 'widget';
  const host = window.parent;
  const pending = new Map();
  const outbox = [];
  const listeners = new Set();
  const busy = new WeakSet();
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let isReady = false;
  let data = null;
  let revision = -1;
  let state = null;
  let stateChanged = false;
  let stateTimer = 0;
  let nextId = 1;
  let errorReports = 0;
  let reportedHeight = -1;
  let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  let locale = root.lang || 'en';

  const isWebUrl = (url) => url?.protocol === 'http:' || url?.protocol === 'https:';

  function refuseInWidget(action) {
    if (isWidget) throw new Error(`A widget cannot ${action}: the user acts in the view's window.`);
  }

  function applyContext(context) {
    const previous = `${theme} ${locale}`;
    if (context?.theme === 'light' || context?.theme === 'dark') theme = context.theme;
    if (typeof context?.locale === 'string' && LOCALE.test(context.locale)) locale = context.locale;
    root.dataset.theme = theme;
    root.lang = locale;
    if (`${theme} ${locale}` !== previous) {
      dispatchEvent(new CustomEvent('atd:context', { detail: { theme, locale } }));
    }
  }

  // First paint: the frame URL's query seeds the theme and language before the body is parsed.
  const query = new URLSearchParams(location.search);
  applyContext({ theme: query.get('theme'), locale: query.get('lang') });

  // Until the handshake completes, everything but the initialize request waits in the outbox.
  function post(message) {
    if (!isReady && message.method !== Method.initialize) outbox.push(message);
    else host.postMessage({ jsonrpc: '2.0', ...message }, '*');
  }

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`The app did not answer ${method} in time.`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      post({ id, method, params });
    });
  }

  addEventListener('message', ({ source, data: message }) => {
    if (source !== host || message?.jsonrpc !== '2.0') return;
    if (message.method === Method.data) receiveData(message.params);
    if (message.method === Method.hostContextChanged) applyContext(message.params);
    const entry = message.method === undefined && pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(String(message.error.message ?? 'Refused.')));
    else entry.resolve(message.result);
  });

  function initialize(result) {
    applyContext(result?.hostContext);
    receiveData(result?.atd);
    if (!stateChanged) state = result?.atd?.state ?? null;
    isReady = true;
    post({ method: Method.initialized });
    outbox.splice(0).forEach(post);
    resolveReady();
    listeners.forEach(deliver);
    queueMicrotask(measure); // after the first onData callbacks have rendered
  }

  function receiveData(params) {
    if (!Number.isInteger(params?.revision) || params.revision <= revision) return;
    revision = params.revision;
    data = params.data ?? null;
    if (isReady) listeners.forEach(deliver);
  }

  // One microtask per callback, so a callback that throws cannot stop the others.
  function deliver(listener) {
    const value = data;
    queueMicrotask(guard(() => listeners.has(listener) && listener(value)));
  }

  function onData(callback) {
    if (typeof callback !== 'function') throw new TypeError('atd.onData expects a function.');
    listeners.add(callback);
    if (isReady) deliver(callback);
    return () => void listeners.delete(callback);
  }

  function setState(value) {
    refuseInWidget('save state');
    const json = JSON.stringify(value) ?? 'null';
    if (new TextEncoder().encode(json).byteLength > STATE_MAX_BYTES) {
      throw new RangeError(`atd.setState: the state is over ${STATE_MAX_BYTES} bytes of JSON.`);
    }
    state = JSON.parse(json);
    stateChanged = true;
    clearTimeout(stateTimer);
    stateTimer = setTimeout(() => post({ method: Method.state, params: { state } }), SAVE_DELAY);
  }

  async function send(text) {
    refuseInWidget('send messages');
    const message = String(text ?? '').trim();
    if (!message) throw new Error('There is nothing to send.');
    if (message.length > MESSAGE_MAX) throw new Error('The message is too long to send.');
    if (navigator.userActivation?.hasBeenActive === false) {
      throw new Error('A view can send messages only after the user interacts with it.');
    }
    await request(Method.message, { role: 'user', content: [{ type: 'text', text: message }] });
  }

  async function openLink(url) {
    refuseInWidget('open links');
    const target = URL.parse(String(url));
    if (!isWebUrl(target)) throw new Error('Only http and https links can be opened.');
    await request(Method.openLink, { url: target.href });
  }

  // Content height, measured with html sized to its content: rules such as `height: 100%` cannot pin
  // it to the frame, and unlike scrollHeight it shrinks with the content. ResizeObserver delivers at
  // most once per frame, which coalesces bursts of changes.
  function measure() {
    if (!isReady || document.readyState === 'loading') return;
    const saved = root.style.height;
    root.style.height = 'max-content';
    const height = Math.ceil(root.getBoundingClientRect().height);
    root.style.height = saved;
    if (height === reportedHeight) return;
    reportedHeight = height;
    post({ method: Method.sizeChanged, params: { height } });
  }

  const resizes = new ResizeObserver(() => measure());
  resizes.observe(root);
  document.addEventListener('DOMContentLoaded', () => {
    resizes.observe(document.body);
    measure();
  });
  addEventListener('load', measure);
  void document.fonts?.ready.then(measure);

  function reportError(message) {
    if (errorReports >= ERROR_REPORTS_MAX) return;
    errorReports += 1;
    post({ method: Method.error, params: { message: String(message).slice(0, ERROR_TEXT_MAX) } });
  }

  // WebKit mutes uncaught errors of the view's inline scripts to "Script error.", which is reported
  // as is; the callbacks the runtime invokes report their own errors with the real message instead.
  function reportCaught(error) {
    console.error(error);
    reportError(error?.message ?? error);
  }

  function guard(callback) {
    return (...args) => {
      try {
        callback(...args);
      } catch (error) {
        reportCaught(error);
      }
    };
  }

  addEventListener('error', (event) => reportError(event.message || event.error));
  addEventListener('unhandledrejection', ({ reason }) => reportError(reason?.message ?? reason));
  document.addEventListener('click', guard(onClick));
  document.addEventListener('submit', guard(onSubmit));

  function onClick(event) {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    if (isWidget) {
      if (event.target.closest('[data-atd-send], a[href]')) event.preventDefault();
      return;
    }
    const sender = event.target.closest('[data-atd-send]');
    if (sender && !(sender instanceof HTMLFormElement)) {
      event.preventDefault();
      if (!sender.matches(':disabled, [aria-disabled="true"]')) {
        sendFrom(sender, sender, sender.getAttribute('data-atd-send')).catch(reportCaught);
      }
      return;
    }
    const link = event.target.closest('a[href]');
    const href = link?.getAttribute('href') ?? '#';
    if (href.startsWith('#') || link.hasAttribute('download')) return;
    const url = URL.parse(href, document.baseURI);
    if (url?.protocol === 'javascript:') return;
    // Any other link would navigate the frame away from the view; web links open in the browser.
    event.preventDefault();
    if (isWebUrl(url)) request(Method.openLink, { url: url.href }).catch(() => {});
  }

  function onSubmit(event) {
    const form = event.target;
    if (event.defaultPrevented || !form.matches?.('form[data-atd-send]')) return;
    event.preventDefault();
    if (!isWidget)
      sendFrom(form, event.submitter, composeForm(form, event.submitter)).catch(reportCaught);
  }

  async function sendFrom(target, control, text) {
    if (busy.has(target)) return;
    busy.add(target);
    target.removeAttribute('data-atd-state');
    target.removeAttribute('data-atd-error');
    const hadFocus = control && document.activeElement === control;
    setBusy(control, true);
    const failure = await send(text).catch((error) => String(error?.message ?? error));
    // Restore first, so `atd:sent` and `atd:error` listeners can change the control for good.
    setBusy(control, false);
    if (hadFocus && document.activeElement === document.body) control.focus();
    busy.delete(target);
    const outcome = failure === undefined ? 'sent' : 'error';
    target.setAttribute('data-atd-state', outcome);
    if (failure !== undefined) target.setAttribute('data-atd-error', failure);
    const detail = failure === undefined ? { text: text.trim() } : { message: failure };
    target.dispatchEvent(new CustomEvent(`atd:${outcome}`, { bubbles: true, detail }));
    if (failure !== undefined) globalThis.AppleFeedback?.announce?.(failure);
  }

  function setBusy(control, on) {
    if (!control) return;
    if (on) control.setAttribute('aria-busy', 'true');
    else control.removeAttribute('aria-busy');
    if ('disabled' in control) control.disabled = on;
  }

  // The optional heading, then one `Label: value` line per named control, in form order; radios
  // and checkboxes that share a name are one field (contract v1.1).
  function composeForm(form, submitter) {
    const fields = new Map();
    for (const control of form.elements) {
      const value = valueOf(control, form, submitter);
      if (!value) continue;
      const field = fields.get(control.name) ?? { label: labelOf(control, form), values: [] };
      field.values.push(value);
      fields.set(control.name, field);
    }
    const lines = [...fields.values()].map(({ label, values }) => `${label}: ${values.join(', ')}`);
    return [form.getAttribute('data-atd-send').trim(), ...lines].filter(Boolean).join('\n');
  }

  function valueOf(control, form, submitter) {
    if (!control.name || control.type === 'file' || control.matches(':disabled')) return '';
    if (BUTTON_TYPES.has(control.type)) {
      if (control !== submitter) return '';
      return control.hasAttribute('value') ? control.value : textOf(control);
    }
    if (control.type === 'checkbox' || control.type === 'radio') {
      if (!control.checked) return '';
      if (!isOption(control, form)) return 'Yes'; // a standalone checkbox
      const { value } = control;
      return value && value !== 'on' ? value : ownLabel(control) || value;
    }
    if (control instanceof HTMLSelectElement) {
      return Array.from(control.selectedOptions, (option) => option.value).join(', ');
    }
    return typeof control.value === 'string' ? control.value.trim() : '';
  }

  const peersOf = (control, form) => [...form.elements].filter((el) => el.name === control.name);
  const isOption = (control, form) =>
    control.type === 'radio' || (control.type === 'checkbox' && peersOf(control, form).length > 1);

  function ownLabel(control) {
    return textOf(control.labels?.[0]) || control.getAttribute('aria-label') || '';
  }

  // A field of options is named by its fieldset legend, else by its radiogroup or group, else by
  // its first option's own label.
  function labelOf(control, form) {
    if (!isOption(control, form)) return ownLabel(control) || control.name;
    const legend = control.closest('fieldset')?.querySelector(':scope > legend');
    const group = control.closest('[role="radiogroup"], [role="group"]');
    const ids = group?.getAttribute('aria-labelledby')?.split(/\s+/) ?? [];
    const labelledBy = ids.map((id) => textOf(document.getElementById(id))).join(' ');
    const groupLabel = textOf(legend) || labelledBy.trim() || group?.getAttribute('aria-label');
    return groupLabel || ownLabel(peersOf(control, form)[0]) || control.name;
  }

  // Visible text of a label or legend, without the controls or decorative parts inside it.
  function textOf(node) {
    const copy = node?.cloneNode(true);
    for (const part of copy?.querySelectorAll(NOT_LABEL_TEXT) ?? []) part.remove();
    return copy?.textContent.replace(/\s+/g, ' ').trim() ?? '';
  }

  const api = { ready, onData, setState, send, openLink };
  Object.defineProperties(api, {
    data: { get: () => (isReady ? data : null), enumerable: true },
    state: { get: () => state, enumerable: true },
    theme: { get: () => theme, enumerable: true },
    locale: { get: () => locale, enumerable: true },
    surface: { value: isWidget ? 'widget' : 'window', enumerable: true },
  });
  window.atd = Object.freeze(api);

  const handshake = request(Method.initialize, { protocolVersion: PROTOCOL_VERSION });
  handshake.then(guard(initialize), (error) => console.warn(`atd: ${error.message}`));
})();
