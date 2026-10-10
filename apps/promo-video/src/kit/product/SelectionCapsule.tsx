import { Ellipsis, GripVertical, Sparkles } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { clamp01, easeOut } from '../../motion/ease.ts';
import { springAt } from '../../motion/spring.ts';
import { DropsGlyph } from './DropsGlyph.tsx';
import { SELECTION_SPRING } from './motion.ts';
import { strings } from './strings.ts';
import './tokens.css';
import './native.css';

export interface SelectionCapsuleProps {
  lang: Lang;
  /** The user's command names shown as buttons after Ask Atd (`Translate`, `Summarize`). */
  commands: readonly string[];
  /** The More button for the commands that did not fit. Default true. */
  more?: boolean | undefined;
  /**
   * What leads the row: the drag grip, as the shipped toolbar has it (default), or the menu bar's
   * Drops mark, as the status HUD shows it.
   */
  lead?: 'grip' | 'mark' | undefined;
  /** Seconds since the toolbar appeared, which plays its entrance. Omit when it is at rest. */
  entrance?: number | undefined;
  /** The capsule sits above the selection (default), so it grows from its bottom edge. */
  above?: boolean | undefined;
  /** The button under the pointer: 0 is Ask Atd, then the commands, then More. */
  hover?: number | undefined;
  /** The button held down, same numbering; its wash deepens. */
  pressed?: number | undefined;
}

/**
 * The selection toolbar (`SelectionToolbarPanel`): a Liquid Glass capsule 36 pt tall, 4 pt padding,
 * 2 pt gaps: the grip, Ask Atd (sparkles and label), a button per command, and More. Labels are
 * 13 pt medium; a hovered button takes a 9% wash, a pressed one 16%. Its box's origin is the
 * capsule's top-left; the entrance grows it from the middle of its bottom edge (`above`).
 */
export function SelectionCapsule({
  lang,
  commands,
  more = true,
  lead = 'grip',
  entrance,
  above = true,
  hover,
  pressed,
}: SelectionCapsuleProps) {
  const t = strings[lang].selection;
  const grow = entrance === undefined ? 1 : springAt(entrance, 0, SELECTION_SPRING);
  const fade = entrance === undefined ? 1 : easeOut(clamp01(entrance / 0.16));
  const wash = (index: number) =>
    pressed === index ? 'pressed' : hover === index ? 'hover' : undefined;
  return (
    <div
      className="glass pk-capsule"
      data-glass="capsule"
      data-above={above || undefined}
      style={{
        '--grow': entrance !== undefined && entrance < 0 ? 0 : grow,
        '--fade': entrance !== undefined && entrance < 0 ? 0 : fade,
      }}
    >
      {lead === 'grip' ? (
        <span className="pk-capsule__grip">
          <GripVertical className="pk-icon" />
        </span>
      ) : (
        <span className="pk-capsule__mark">
          <DropsGlyph className="pk-capsule__drops" />
        </span>
      )}
      <span className="pk-native-button" data-label="" data-wash={wash(0)}>
        <Sparkles className="pk-icon" />
        {t.ask}
      </span>
      {commands.map((name, index) => (
        <span key={name} className="pk-native-button" data-label="" data-wash={wash(index + 1)}>
          {name}
        </span>
      ))}
      {more && (
        <span className="pk-native-button" data-wash={wash(commands.length + 1)}>
          <Ellipsis className="pk-icon" />
        </span>
      )}
    </div>
  );
}
