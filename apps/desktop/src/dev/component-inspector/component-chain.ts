/**
 * Dev-only click-to-component inspector: resolves a DOM node to the chain of components that
 * rendered it.
 *
 * The Babel plugin tags every JSX element with `data-insp-*` props naming the file, position and
 * owning component of that call site. A DOM node keeps only one set: a component that spreads
 * its props onto its root (`<Button {...props}>`) overwrites the caller's tags with its own, and
 * a component that renders no element of its own leaves no tag at all. Each React fiber's props
 * still hold the tags of the JSX that created it, so the chain walks fibers, not DOM parents.
 */

export interface ComponentNode {
  comp: string;
  file: string;
  line: string;
  col: string;
  element: Element;
}

/** The fields of a React fiber the walk reads; React's internals carry many more. */
interface Fiber {
  return: Fiber | null;
  child: Fiber | null;
  stateNode: unknown;
  memoizedProps: unknown;
}

const FIBER_KEY_PREFIX = '__reactFiber$';

/** The shared shadcn package; its components are wrappers, rarely the source a click looks for. */
const SHARED_UI_SOURCE = '/packages/ui/src/';

/** React DOM stores each rendered node's fiber under a per-root `__reactFiber$<id>` key. */
function fiberOf(element: Element): Fiber | null {
  const key = Object.keys(element).find((name) => name.startsWith(FIBER_KEY_PREFIX));
  return key ? (Reflect.get(element, key) as Fiber) : null;
}

/** The first DOM element a fiber renders, for highlighting its row. */
function hostElementOf(fiber: Fiber): Element | null {
  let current: Fiber | null = fiber;
  while (current) {
    if (current.stateNode instanceof Element) return current.stateNode;
    current = current.child;
  }
  return null;
}

function tagOf(props: unknown, name: string): string | null {
  if (typeof props !== 'object' || props === null) return null;
  const value: unknown = Reflect.get(props, `data-insp-${name}`);
  return typeof value === 'string' ? value : null;
}

function nodeFrom(props: unknown, element: Element): ComponentNode | null {
  const file = tagOf(props, 'file');
  const comp = tagOf(props, 'comp');
  if (!file || !comp) return null;
  return {
    comp,
    file,
    line: tagOf(props, 'line') ?? '1',
    col: tagOf(props, 'col') ?? '1',
    element,
  };
}

/**
 * Leaf-first component chain from the target element to the root. Each component appears once,
 * at the call site closest to the target, so its row opens the line that renders the target.
 */
export function collectHierarchy(target: Element): ComponentNode[] {
  const hierarchy: ComponentNode[] = [];
  const seenComps = new Set<string>();

  for (let fiber = fiberOf(target); fiber; fiber = fiber.return) {
    const node = nodeFrom(fiber.memoizedProps, hostElementOf(fiber) ?? target);
    if (node && /^[A-Z]/.test(node.comp) && !seenComps.has(node.comp)) {
      seenComps.add(node.comp);
      hierarchy.push(node);
    }
  }

  return hierarchy;
}

/**
 * What a left click opens: the call site in the closest component outside the shared UI package,
 * so a `Button` inside `ContextUsageRing` opens `ContextUsageRing`. The leaf when every component
 * in the chain is shared.
 */
export function resolveOpenTarget(target: Element): ComponentNode | null {
  const hierarchy = collectHierarchy(target);
  return hierarchy.find((node) => !node.file.includes(SHARED_UI_SOURCE)) ?? hierarchy[0] ?? null;
}
