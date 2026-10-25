import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { contentOffset } from './find-geometry';
import type { FindHit } from './find-hits';

/** Where `offset` sits in the scrolled content, as a percentage of its height. */
function percentOf(offset: number, total: number): number {
  return Math.min(100, Math.max(0, (offset / Math.max(1, total)) * 100));
}

/**
 * The matches' marks along the transcript's trailing edge: a track standing for the whole
 * conversation, a band for the part in view, and a mark per match at its place in the content.
 * Marks in the user's own messages are darker than the answers' and steps', the current one is
 * orange and wider. A mark makes its match current; the wheel over the track scrolls the
 * transcript. The marks follow the content as it settles; the band follows every scroll.
 */
export function FindRuler({
  viewport,
  hits,
  current,
  onPick,
}: {
  viewport: HTMLDivElement | null;
  hits: readonly FindHit[];
  current: number;
  onPick: (index: number) => void;
}) {
  const { t } = useTranslation('panel');
  const band = useRef<HTMLSpanElement>(null);
  const [marks, setMarks] = useState<readonly number[]>([]);

  useLayoutEffect(() => {
    if (!viewport) return;
    // Written to the element directly: a scroll moves only the band, never the marks.
    const placeBand = () => {
      const total = viewport.scrollHeight;
      band.current?.style.setProperty(
        '--find-band-top',
        `${percentOf(viewport.scrollTop, total)}%`,
      );
      band.current?.style.setProperty(
        '--find-band-height',
        `${percentOf(viewport.clientHeight, total)}%`,
      );
    };
    let frame = 0;
    const measure = () => {
      frame = 0;
      const total = viewport.scrollHeight;
      setMarks(hits.map((hit) => percentOf(contentOffset(viewport, hit.range), total)));
      placeBand();
    };
    measure();
    // Turns take their real height once shown, and answers grow while streaming.
    const remeasure = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure);
    observer?.observe(viewport);
    if (viewport.firstElementChild) observer?.observe(viewport.firstElementChild);
    viewport.addEventListener('scroll', placeBand, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      viewport.removeEventListener('scroll', placeBand);
    };
  }, [viewport, hits]);

  if (hits.length === 0) return null;
  return (
    <div
      className="conversation-find-ruler"
      role="toolbar"
      aria-orientation="vertical"
      tabIndex={-1}
      aria-label={t('find.ruler')}
      // A mark makes its match current without taking focus from the find field.
      onMouseDown={(event) => event.preventDefault()}
      onWheel={(event) => viewport?.scrollBy({ top: event.deltaY })}
    >
      <span ref={band} className="conversation-find-band" />
      {hits.map((hit, index) => {
        const top = marks[index];
        if (top === undefined) return null;
        return (
          <button
            key={index}
            type="button"
            tabIndex={-1}
            className="conversation-find-mark"
            data-mine={hit.mine || undefined}
            data-current={index === current || undefined}
            style={{ '--find-mark-top': `${top}%` } as CSSProperties}
            aria-label={t('find.match', { index: index + 1, total: hits.length })}
            onClick={() => onPick(index)}
          />
        );
      })}
    </div>
  );
}
