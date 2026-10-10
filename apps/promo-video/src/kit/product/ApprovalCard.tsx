import { X } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { clamp01 } from '../../motion/ease.ts';
import { springs } from '../../motion/spring.ts';
import { arrival, present } from './motion.ts';
import { fill, strings } from './strings.ts';
import './tokens.css';
import './activity.css';
import './popover.css';
import './approval.css';

export type ApprovalScope = 'editOutside' | 'writeOutside' | 'readOutside' | 'bash' | 'automation';

export interface ApprovalCardProps {
  lang: Lang;
  /**
   * What the agent asks to do, as the app titles it. A terminal command (`bash`) offers Allow once,
   * Always allow “entry”, Deny; every other tool offers Allow once, Allow this tool, Decline.
   */
  scope: ApprovalScope;
  /** The call's detail: a path and a change summary, or the command line. */
  detail: string;
  /** For `bash`, the allowlist entry its second button names (`npm test`). */
  entry?: string | undefined;
  /** The decision held down (0 Allow once, 1 the second, 2 Deny/Decline), with `press` 0 → 1. */
  pressed?: 0 | 1 | 2 | undefined;
  press?: number | undefined;
  /** Seconds since it opened. */
  age?: number | undefined;
}

/**
 * An approval in the composer popover's HITL view (`hitl-panel.tsx`, `approval-controls.tsx`): a
 * header with its close button and the scope as title, the detail on the tool card surface, then
 * the three decisions as outline buttons with their keys, bottom right. None is styled as the
 * recommended answer, as in the app.
 */
export function ApprovalCard({
  lang,
  scope,
  detail,
  entry = '',
  pressed,
  press = 0,
  age,
}: ApprovalCardProps) {
  if (!present(age)) return null;
  const t = strings[lang].approval;
  const bash = scope === 'bash';
  const decisions = [
    { label: t.allowOnce, keys: ['Return'] },
    { label: bash ? fill(t.alwaysAllow, { entry }) : t.allowTool, keys: ['⇧', 'Return'] },
    { label: bash ? t.deny : t.decline, keys: ['⎋'] },
  ];
  return (
    <div className="glass pk-popover pk-approval" style={{ '--in': arrival(age, springs.snappy) }}>
      <div className="pk-approval__header">
        <span className="pk-approval__close">
          <X className="pk-icon" />
        </span>
        <span className="pk-approval__title">{t.scope[scope]}</span>
      </div>
      <div className="pk-approval__region">
        <div className="pk-card">
          <pre className="pk-card__content pk-approval__detail">{detail}</pre>
        </div>
        <div className="pk-approval__actions">
          {decisions.map((decision, index) => (
            <span
              key={index}
              className="pk-button"
              style={{ '--press': pressed === index ? clamp01(press) : 0 }}
            >
              {decision.label}
              <span className="pk-approval__keys">
                {decision.keys.map((key) => (
                  <kbd key={key} className="pk-kbd">
                    {key}
                  </kbd>
                ))}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
