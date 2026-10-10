import { BookOpen, SquareTerminal, Zap, type LucideIcon } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { easeOut, ramp } from '../../motion/ease.ts';
import { springs } from '../../motion/spring.ts';
import { arrival, present } from './motion.ts';
import { strings } from './strings.ts';
import './tokens.css';
import './activity.css';
import './created-card.css';

export type CreatedKind = 'command' | 'skill' | 'automation';

/** Each kind's mark, as the transcript's rows and Settings show it. */
const ICONS: Record<CreatedKind, LucideIcon> = {
  command: SquareTerminal,
  skill: BookOpen,
  automation: Zap,
};

export interface CreatedCardProps {
  lang: Lang;
  kind: CreatedKind;
  /** Its name, as the scene gives it (`Translate to French`). */
  name: string;
  /** Keys of a command's shortcut, as keycaps (`['⌥', 'T']`). */
  keys?: readonly string[] | undefined;
  /** A line under the name: a skill's purpose, an automation's trigger. */
  detail?: string | undefined;
  /** A glyph before `detail` (`Folder` for a watched folder, `Clock` for a schedule). */
  detailIcon?: LucideIcon | undefined;
  /** Seconds since it landed: it slams in, a touch large, and settles on the `pop` spring. */
  age?: number | undefined;
  /** Seconds since it was confirmed saved: the check circle fills and draws its check. */
  confirm?: number | undefined;
}

/**
 * Something the agent made on request: a command, a skill or an automation. The film's card for
 * the app's create steps, on the tool card surface: the kind's mark and name in the header, the
 * name, its shortcut or trigger, and a check that confirms it was saved.
 */
export function CreatedCard({
  lang,
  kind,
  name,
  keys,
  detail,
  detailIcon: DetailIcon,
  age,
  confirm,
}: CreatedCardProps) {
  if (!present(age)) return null;
  const Icon = ICONS[kind];
  const draw = confirm === undefined ? 0 : ramp(confirm, 0, 0.4, easeOut);
  const fillIn = confirm === undefined ? 0 : ramp(confirm, 0, 0.18, easeOut);
  return (
    <div className="pk-created-slot" style={{ '--in': arrival(age, springs.pop) }}>
      <div className="pk-card pk-created">
        <div className="pk-card__header">
          <Icon className="pk-icon" />
          <span className="pk-created__kind">{strings[lang].created[kind]}</span>
        </div>
        <div className="pk-created__body">
          <span className="pk-created__text">
            <span className="pk-created__name">{name}</span>
            {keys && keys.length > 0 && (
              <span className="pk-created__keys">
                {keys.map((key, index) => (
                  <kbd key={index} className="pk-kbd">
                    {key}
                  </kbd>
                ))}
              </span>
            )}
            {detail && (
              <span className="pk-created__detail">
                {DetailIcon && <DetailIcon className="pk-icon" />}
                {detail}
              </span>
            )}
          </span>
          <svg className="pk-created__check" viewBox="0 0 24 24" style={{ '--fill': fillIn }}>
            <circle cx="12" cy="12" r="10" />
            <path d="m8 12.5 2.8 2.8L16.5 9.5" pathLength={1} style={{ '--draw': draw }} />
          </svg>
        </div>
      </div>
    </div>
  );
}
