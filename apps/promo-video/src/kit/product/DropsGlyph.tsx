/**
 * The Drops mark as the app draws it inside its own interface: the two teardrops of
 * `packages/ui/src/assets/brands/atd/symbol.svg`, inlined, in `currentColor`. The SVG's box is the
 * mark's own bounds, so `size` is the mark's visible width; never stretch it.
 */
export function DropsGlyph({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="18 18 84 84" aria-hidden="true">
      <path fill="currentColor" d="M60 60H39A21 21 0 1 1 60 39Z" />
      <path fill="currentColor" d="M60 60H81A21 21 0 1 1 60 81Z" />
    </svg>
  );
}
