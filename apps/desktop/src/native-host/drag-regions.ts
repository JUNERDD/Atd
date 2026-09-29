import type { NativeBridge } from '../native-bridge/client';
import type { PostParams } from '../native-bridge/contract';

type Rect = PostParams<'window.dragRegions'>['rects'][number];

/**
 * The surfaces that move the window: the same ones Electron's CSS marks `-webkit-app-region: drag`
 * (`styles.css`, `settings.css`, `agent.css`).
 */
const DRAG_AREAS = [
  '.panel-header',
  '.service-starting',
  '.settings-window',
  '#root > .settings-loading',
].join(',');

/**
 * What stays clickable inside a drag area: controls, and the regions Electron's CSS marks
 * `no-drag` as a whole (the settings navigation and scrolling content, the panel footer).
 */
const NO_DRAG = [
  'button',
  'a[href]',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '[role="combobox"]',
  '[role="tab"]',
  '[contenteditable="true"]',
  '.settings-navigation',
  '.settings-content-scroll',
  '.panel-footer',
].join(',');

const area = ({ width, height }: Rect) => width > 0 && height > 0;

/** `rect` minus `hole`, as up to four rects around the hole. */
function subtract(rect: Rect, hole: Rect): Rect[] {
  const left = Math.max(rect.x, hole.x);
  const top = Math.max(rect.y, hole.y);
  const right = Math.min(rect.x + rect.width, hole.x + hole.width);
  const bottom = Math.min(rect.y + rect.height, hole.y + hole.height);
  if (left >= right || top >= bottom) return [rect];
  const rectRight = rect.x + rect.width;
  const rectBottom = rect.y + rect.height;
  return [
    { x: rect.x, y: rect.y, width: rect.width, height: top - rect.y },
    { x: rect.x, y: bottom, width: rect.width, height: rectBottom - bottom },
    { x: rect.x, y: top, width: left - rect.x, height: bottom - top },
    { x: right, y: top, width: rectRight - right, height: bottom - top },
  ].filter(area);
}

function bounds(element: Element): Rect {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { x: left, y: top, width, height };
}

/**
 * Overlay portals (menus, popovers, dialogs and their scrims) sit above the drag areas; a press on
 * them must reach the page, so they are holes as well.
 */
function portalHoles(root: Element): Rect[] {
  return [...document.body.children]
    .filter(
      (element) =>
        element !== root &&
        element instanceof HTMLElement &&
        getComputedStyle(element).pointerEvents !== 'none',
    )
    .map(bounds)
    .filter(area);
}

function dragRects(root: Element): Rect[] {
  const portals = portalHoles(root);
  return [...document.querySelectorAll(DRAG_AREAS)].flatMap((element) => {
    const holes = [...element.querySelectorAll(NO_DRAG)].map(bounds).filter(area);
    let rects = [bounds(element)].filter(area);
    for (const hole of [...holes, ...portals])
      rects = rects.flatMap((rect) => subtract(rect, hole));
    return rects;
  });
}

/**
 * Publishes the window drag regions to the shell, which starts a native window drag for a press
 * inside one (WKWebView has no `-webkit-app-region`). It recomputes once per frame after a layout
 * or DOM change, sends only changed sets, pauses while the panel is hidden, and clears the regions
 * when the page goes away.
 */
export function publishDragRegions(bridge: NativeBridge, root: HTMLElement): () => void {
  let frame = 0;
  let sent = '';
  let visible = true;

  const update = () => {
    frame = 0;
    const rects = dragRects(root);
    const signature = JSON.stringify(rects);
    if (signature === sent) return;
    sent = signature;
    bridge.post('window.dragRegions', { rects });
  };
  const schedule = () => {
    if (!frame && visible) frame = requestAnimationFrame(update);
  };
  const resizeObserver = new ResizeObserver(schedule);
  let observed: Element[] = [];
  // Streamed transcript DOM mutates constantly; only a changed set of drag areas re-observes.
  const observeAreas = () => {
    const areas = [...document.querySelectorAll(DRAG_AREAS)];
    if (areas.length === observed.length && areas.every((item, index) => item === observed[index]))
      return;
    resizeObserver.disconnect();
    observed = areas;
    for (const element of areas) resizeObserver.observe(element);
  };
  const mutationObserver = new MutationObserver(() => {
    observeAreas();
    schedule();
  });
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'hidden', 'style', 'data-state'],
  });
  const stopVisibility = bridge.on('window.visibility', (state) => {
    visible = state.visible;
    schedule();
  });
  const clear = () => bridge.post('window.dragRegions', { rects: [] });
  window.addEventListener('resize', schedule);
  window.addEventListener('pagehide', clear);
  observeAreas();
  schedule();

  return () => {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    stopVisibility();
    window.removeEventListener('resize', schedule);
    window.removeEventListener('pagehide', clear);
    clear();
  };
}
