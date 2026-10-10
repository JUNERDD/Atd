import { useId } from 'react';
import { DROP_PATHS } from './drops.ts';
import './menu-bar.css';

export type StatusState = 'idle' | 'running' | 'attention';

/** The badge's center in the 18 pt image, in the mark's empty upper-right quadrant. */
const BADGE = { x: 13.5, y: 4.5 } as const;
/** The mark at 15 pt, centered in 18 pt: master units → image units. */
const MARK_TRANSFORM = `translate(1.5 1.5) scale(${15 / 84}) translate(-18 -18)`;

interface StatusItemProps {
  state: StatusState;
  /** 0 → 1: the badge's scale, so a scene can pop it in with a spring when the state changes. */
  badge?: number;
}

/**
 * Atd's menu bar item: the Drops mark as the native 18 pt template image draws it
 * (`scripts/export-brand.mjs`): idle is the bare mark; running and attention cut a clearing out of
 * the mark and put a dot, or a disc with an exclamation mark, in its upper-right quadrant. Drawn in
 * `currentColor`.
 */
export function StatusItem({ state, badge = 1 }: StatusItemProps) {
  const id = useId().replace(/[^\w-]/g, '');
  const scale = Math.max(0, badge);
  const cut = state === 'running' ? 4.5 : state === 'attention' ? 5.5 : 0;
  return (
    <svg className="status-item" viewBox="0 0 18 18" aria-hidden="true">
      {cut > 0 ? (
        <mask id={id}>
          <rect width="18" height="18" className="status-item__mask-keep" />
          <circle cx={BADGE.x} cy={BADGE.y} r={cut * scale} className="status-item__mask-cut" />
        </mask>
      ) : null}
      <g mask={cut > 0 ? `url(#${id})` : undefined}>
        <g transform={MARK_TRANSFORM}>
          <path d={DROP_PATHS.upper} />
          <path d={DROP_PATHS.lower} />
        </g>
      </g>
      {state === 'running' ? <circle cx={BADGE.x} cy={BADGE.y} r={3.25 * scale} /> : null}
      {state === 'attention' ? (
        <path
          fillRule="evenodd"
          transform={`translate(${BADGE.x} ${BADGE.y}) scale(${scale})`}
          d="M0-4.25a4.25 4.25 0 1 1 0 8.5a4.25 4.25 0 1 1 0-8.5Z M-.65-2.15a.65 .65 0 0 1 1.3 0V.25a.65 .65 0 0 1-1.3 0Z M0 1.2a.75 .75 0 1 1 0 1.5a.75 .75 0 1 1 0-1.5Z"
        />
      ) : null}
    </svg>
  );
}
