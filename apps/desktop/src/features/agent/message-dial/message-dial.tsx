/* oxlint-disable jsx-a11y/prefer-tag-over-role -- A range input cannot draw the arc or turn with a drag's momentum; the dial implements the slider's keyboard model itself. */
import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Kbd, KbdGroup } from '@atd/ui/components/kbd';
import type { ConversationControls } from '../transcript/conversation-controls';
import {
  arcPath,
  DIAL_HEIGHT,
  dialGeometry,
  notchPath,
  positionAtX,
  tickAt,
  tickLength,
  visibleRange,
} from './dial-geometry';
import { useDialMotion } from './use-dial-motion';
import './message-dial.css';

/** How the popover around the dial ends it: where it is, or back where the reader was. */
export type DialHandle = { keep: () => void; goBack: () => void };

/**
 * The conversation's user messages as ticks on an arc that turns under a fixed notch: the tick at
 * the notch is the selected message, named below the arc with its place in the conversation. A
 * tick's length follows its turn's height. Turning the dial scrolls the transcript along
 * (`useDialMotion`); Enter ends it where it is (`onDone`), and the popover ends it through
 * `handle` for Escape and outside clicks.
 */
export function MessageDial({
  controls,
  handle,
  onDone,
}: {
  controls: ConversationControls;
  handle: Ref<DialHandle>;
  onDone: () => void;
}) {
  const { t } = useTranslation('tasks');
  // A gradient id usable in `url(#…)`: React's ids carry characters a fragment does not take.
  const fade = `message-dial-fade-${useId().replace(/[^\w-]/g, '')}`;
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(0);
  const geometry = useMemo(() => dialGeometry(width), [width]);
  const aim = (clientX: number, position: number) => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return position;
    return positionAtX(geometry, position, (clientX - rect.left) * (width / rect.width));
  };
  const dial = useDialMotion(controls, aim);
  const { position, near, heights } = dial;
  useImperativeHandle(handle, () => ({ keep: dial.keep, goBack: dial.goBack }));

  useLayoutEffect(() => {
    const node = svg.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current?.focus({ preventScroll: true }), []);

  const { prompts } = controls;
  const total = prompts.length;
  const label = prompts[near]?.label ?? '';
  const { start, end } = visibleRange(geometry, position, total);
  const ticks = width > 0 ? prompts.slice(start, end + 1) : [];

  return (
    <>
      <div
        ref={(node) => {
          root.current = node;
          dial.ref(node);
        }}
        className="message-dial"
        tabIndex={0}
        role="slider"
        aria-label={t('transcript.prompts.listLabel')}
        aria-orientation="horizontal"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={near + 1}
        aria-valuetext={t('transcript.prompts.valueText', { current: near + 1, total, label })}
        data-dragging={dial.dragging || undefined}
        {...dial.handlers}
        onKeyDown={(event) => {
          dial.handlers.onKeyDown(event);
          if (event.defaultPrevented || event.key !== 'Enter') return;
          event.preventDefault();
          dial.keep();
          onDone();
        }}
      >
        <svg
          ref={svg}
          className="message-dial-svg"
          viewBox={`0 0 ${Math.max(width, 1)} ${DIAL_HEIGHT}`}
          aria-hidden
        >
          <defs>
            <linearGradient id={fade} x1="0" x2="1" y1="0" y2="0">
              <stop className="message-dial-stop" offset="0" stopOpacity="0" />
              <stop className="message-dial-stop" offset="0.3" stopOpacity="0.55" />
              <stop className="message-dial-stop" offset="0.7" stopOpacity="0.55" />
              <stop className="message-dial-stop" offset="1" stopOpacity="0" />
            </linearGradient>
          </defs>
          {width > 0 && (
            <>
              <path className="message-dial-arc" d={arcPath(geometry)} stroke={`url(#${fade})`} />
              <g className="message-dial-ticks">
                {ticks.map((entry, offset) => {
                  const index = start + offset;
                  const selected = index === near;
                  const tick = tickAt(
                    geometry,
                    index,
                    position,
                    tickLength(heights[index]),
                    selected,
                  );
                  if (!tick) return null;
                  return (
                    <line
                      key={entry.turnId}
                      x1={tick.x1}
                      y1={tick.y1}
                      x2={tick.x2}
                      y2={tick.y2}
                      opacity={tick.opacity}
                      data-selected={selected || undefined}
                    />
                  );
                })}
              </g>
              <path className="message-dial-notch" d={notchPath(geometry)} />
            </>
          )}
        </svg>
        <div className="message-dial-label">
          <span className="message-dial-count">
            {near + 1}
            <span className="message-dial-total"> / {total}</span>
          </span>
          <span className="min-w-0 truncate" title={label}>
            {label}
          </span>
        </div>
      </div>
      <div className="message-dial-keys">
        <span className="message-dial-drag-hint">{t('transcript.prompts.hint.drag')}</span>
        <span className="message-dial-hint">
          <KbdGroup>
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>
          </KbdGroup>
          {t('transcript.prompts.hint.step')}
        </span>
        <span className="message-dial-hint">
          <Kbd>↩</Kbd>
          {t('transcript.prompts.hint.keep')}
        </span>
        <span className="message-dial-hint">
          <Kbd>Esc</Kbd>
          {t('transcript.prompts.hint.back')}
        </span>
      </div>
    </>
  );
}
