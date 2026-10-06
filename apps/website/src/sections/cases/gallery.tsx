import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { cases } from '../../content/cases';
import { useCopy } from '../../i18n/lang';
import { useInView } from '../../lib/use-in-view';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { CaseCard } from './case-card';
import { CasesControls } from './controls';
import { casesCopy } from './copy';
import { useGallery } from './use-gallery';
import { usePageVisible } from './use-page-visible';
import './cases.css';

/** `auto` plays unless the visitor prefers reduced motion; the toggle turns it `on` or `off`. */
type Playback = 'auto' | 'on' | 'off';

const subscribeNever = () => () => {};

/** `false` in the prerendered markup and while hydrating it, `true` once the page runs. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/**
 * A horizontal, natively scrolling and snapping gallery of the cases, with one glass capsule of
 * controls under it. Nothing advances by itself: only the current card's recording plays, and only
 * while playback is on, the gallery is in view and the page is visible.
 *
 * The scroller is a named region. Browsers that make a scroller without focusable content
 * keyboard-focusable (Chrome, Firefox) move it a card per arrow key through its snap points; the
 * capsule's buttons take arrow keys too, so every browser has the same keyboard path.
 */
export function CasesGallery() {
  const t = useCopy(casesCopy);
  const viewportRef = useRef<HTMLElement>(null);
  const { active, go } = useGallery(viewportRef, cases.length);
  const inView = useInView(viewportRef, { threshold: 0.25 });
  const near = useInView(viewportRef, { rootMargin: '50% 0px' });
  const pageVisible = usePageVisible();
  const reducedMotion = useReducedMotion();
  const hydrated = useHydrated();
  const [playback, setPlayback] = useState<Playback>('auto');
  const playing = playback === 'on' || (playback === 'auto' && !reducedMotion);
  const onBlocked = useCallback(() => setPlayback('off'), []);

  return (
    <div className="cases" data-enhanced={hydrated ? '' : undefined}>
      <section ref={viewportRef} className="cases__viewport reveal" aria-label={t.gallery}>
        <ul className="cases__track">
          {cases.map((item, index) => (
            <CaseCard
              key={item.id}
              item={item}
              index={index}
              total={cases.length}
              active={index === active}
              near={near && Math.abs(index - active) <= 1}
              playing={playing}
              live={playing && inView && pageVisible}
              onBlocked={onBlocked}
            />
          ))}
        </ul>
      </section>
      <CasesControls
        items={cases}
        active={active}
        playing={playing}
        onGo={go}
        onToggle={() => setPlayback(playing ? 'off' : 'on')}
      />
    </div>
  );
}
