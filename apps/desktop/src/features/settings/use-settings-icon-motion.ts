import { useEffect, useRef, type RefObject } from 'react';
import { useIconMotion } from '@atd/ui/lib/icon-motion';
import { findSettingsSection, type SettingsSectionId } from './settings-sections';

/** Plays only after selection changes; leaving the section cancels its unfinished gesture. */
export function useSettingsIconMotion(
  list: RefObject<HTMLElement | null>,
  current: SettingsSectionId,
  disabled: boolean,
  searching: boolean,
) {
  const { play, cancel } = useIconMotion({ disabled });
  const previous = useRef(current);
  // Changing the query's presence replaces the rows, so cancel the outgoing SVG as well.
  useEffect(() => {
    if (previous.current === current) return;
    previous.current = current;
    const row = list.current?.querySelector<HTMLButtonElement>('[aria-current="page"]');
    if (!row || row.disabled) return;
    const icon = row.querySelector('svg');
    const section = findSettingsSection(current);
    if (!icon || !section) return;
    play(icon, section.motion);
    return cancel;
  }, [cancel, current, list, play, searching]);
}
