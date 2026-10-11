import { CircleQuestionMark, Search, type LucideIcon } from 'lucide-react';
import openai from '@atd/ui/assets/brands/openai.svg';
import '../tokens.css';
import './controls.css';

/**
 * The app's `IconButton` (`components/icon-button.tsx`): a ghost `icon-sm` Button, 28 pt, its
 * 16 pt Lucide glyph in the foreground, at half opacity while it does nothing.
 */
export function IconButton({
  icon: Icon,
  disabled = false,
}: {
  icon: LucideIcon;
  disabled?: boolean;
}) {
  return (
    <span className="rc-icon-button" data-disabled={disabled || undefined}>
      <Icon className="pk-icon" />
    </span>
  );
}

/** The shared `Switch` at its default size: a 32 × 20 pt track with a 16 pt thumb. */
export function Switch({ checked }: { checked: boolean }) {
  return (
    <span className="rc-switch" data-checked={checked || undefined}>
      <span className="rc-switch__thumb" />
    </span>
  );
}

/** `KbdGroup` of `Kbd` keycaps: 20 pt tall, 12 pt medium text on the muted fill. */
export function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="rc-keys">
      {keys.map((key) => (
        <kbd key={key} className="rc-kbd">
          {key}
        </kbd>
      ))}
    </span>
  );
}

/**
 * A command's `ShortcutRecorder` at rest (`components/shortcut-recorder.tsx`): an outline `sm`
 * pill holding the keys, 3 pt inside its edge, or the prompt to set one in its usual inset.
 */
export function ShortcutPill({ keys, empty }: { keys: readonly string[]; empty: string }) {
  return (
    <span className="rc-shortcut" data-empty={keys.length ? undefined : ''}>
      {keys.length ? <Keys keys={keys} /> : empty}
    </span>
  );
}

/** The settings search field (`settings-search-field.tsx`): an input group led by its search icon. */
export function SearchField({ placeholder }: { placeholder: string }) {
  return (
    <span className="rc-search">
      <Search className="pk-icon rc-search__icon" />
      <span className="rc-search__placeholder">{placeholder}</span>
    </span>
  );
}

/** A default `Button`: 32 pt, primary fill, a leading 16 pt icon 6 pt from its label. */
export function PrimaryButton({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="rc-button">
      <Icon className="pk-icon" />
      {label}
    </span>
  );
}

interface ButtonProps {
  label: string;
  /** `default`: the primary fill; `outline`: a hairline on the window's surface. */
  variant?: 'default' | 'outline' | undefined;
  /** A leading 16 pt Lucide glyph. */
  icon?: LucideIcon | undefined;
  /** A leading provider mark, masked in the label's colour (`ProviderBrand`). */
  brand?: 'openai' | undefined;
  /** Held down: the fill dims a little, as the pressed button does. */
  pressed?: boolean | undefined;
  /** Doing nothing yet (half opacity). */
  disabled?: boolean | undefined;
}

/**
 * A `Button` at its default size: 32 pt, 14 pt medium, its leading glyph or provider mark 6 pt
 * from the label (the provider form's Continue with ChatGPT leads with the OpenAI mark).
 */
export function Button({
  label,
  variant = 'default',
  icon: Icon,
  brand,
  pressed,
  disabled,
}: ButtonProps) {
  return (
    <span
      className="rc-button"
      data-variant={variant}
      data-pressed={pressed || undefined}
      data-disabled={disabled || undefined}
      data-lead={Icon || brand ? '' : undefined}
    >
      {Icon ? <Icon className="pk-icon" /> : null}
      {brand === 'openai' ? (
        <span className="rc-brand" style={{ '--brand': `url("${openai}")` }} />
      ) : null}
      {label}
    </span>
  );
}

/** A field's `Label`, with the `FieldHint` question mark beside it when the field has a hint. */
export function FieldLabel({ label, hint = false }: { label: string; hint?: boolean }) {
  return (
    <span className="rc-label">
      {label}
      {hint ? (
        <span className="rc-label__hint">
          <CircleQuestionMark className="pk-icon" />
        </span>
      ) : null}
    </span>
  );
}
