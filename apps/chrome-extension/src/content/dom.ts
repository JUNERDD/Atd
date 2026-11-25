/**
 * The content script builds its DOM only through these helpers: `createElement`, attributes and
 * `textContent`, never HTML parsing of data, so text from a page, a run or a command can never
 * become markup inside the extension's UI.
 */

type Attr = string | number | boolean | undefined;
type Child = Node | string | null | undefined | false;
type Listeners = { [E in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[E]) => void };

export interface Props {
  class?: string;
  attrs?: Record<string, Attr>;
  /** Event listeners, added with `addEventListener`. */
  on?: Listeners;
}

/** An element with its attributes, listeners and children (strings become text nodes). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props.class) element.className = props.class;
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
  for (const [type, listener] of Object.entries(props.on ?? {})) {
    element.addEventListener(type, listener as EventListener);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

/**
 * Attributes for a Lucide icon at `size` px, decorative (the control around it carries the name).
 * Icons themselves are imported by name where they are used and built with Lucide's
 * `createElement`.
 */
export function iconAttrs(size: number, extra = ''): Record<string, string | number> {
  return { width: size, height: size, 'aria-hidden': 'true', class: `i ${extra}`.trim() };
}

export interface ButtonOptions {
  label?: string;
  icon?: Element | null;
  /** `solid` is the primary action, `outline` a secondary one, `icon` a square icon button. */
  variant?: 'solid' | 'outline' | 'icon';
  /** Names the action for focus restoration after a re-render. */
  act: string;
  ariaLabel?: string;
  disabled?: boolean;
  onClick: () => void;
}

/**
 * One glass button (`.gbtn`), the HUD's only button. Its label is its own element (`.gbtn-label`),
 * so a crowded row can show only the icon beside it (`hud/compact.ts`).
 */
export function gbtn(options: ButtonOptions): HTMLButtonElement {
  const label = options.ariaLabel ?? (options.variant === 'icon' ? options.label : undefined);
  return h(
    'button',
    {
      class: options.variant ? `gbtn ${options.variant}` : 'gbtn',
      attrs: {
        type: 'button',
        'data-act': options.act,
        'aria-label': label,
        title: options.variant === 'icon' ? options.label : undefined,
        disabled: options.disabled,
      },
      on: { click: () => options.onClick() },
    },
    options.icon ?? null,
    options.variant === 'icon' || !options.label
      ? null
      : h('span', { class: 'gbtn-label' }, options.label),
  );
}

/** The `data-act` of `active` (a layer's focused control), so a re-render can restore its focus. */
export function focusedAct(active: Element | null): string | null {
  return active instanceof HTMLElement ? (active.dataset.act ?? null) : null;
}

/** Focuses the control named `act` inside `container` when there is one. */
export function refocus(container: ParentNode, act: string | null): void {
  if (!act) return;
  const target = container.querySelector<HTMLElement>(`[data-act="${CSS.escape(act)}"]`);
  target?.focus({ preventScroll: true });
}
