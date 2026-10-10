import { FileSearch, FileText, Terminal, type LucideIcon } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { ActivityGroup } from '../../kit/product/ActivityGroup.tsx';
import { AssistantText } from '../../kit/product/AssistantText.tsx';
import { FileChip } from '../../kit/product/FileChip.tsx';
import { ThinkingRow } from '../../kit/product/ThinkingRow.tsx';
import { ToolCard } from '../../kit/product/ToolCard.tsx';
import { Turn } from '../../kit/product/Turn.tsx';
import { ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { WORK } from './beats.ts';
import { content } from './content.ts';

const linear = (x: number) => x;

interface ToolTiming {
  icon: LucideIcon;
  /** When the row appears (its beat), when its output starts, when it settles and folds. */
  at: number;
  stream: number;
  done: number;
}

/**
 * The first request's reply: a moment of thought, then three tool calls on the beat (finding the
 * invoices, reading the odd one, and the command that waits for approval before it runs), each
 * folding to its one-line summary, then the answer with its table and the saved file.
 */
export function WorkTurn({ lang, t }: { lang: Lang; t: number }) {
  const c = content[lang].work;
  const [find, read, command] = WORK.tools;
  const [answerFrom, answerTo] = WORK.answer;
  const calls: { call: typeof c.find; timing: ToolTiming }[] = [
    {
      call: c.find,
      timing: { icon: FileSearch, at: find, stream: find + 0.08, done: read - 0.04 },
    },
    {
      call: c.read,
      timing: { icon: FileText, at: read, stream: read + 0.08, done: command - 0.04 },
    },
    {
      call: c.command,
      timing: {
        icon: Terminal,
        at: command,
        stream: WORK.allow + 0.08,
        done: answerFrom - 0.06,
      },
    },
  ];

  return (
    <Turn>
      <ActivityGroup>
        <ThinkingRow
          lang={lang}
          time={t}
          age={t - (WORK.send + 0.12)}
          {...(t >= WORK.plan ? { seconds: 1, excerpt: c.thinking } : {})}
        />
        {calls.map(({ call, timing }, index) => (
          <ToolCard
            key={index}
            icon={timing.icon}
            title={call.title}
            detail={call.detail}
            label={call.label}
            lines={call.lines}
            stream={ramp(t, timing.stream, 0.34, linear)}
            collapse={springAt(t, timing.done + 0.04, springs.smooth)}
            summary={call.summary}
            done={t >= timing.done}
            time={t}
            age={t - timing.at}
            rows={4}
          />
        ))}
      </ActivityGroup>
      {t >= answerFrom && (
        <AssistantText
          content={c.answer}
          progress={ramp(t, answerFrom, answerTo - answerFrom, linear)}
        />
      )}
      <FileChip lang={lang} variant="result" name={c.saved} size="2 KB" age={t - WORK.saved} />
    </Turn>
  );
}
