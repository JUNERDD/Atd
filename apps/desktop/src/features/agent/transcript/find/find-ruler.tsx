import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { measureRulerOffsets } from './find-geometry';
import type { FindHit } from './find-hits';

/** Bounds rendered marks and geometry reads on large match counts. */
const MAX_RULER_MARKS = 160;

interface RulerMark {
  index: number;
  top: number;
  mine: boolean;
}

/** Picks up to `MAX_RULER_MARKS` evenly distributed hit indices, always keeping `current`. */
function sampleHitIndices(count: number, current: number): number[] {
  if (count <= MAX_RULER_MARKS) return Array.from({ length: count }, (_, index) => index);
  const stride = count / MAX_RULER_MARKS;
  const indices: number[] = [];
  let hasCurrent = false;
  for (let slot = 0; slot < MAX_RULER_MARKS; slot += 1) {
    const index = Math.min(count - 1, Math.floor(slot * stride));
    if (indices[indices.length - 1] !== index) indices.push(index);
    if (index === current) hasCurrent = true;
  }
  if (!hasCurrent && current >= 0 && current < count) {
    indices.push(current);
    indices.sort((a, b) => a - b);
  }
  return indices;
}

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
  const [measured, setMeasured] = useState<{
    hits: readonly FindHit[];
    marks: readonly RulerMark[];
  } | null>(null);
  const marks = measured?.hits === hits ? measured.marks : [];
  const sampledCurrent = hits.length > MAX_RULER_MARKS ? current : -1;
  const sampled = useMemo(
    () => sampleHitIndices(hits.length, sampledCurrent),
    [hits.length, sampledCurrent],
  );

  useLayoutEffect(() => {
    if (!viewport || hits.length === 0) return;
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
      const offsets = measureRulerOffsets(viewport, hits, sampled);
      setMeasured({
        hits,
        marks: sampled.map((hitIndex, slot) => ({
          index: hitIndex,
          top: percentOf(offsets[slot] ?? 0, total),
          mine: hits[hitIndex]?.mine ?? false,
        })),
      });
      placeBand();
    };
    placeBand();
    // Turns take their real height once shown, and answers grow while streaming.
    const remeasure = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    remeasure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure);
    observer?.observe(viewport);
    if (viewport.firstElementChild) observer?.observe(viewport.firstElementChild);
    viewport.addEventListener('scroll', placeBand, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      viewport.removeEventListener('scroll', placeBand);
    };
  }, [viewport, hits, sampled]);

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
      {marks.map((mark) => (
        <button
          key={mark.index}
          type="button"
          tabIndex={-1}
          className="conversation-find-mark"
          data-mine={mark.mine || undefined}
          data-current={mark.index === current || undefined}
          style={{ '--find-mark-top': `${mark.top}%` } as CSSProperties}
          aria-label={t('find.match', { index: mark.index + 1, total: hits.length })}
          onClick={() => onPick(mark.index)}
        />
      ))}
    </div>
  );
}
