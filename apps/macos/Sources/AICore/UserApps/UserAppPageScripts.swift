import Foundation

/// The scripts the shell adds to a glass app's page (``UserAppRuntime/Surface/glass``) besides
/// ``UserAppErrorCapture``: the window state the page's styles key off, and the drag regions of
/// the title bar strip. Both belong to the shell, so a page needs no code of its own for its window
/// to look and move like Atd's.
public enum UserAppPageScripts {
  /// The unified title bar's height (`UnifiedTitleBar`) in points, which is the page's CSS pixels:
  /// the strip at the top of the page that moves the window, `--ata-titlebar-height` in the page's
  /// generated stylesheet.
  public static let titleBarHeight = 52

  /// Writes the window state where the page's styles read it, as the renderer's `window-state.ts`
  /// does: `data-window-active` (overlay glass dims in an inactive window) and
  /// `data-reduced-transparency` (the panel fill turns opaque; WebKit has no
  /// `prefers-reduced-transparency`) on the root element. The body of a function of `active` and
  /// `reduce`, each `"true"` or `"false"`, that returns whether the root element existed. It runs
  /// in the isolated `.defaultClient` world, out of the page's reach: at document start
  /// (``windowState(active:reduceTransparency:)``), then through `callAsyncJavaScript` on a change.
  public static let applyWindowState = """
    const root = document.documentElement;
    if (!root) return false;
    root.dataset.windowActive = active;
    root.dataset.reducedTransparency = reduce;
    return true;
    """

  /// The document-start script that gives a loading page the state its window has now, before the
  /// page's own scripts run or its styles apply.
  public static func windowState(active: Bool, reduceTransparency: Bool) -> String {
    """
    (() => {
      const apply = (active, reduce) => {
    \(applyWindowState)
      };
      const state = [\(jsonString(String(active))), \(jsonString(String(reduceTransparency)))];
      if (apply(...state)) return;
      new MutationObserver((_, observer) => {
        if (apply(...state)) observer.disconnect();
      }).observe(document, { childList: true });
    })();
    """
  }

