/** The contract's limit (`PickedElementSchema.selector`). */
const MAX_SELECTOR = 1_000;

/**
 * Attributes pages keep stable for tests and accessibility, in the order they are tried. Each is
 * tried only on the picked element itself: an attribute selector walks the whole document.
 */
const STABLE_ATTRIBUTES = [
  'data-testid',
  'data-test-id',
  'data-test',
  'data-qa',
  'data-cy',
  'name',
  'aria-label',
  'role',
] as const;
/** Longer attribute values make poor selectors (and are rarely stable). */
const MAX_ATTRIBUTE = 200;

/**
 * Ids that frameworks generate per render (React's `:r1:` and `«r1»`, counters such as
 * `ember1234`, hashes): they would not match the same element after a reload.
 */
function generated(id: string): boolean {
  return /[:«»]|\d{4,}|^\d/.test(id) || /^[0-9a-f-]{16,}$/i.test(id);
}

/** Whether `selector` matches `element` and nothing else in the document. */
function matchesOnly(selector: string, element: Element): boolean {
  try {
    const found = document.querySelectorAll(selector);
    return found.length === 1 && found[0] === element;
  } catch {
    // An id or value CSS cannot express after all.
    return false;
  }
}

function byId(element: Element): string | null {
  const id = element.id;
  if (!id || generated(id)) return null;
  const selector = `#${CSS.escape(id)}`;
  return matchesOnly(selector, element) ? selector : null;
}

function byAttribute(element: Element): string | null {
  const tag = CSS.escape(element.localName);
  for (const name of STABLE_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (!value || value.length > MAX_ATTRIBUTE) continue;
    const selector = `${tag}[${name}="${CSS.escape(value)}"]`;
    if (matchesOnly(selector, element)) return selector;
  }
  return null;
}

/** The element's step in a path: its tag, with its place among siblings of that tag if it has any. */
function step(element: Element): string {
  const tag = CSS.escape(element.localName);
  const parent = element.parentElement;
  if (parent === null || element === document.body) return tag;
  const same = [...parent.children].filter((child) => child.localName === element.localName);
  return same.length === 1 ? tag : `${tag}:nth-of-type(${same.indexOf(element) + 1})`;
}

/**
 * A CSS selector that matches only `element` in the top document right now, or null when none
 * fits the contract's length: its id, else a stable attribute, else a path of `:nth-of-type`
 * steps up to the nearest ancestor with a usable id (or `body`). An element inside a page's
 * shadow root is never passed here: picking stops at its shadow host, which the document shows.
 */
export function uniqueSelector(element: Element): string | null {
  const own = byId(element) ?? byAttribute(element);
  if (own !== null) return own;
  const steps: string[] = [];
  for (let current: Element | null = element; current !== null; current = current.parentElement) {
    const anchor = current === element ? null : byId(current);
    if (anchor !== null) {
      steps.unshift(anchor);
      break;
    }
    steps.unshift(step(current));
    if (current === document.body || current === document.documentElement) break;
  }
  const selector = steps.join(' > ');
  return selector.length <= MAX_SELECTOR && matchesOnly(selector, element) ? selector : null;
}
