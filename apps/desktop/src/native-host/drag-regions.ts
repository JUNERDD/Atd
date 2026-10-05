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
 * The boxes that place `areas`: each area with everything inside it (its holes, and text whose
 * size shifts them, such as the header's title), and the children of every ancestor below the
 * body (the boxes laid out around an area, such as the settings sidebar card above the content
 * header in the narrow layout). Areas sit in the window chrome, outside scroll containers, so
 * scrolling never moves them.
 */
function placingBoxes(areas: readonly Element[]): Set<Element> {
  const boxes = new Set<Element>();
  for (const area of areas) {
    for (const element of [area, ...area.querySelectorAll('*')]) boxes.add(element);
    let node = area;
    while (node.parentElement && node.parentElement !== document.body) {
      const parent = node.parentElement;
      for (const sibling of parent.children) boxes.add(sibling);
      node = parent;
    }
  }
  return boxes;
}

/**
 * Publishes the window drag regions to the shell, which starts a native window drag for a press
 * inside one (WKWebView has no CSS drag regions). It recomputes once per frame after a change that
 * can move, reveal or hide a region, sends only changed sets, pauses while the panel is hidden,
 * and clears the regions when the page goes away.
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
  // Size changes of the placing boxes, including those without a DOM change, such as a hole whose
  // text changed; only a changed set of boxes re-observes.
  const resizeObserver = new ResizeObserver(schedule);
  let areas: Element[] = [];
  let placing = new Set<Element>();
  const observeAreas = () => {
    areas = [...document.querySelectorAll(DRAG_AREAS)];
    const next = placingBoxes(areas);
    if (next.size === placing.size && [...next].every((box) => placing.has(box))) return;
    resizeObserver.disconnect();
    placing = next;
    for (const box of next) resizeObserver.observe(box);
  };
  // Streamed transcript DOM, scroll thumbs and other content mutate every frame far from any area,
  // so only a mutation that can change a region wakes the publisher: outside the root (the body
  // and its overlay portals), on a placing box, on an element that is or contains an area, or
  // adding or removing an area.
  const affectsRegions = ({ target, addedNodes, removedNodes }: MutationRecord) =>
    !root.contains(target) ||
    (target instanceof Element && (placing.has(target) || target.matches(DRAG_AREAS))) ||
    areas.some((area) => target.contains(area)) ||
    [...addedNodes].some(
      (node) =>
        node instanceof Element &&
        (node.matches(DRAG_AREAS) || node.querySelector(DRAG_AREAS) !== null),
    ) ||
    [...removedNodes].some((node) => areas.some((area) => node.contains(area)));
  const mutationObserver = new MutationObserver((records) => {
    if (!records.some(affectsRegions)) return;
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
