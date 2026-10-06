import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import type { Case } from '../../content/cases';
import { useCopy, useLang } from '../../i18n/lang';
import { casesCopy } from './copy';
import { keyTarget } from './use-gallery';
import './controls.css';

interface CasesControlsProps {
  items: readonly Case[];
  active: number;
  playing: boolean;
  onGo: (index: number) => void;
  onToggle: () => void;
}

/**
 * The gallery's one floating glass capsule: previous, a dot per recording (the current one marked
 * with `aria-current`), next, and play/pause for the current recording. Its buttons are borderless,
 * never glass on glass. Previous and next stay focusable at the ends and only report themselves
 * disabled, so focus is never dropped. Arrow keys, Home and End move the gallery from any of the
 * navigation buttons; on a dot, focus follows to the new current dot.
 */
export function CasesControls({ items, active, playing, onGo, onToggle }: CasesControlsProps) {
  const t = useCopy(casesCopy);
  const lang = useLang();
  const dotsRef = useRef<HTMLOListElement>(null);
  const atStart = active === 0;
  const atEnd = active === items.length - 1;

  const onStepKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const target = keyTarget(event, active, items.length);
    if (target === null) return;
    event.preventDefault();
    onGo(target);
  };

  const onDotKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const target = keyTarget(event, active, items.length);
    if (target === null) return;
    event.preventDefault();
    onGo(target);
    dotsRef.current?.querySelectorAll('button')[target]?.focus();
  };

  return (
    <div className="cases__controls glass">
      <button
        type="button"
        className="btn-plain btn-icon"
        aria-label={t.previous}
        aria-disabled={atStart || undefined}
        onClick={() => {
          if (!atStart) onGo(active - 1);
        }}
        onKeyDown={onStepKey}
      >
        <ChevronLeft aria-hidden="true" />
      </button>
      <ol ref={dotsRef} className="cases__dots" aria-label={t.pick}>
        {items.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              className="cases__dot"
              aria-label={item.title[lang]}
              aria-current={index === active ? 'true' : undefined}
              onClick={() => onGo(index)}
              onKeyDown={onDotKey}
            />
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="btn-plain btn-icon"
        aria-label={t.next}
        aria-disabled={atEnd || undefined}
        onClick={() => {
          if (!atEnd) onGo(active + 1);
        }}
        onKeyDown={onStepKey}
      >
        <ChevronRight aria-hidden="true" />
      </button>
      <span className="cases__divider" aria-hidden="true" />
      <button
        type="button"
        className="btn-plain btn-icon"
        aria-label={t.play}
        aria-pressed={playing}
        onClick={onToggle}
      >
        {playing ? (
          <Pause aria-hidden="true" fill="currentColor" />
        ) : (
          <Play aria-hidden="true" fill="currentColor" />
        )}
      </button>
    </div>
  );
}
