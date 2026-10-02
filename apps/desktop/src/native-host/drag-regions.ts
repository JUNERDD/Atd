import type { NativeBridge, PostParams } from '../native-bridge/client';

type Rect = PostParams<'window.dragRegions'>['rects'][number];

/**
 * The surfaces that move the window: the panel header, the service-starting surface that stands
 * in for it, the settings window's title bar strips (the sidebar strip under the traffic lights
 * and the content header), and the window-level loading splash.
 */
const DRAG_AREAS = [
  '.panel-header',
  '.service-starting',
  '.settings-titlebar',
  '#root > .settings-loading',
].join(',');

/**
 * What stays clickable inside a drag area: controls, and regions that are interactive as a whole
 * (the panel footer).
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
 * inside one (WKWebView has no CSS drag regions). It recomputes once per frame after a layout
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
  // The areas and the holes in them: a hole can resize while the DOM keeps its shape, such as
  // the header's title button when its text changes. Streamed transcript DOM mutates constantly;
  // only a changed set of elements re-observes.
  const observeAreas = () => {
    const targets = [...document.querySelectorAll(DRAG_AREAS)].flatMap((area) => [
      area,
      ...area.querySelectorAll(NO_DRAG),
    ]);
    const same = targets.every((item, index) => item === observed[index]);
    if (targets.length === observed.length && same) return;
    resizeObserver.disconnect();
    observed = targets;
    for (const element of targets) resizeObserver.observe(element);
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
