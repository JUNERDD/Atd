import { Globe } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { ramp } from '../../motion/ease.ts';
import { springs } from '../../motion/spring.ts';
import { arrival, present } from '../../kit/product/motion.ts';
import { AssistantText } from '../../kit/product/AssistantText.tsx';
import { Composer } from '../../kit/product/Composer.tsx';
import { MemoryChip } from '../../kit/product/MemoryChip.tsx';
import { Panel } from '../../kit/product/Panel.tsx';
import { ToolCard } from '../../kit/product/ToolCard.tsx';
import { Turn } from '../../kit/product/Turn.tsx';
import { UserMessage } from '../../kit/product/UserMessage.tsx';
import { content } from './content.ts';
import { MEMORY } from './plan.ts';

const linear = (x: number) => x;

/** The reply to the correction streams in after the chip lands. */
const ACK = [MEMORY.remembered + 0.12, 0.45] as const;
/** Next week: the divider, the question, the search, then the answer in metric. */
const LATER = {
  ask: MEMORY.later + 0.08,
  search: MEMORY.later + 0.24,
  found: MEMORY.later + 0.42,
  answer: [MEMORY.later + 0.42, 0.44],
  highlight: MEMORY.later + 0.82,
} as const;

/** The time skip: a quiet centered label between hairlines, as a new chat begins. */
function Skip({ text, age }: { text: string; age: number }) {
  if (!present(age)) return null;
  return (
    <div className="pk-arrive" style={{ '--in': arrival(age, springs.smooth) }}>
      <div className="anytime-skip">
        <span>{text}</span>
      </div>
    </div>
  );
}

/**
 * The panel for the memory beat: an earlier answer in miles; the correction typed and sent; the
 * memory it keeps; then, a week later in a new chat, an answer that uses metric on its own.
 */
export function MemoryPanel({ t, lang }: { t: number; lang: Lang }) {
  const c = content[lang].memory;
  const [typeFrom, typeTo] = MEMORY.typing;
  const sent = t >= MEMORY.correct;
  const press = ramp(t, MEMORY.correct - 0.06, 0.06) - ramp(t, MEMORY.correct + 0.04, 0.12);
  const running =
    (sent && t < ACK[0] + ACK[1] + 0.1) ||
    (t >= LATER.ask && t < LATER.answer[0] + LATER.answer[1]);
  const later = t >= MEMORY.later;
  return (
    <Panel
      lang={lang}
      title={later ? c.titles[1] : c.titles[0]}
      composer={
        <Composer
          lang={lang}
          text={sent ? '' : c.correction}
          typing={ramp(t, typeFrom, typeTo - typeFrom, linear)}
          caret={t}
          followUp
          running={running}
          press={Math.max(0, press)}
          model={{ name: 'Claude Sonnet 4.5', context: '200K', effort: 'high' }}
        />
      }
    >
      <UserMessage text={c.ask} />
      <Turn>
        <AssistantText content={c.answer} />
      </Turn>
      <UserMessage text={c.correction} age={t - MEMORY.correct} />
      {t >= MEMORY.remembered ? (
        <Turn>
          <MemoryChip lang={lang} text={c.remembered} age={t - MEMORY.remembered} />
          <AssistantText content={c.ack} progress={ramp(t, ACK[0], ACK[1], linear)} />
        </Turn>
      ) : null}
      <Skip text={c.skip} age={t - MEMORY.later} />
      <UserMessage text={c.later} age={t - LATER.ask} />
      {t >= LATER.search ? (
        <Turn>
          <ToolCard
            icon={Globe}
            title={c.search.title}
            detail={c.search.detail}
            done={t >= LATER.found}
            time={t}
            age={t - LATER.search}
          />
          <AssistantText
            content={c.answerLater}
            progress={ramp(t, LATER.answer[0], LATER.answer[1], linear)}
            highlight={ramp(t, LATER.highlight, 0.3)}
          />
        </Turn>
      ) : null}
    </Panel>
  );
}
