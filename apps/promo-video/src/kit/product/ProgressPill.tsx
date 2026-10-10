import type { ReactNode } from 'react';
import { Bot, ShieldAlert } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { clamp01 } from '../../motion/ease.ts';
import { springs } from '../../motion/spring.ts';
import { arrival, present } from './motion.ts';
import { fill, strings } from './strings.ts';
import './tokens.css';
import './progress-pill.css';

export type PillPart = 'hitl' | 'todos' | 'subagents';

export interface ProgressPillProps {
  lang: Lang;
  /** The plan's step, "Step n / m"; omit for no step part. */
  step?: { current: number; total: number } | undefined;
  /** The ring's completed share, 0 → 1, which the caller springs as todos tick. */
  ring?: number | undefined;
  /** Subagents running ("2 running"); 0 or omitted hides the part. */
  running?: number | undefined;
  /** "Waiting for your approval" leads the pill while an approval waits. */
  waiting?: boolean | undefined;
  /** The part whose popover view is open: its wash deepens. */
  open?: PillPart | undefined;
  /** Seconds since the pill appeared: it fades and scales up out of the composer. */
  age?: number | undefined;
}

/**
 * The composer's progress capsule (`progress-pill.tsx`): one 24 pt glass capsule of up to three
 * parts split by 12 pt hairlines: what waits on you, the plan's ring and "Step n / m", and the
 * subagents running. 12 pt medium text, 12 pt muted icons, the ring's arc in the progress green.
 */
export function ProgressPill({
  lang,
  step,
  ring = 0,
  running = 0,
  waiting,
  open,
  age,
}: ProgressPillProps) {
  if (!present(age)) return null;
  const t = strings[lang].progress;
  const parts: { key: PillPart; node: ReactNode }[] = [];
  if (waiting)
    parts.push({
      key: 'hitl',
      node: (
        <>
          <ShieldAlert className="pk-icon" />
          <span>{t.waitingApproval}</span>
        </>
      ),
    });
  if (step)
    parts.push({
      key: 'todos',
      node: (
        <>
          <svg className="pk-pill__ring" viewBox="0 0 16 16">
            <circle className="pk-pill__track" cx="8" cy="8" r="6" />
            {ring > 0 && (
              <circle
                className="pk-pill__value"
                cx="8"
                cy="8"
                r="6"
                pathLength={100}
                style={{ '--ring': clamp01(ring) * 100 }}
              />
            )}
          </svg>
          <span>{fill(t.step, { current: step.current, total: step.total })}</span>
        </>
      ),
    });
  if (running > 0)
    parts.push({
      key: 'subagents',
      node: (
        <>
          <Bot className="pk-icon" />
          <span>{fill(t.running, { count: running })}</span>
        </>
      ),
    });
  return (
    <div className="pk-pill" style={{ '--in': arrival(age, springs.snappy) }}>
      {parts.map(({ key, node }, index) => (
        <span key={key} className="pk-pill__group">
          {index > 0 && <i className="pk-pill__divider" />}
          <span className="pk-pill__part" data-open={open === key || undefined}>
            {node}
          </span>
        </span>
      ))}
    </div>
  );
}
