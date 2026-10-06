import './keycap.css';

interface KeycapProps {
  /** The legend printed on the key, such as `⌘`. */
  label: string;
  /** The spoken name when the legend is a symbol, such as `Command`. */
  name?: string;
  /** A wider key, such as Space. */
  wide?: boolean;
  /** Shows the key held down. */
  pressed?: boolean;
}

/** A retro keycap: a sculpted top face over a lip that sinks when the key is held. */
export function Keycap({ label, name, wide = false, pressed = false }: KeycapProps) {
  return (
    <kbd
      className="keycap"
      data-wide={wide ? '' : undefined}
      data-pressed={pressed ? '' : undefined}
      aria-label={name}
    >
      <span className="keycap__face">{label}</span>
    </kbd>
  );
}