  /// The document-start script, in the page's world where the `atdApp` handler is, that reports
  /// the window drag regions (`window.dragRegions`): the top ``titleBarHeight`` pixels of the page,
  /// minus the interactive elements there (controls, links, fields, ARIA widgets and anything
  /// marked `data-no-drag`), each clipped by the boxes that clip its overflow, and minus the
  /// overlays the page portals to the body (menus, popovers, dialogs and their scrims). It
  /// recomputes in an animation frame, at most ten times a second, after a change that can move a
  /// region: a resize, a scroll, a font or image load, the end of a transition, a size change of a
  /// cut-out element, or a mutation that does not lie wholly below the strip. It sends only a
  /// changed set, and `[]` when the page goes away. It holds its own references to what it uses
  /// before any app script runs, so an app's globals do not break it; a page that posts the message
  /// itself only moves its own window.
  public static func dragRegions(messageHandler: String) -> String {
    """
    (() => {
      const handler = window.webkit?.messageHandlers?.[\(jsonString(messageHandler))];
      if (!handler) return;
      const STRIP = \(titleBarHeight);
      const MAX_RECTS = 64;
      const INTERVAL_MS = 100;
      const MAX_CHANGED = 256;
      const NO_DRAG = [
        'button', 'a[href]', 'input', 'textarea', 'select', 'summary', 'label', '[role="button"]',
        '[role="tab"]', '[role="combobox"]', '[role="switch"]', '[role="checkbox"]',
        '[role="radio"]', '[role="menuitem"]', '[role="slider"]',
        '[contenteditable]:not([contenteditable="false"])', '[data-no-drag]',
      ].join(',');
      const post = handler.postMessage.bind(handler);
      const ElementType = Element;
      const Mutations = MutationObserver;
      const Resizes = ResizeObserver;
      const getRect = Element.prototype.getBoundingClientRect;
      const queryAll = Document.prototype.querySelectorAll;
      const byId = Document.prototype.getElementById;
      const styleOf = window.getComputedStyle.bind(window);
      const frame = window.requestAnimationFrame.bind(window);
      const after = window.setTimeout.bind(window);
      const listen = window.addEventListener.bind(window);
      const now = performance.now.bind(performance);
      const stringify = JSON.stringify;

      const area = (rect) => rect.width > 0 && rect.height > 0;
      const box = (element) => {
        const { left, top, width, height } = getRect.call(element);
        return { x: left, y: top, width, height };
      };
      const intersect = (a, b) => {
        const x = Math.max(a.x, b.x);
        const y = Math.max(a.y, b.y);
        const width = Math.min(a.x + a.width, b.x + b.width) - x;
        const height = Math.min(a.y + a.height, b.y + b.height) - y;
        return width > 0 && height > 0 ? { x, y, width, height } : null;
      };
      const subtract = (rect, hole) => {
        const cut = intersect(rect, hole);
        if (!cut) return [rect];
        const right = cut.x + cut.width;
        const bottom = cut.y + cut.height;
        return [
          { x: rect.x, y: rect.y, width: rect.width, height: cut.y - rect.y },
          { x: rect.x, y: bottom, width: rect.width, height: rect.y + rect.height - bottom },
          { x: rect.x, y: cut.y, width: cut.x - rect.x, height: cut.height },
          { x: right, y: cut.y, width: rect.x + rect.width - right, height: cut.height },
        ].filter(area);
      };
      const shown = (element) => {
        let rect = box(element);
        for (let node = element.parentElement; rect && node; node = node.parentElement) {
          if (node === document.body || node === document.documentElement) break;
          const { overflowX, overflowY } = styleOf(node);
          if (overflowX !== 'visible' || overflowY !== 'visible') rect = intersect(rect, box(node));
        }
        return rect;
      };

      const regions = () => {
        const strip = { x: 0, y: 0, width: document.documentElement.clientWidth, height: STRIP };
        const holes = [];
        const cut = new Set();
        for (const element of queryAll.call(document, NO_DRAG)) {
          if (!intersect(box(element), strip)) continue;
          const rect = shown(element);
          if (!rect || !intersect(rect, strip)) continue;
          holes.push(rect);
          cut.add(element);
        }
        const root = byId.call(document, 'root');
        for (const element of document.body?.children ?? []) {
          if (element === root) continue;
          const { pointerEvents, position } = styleOf(element);
          if (pointerEvents === 'none' || (position !== 'fixed' && position !== 'absolute')) continue;
          const rect = box(element);
          if (!intersect(rect, strip)) continue;
          holes.push(rect);
          cut.add(element);
        }
        let rects = area(strip) ? [strip] : [];
        for (const hole of holes) rects = rects.flatMap((rect) => subtract(rect, hole));
        if (rects.length > MAX_RECTS) {
          rects.sort((a, b) => b.width * b.height - a.width * a.height);
          rects = rects.slice(0, MAX_RECTS);
        }
        return { rects, cut };
      };

      let sent = null;
      let pending = 0;
      let last = -Infinity;
      let full = true;
      let watched = new Set();
      const changed = new Set();
      const send = (rects) => {
        try {
          post({ type: 'post', method: 'window.dragRegions', params: { rects } }).catch(() => {});
        } catch {}
      };
      const affectsStrip = (node) => {
        const element = node instanceof ElementType ? node : node?.parentElement;
        if (!element?.isConnected) return true;
        if (element === document.documentElement || element === document.body) return true;
        const { top, width, height } = getRect.call(element);
        return width === 0 || height === 0 || top < STRIP;
      };
      const resizes = new Resizes(() => refresh());
      const observe = (cut) => {
        if (cut.size === watched.size && [...cut].every((element) => watched.has(element))) return;
        resizes.disconnect();
        watched = cut;
        for (const element of cut) resizes.observe(element);
      };
      const run = () => {
        pending = 0;
        const relevant = full || [...changed].some(affectsStrip);
        full = false;
        changed.clear();
        if (!relevant) return;
        last = now();
        try {
          const { rects, cut } = regions();
          observe(cut);
          const signature = stringify(rects);
          if (signature === sent) return;
          sent = signature;
          send(rects);
        } catch {}
      };
      const schedule = () => {
        if (pending) return;
        const wait = last + INTERVAL_MS - now();
        pending = wait > 0 ? after(() => frame(run), wait) : frame(run);
      };
      const refresh = () => {
        full = true;
        changed.clear();
        schedule();
      };
      const note = (node) => {
        if (full) return schedule();
        if (changed.size >= MAX_CHANGED) return refresh();
        changed.add(node);
        schedule();
      };

      new Mutations((records) => {
        for (const record of records) note(record.target);
      }).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          'class', 'style', 'hidden', 'open', 'role', 'href', 'contenteditable', 'data-state',
          'data-no-drag',
        ],
      });
      listen('resize', refresh);
      listen('DOMContentLoaded', refresh);
      for (const type of ['scroll', 'load', 'transitionend', 'animationend']) {
        listen(type, (event) => note(event.target), { capture: true, passive: true });
      }
      document.fonts?.addEventListener('loadingdone', refresh);
      listen('pageshow', () => {
        sent = null;
        refresh();
      });
      listen('pagehide', () => {
        sent = null;
        send([]);
      });
      refresh();
    })();
    """
  }

  private static func jsonString(_ value: String) -> String {
    // A plain string always encodes.
    String(decoding: try! JSONEncoder().encode(value), as: UTF8.self)
  }
}
