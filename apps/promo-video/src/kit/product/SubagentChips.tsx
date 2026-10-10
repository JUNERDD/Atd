import { ChevronRight } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { easeOut, ramp } from '../../motion/ease.ts';
import { springs } from '../../motion/spring.ts';
import { arrival, present } from './motion.ts';
import { StatusGlyph } from './StatusGlyph.tsx';
import { strings } from './strings.ts';
import './tokens.css';
import './popover.css';
import './subagents.css';

export interface Subagent {
  /** The first line of its task ("Read the March invoices"). */
  title: string;
  /** The agent's name, after the state word ("researcher"). */
  agent?: string | undefined;
  /** When it finishes, in seconds on the clock; it runs until then. Omit to keep it running. */
  done?: number | undefined;
}

export interface SubagentChipProps {
  lang: Lang;
  item: Subagent;
  /** The clock, in seconds: turns the spinner and draws the check when it finishes. */
  time: number;
  /** Seconds since the row appeared. */
  age?: number | undefined;
}

/**
 * One subagent as the Subagents list shows it (`status-row.tsx`, an xs `Item`): the state glyph,
 * its task, "Running · agent" under it, and the chevron that opens its conversation.
 */
export function SubagentChip({ lang, item, time, age }: SubagentChipProps) {
  if (!present(age)) return null;
  const t = strings[lang].subagents;
  const finished = item.done !== undefined && time >= item.done;
  const word = finished ? t.completed : t.running;
  const draw = item.done === undefined ? 0 : ramp(time, item.done, 0.35, easeOut);
  return (
    <div className="pk-arrive" style={{ '--in': arrival(age) }}>
      <div className="pk-subagent" data-done={finished || undefined}>
        <StatusGlyph
          state={finished ? 'completed' : 'running'}
          draw={draw}
          time={time}
          className="pk-glyph pk-subagent__glyph"
        />
        <span className="pk-subagent__text">
          <span className="pk-subagent__title">{item.title}</span>
          <span className="pk-subagent__state">
            {item.agent ? `${word} · ${item.agent}` : word}
          </span>
        </span>
        <ChevronRight className="pk-icon pk-subagent__chevron" />
      </div>
    </div>
  );
}

/**
 * The Subagents view of the composer popover (`subagent-panel.tsx`): "Subagents" over one row per
 * child the reply dispatched, running ones first.
 */
export function SubagentChips({
  lang,
  items,
  time,
  age,
}: {
  lang: Lang;
  items: readonly Subagent[];
  time: number;
  /** Seconds since the popover opened. */
  age?: number | undefined;
}) {
  if (!present(age)) return null;
  return (
    <div className="glass pk-popover pk-subagents" style={{ '--in': arrival(age, springs.snappy) }}>
      <span className="pk-subagents__title">{strings[lang].subagents.title}</span>
      {items.map((item, index) => (
        <SubagentChip key={index} lang={lang} item={item} time={time} />
      ))}
    </div>
  );
}
