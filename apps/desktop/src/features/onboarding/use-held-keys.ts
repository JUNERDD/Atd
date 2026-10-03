import { useEffect, useState } from 'react';
import { acceleratorToHotkey } from '../../lib/shortcuts';

const MODIFIERS = ['meta', 'ctrl', 'alt', 'shift'] as const;
type Modifier = (typeof MODIFIERS)[number];

interface Held {
  modifiers: Record<Modifier, boolean>;
  /** The non-modifier key down, as `matchesAccelerator` normalizes `event.code`. */
  key: string | null;
}

const NOTHING_HELD: Held = {
  modifiers: { meta: false, ctrl: false, alt: false, shift: false },
  key: null,
};

const isModifier = (part: string): part is Modifier =>
  (MODIFIERS as readonly string[]).includes(part);

function physicalKey(event: KeyboardEvent) {
  return event.code.toLowerCase().replace(/key|digit|numpad/, '');
}

/**
 * Which parts of `accelerator` the user is holding right now, in the accelerator's order, so the
 * guide's keycaps can follow the keyboard. The shell's global shortcut swallows the last key, so
 * mostly the modifiers show; the panel appearing is the signal that the shortcut fired. Everything
 * is released when the window loses focus (the panel takes it), since its key-ups never arrive.
 */
export function useHeldKeys(accelerator: string, platform: string): boolean[] {
  const [held, setHeld] = useState(NOTHING_HELD);
  useEffect(() => {
    function update(event: KeyboardEvent) {
      const modifiers = {
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
      };
      // WebKit drops the key-up of a key released while Command is held, so a key counts as held
      // only from its key-down until the next key event of any kind.
      const key =
        event.type === 'keydown' && !/^(meta|control|alt|shift)/i.test(event.key)
          ? physicalKey(event)
          : null;
      setHeld({ modifiers, key });
    }
    const release = () => setHeld(NOTHING_HELD);
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', update);
      window.removeEventListener('keyup', update);
      window.removeEventListener('blur', release);
    };
  }, []);
  return acceleratorToHotkey(accelerator, platform)
    .split('+')
    .map((part) => (isModifier(part) ? held.modifiers[part] : held.key === part));
}
