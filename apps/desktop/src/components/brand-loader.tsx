import './brand-loader.css';
import './brand-loader-motion.css';

/**
 * The Atd mark as a window-level loading indicator: its two drops twine around each other, each
 * passing in front of the other in turn and back through the mark, never coming to rest
 * (`brand-loader.css`; the motion is baked in `brand-loader-motion.css`). Like `Spinner` it is
 * decorative, so a caller names the state in visible text next to it. Inline and in-control
 * progress keeps `Spinner`: at 16px the crossing would not read.
 */
export function BrandLoader() {
  return (
    <span data-slot="brand-loader" aria-hidden className="brand-loader">
      <span className="brand-loader-mark">
        <span className="brand-loader-drop" data-drop="a" />
        <span className="brand-loader-drop" data-drop="b" />
      </span>
    </span>
  );
}
