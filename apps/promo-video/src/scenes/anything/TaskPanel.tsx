import { ListChecks } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Lang } from '../../copy.ts';
import { ApprovalCard } from '../../kit/product/ApprovalCard.tsx';
import { BuildCard } from '../../kit/product/BuildCard.tsx';
import { Composer, type ComposerProps } from '../../kit/product/Composer.tsx';
import { Panel } from '../../kit/product/Panel.tsx';
import { ProgressPill, type PillPart } from '../../kit/product/ProgressPill.tsx';
import { strings } from '../../kit/product/strings.ts';
import { SubagentChip } from '../../kit/product/SubagentChips.tsx';
import { graphemes } from '../../kit/product/text.ts';
import { TodoList } from '../../kit/product/TodoList.tsx';
import { Turn } from '../../kit/product/Turn.tsx';
import { UserMessage } from '../../kit/product/UserMessage.tsx';
import { clamp01, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { APP, APPROVAL_CLOSE, SUBAGENTS_CLOSE, SUBAGENTS_DONE, WORK } from './beats.ts';
import { content } from './content.ts';
import { WorkTurn } from './WorkTurn.tsx';

const linear = (x: number) => x;
const MODEL = { name: 'Claude Sonnet 4.5', context: '200K', effort: 'high' } as const;

/** A draft wraps to the composer's two-row field past about this many graphemes. */
const WRAP = { en: 46, zh: 24 } as const;

/** A press on a control, 0 → 1 → 0, centred on `at`. */
function pressAround(t: number, at: number): number {
  return ramp(t, at - 0.06, 0.06) - ramp(t, at + 0.08, 0.14);
}

/** A popover that closes at `close`: it fades as the view under it comes back. */
function Closing({ t, close, children }: { t: number; close: number; children: ReactNode }) {
  return (
    <div className="anything-popover" style={{ '--o': 1 - ramp(t, close, 0.12) }}>
      {children}
    </div>
  );
}

/**
 * The plan's popovers in turn: the todos, the two subagents starting, then the approval. Nothing
 * between them, so the panel draws no popover at all.
 */
function popoverAt(lang: Lang, t: number): ReactNode {
  const c = content[lang].work;
  if (t >= WORK.plan && t < WORK.subagents) {
    const todos = c.todos.map((text, index) => ({ text, done: WORK.todos[index] ?? Infinity }));
    return <TodoList lang={lang} items={todos} time={t} start={WORK.plan} age={t - WORK.plan} />;
  }
  if (t >= WORK.subagents && t < SUBAGENTS_CLOSE + 0.12) {
    return (
      <Closing t={t} close={SUBAGENTS_CLOSE}>
        <div className="glass pk-popover pk-subagents anything-subagents">
          <span className="pk-subagents__title">{strings[lang].subagents.title}</span>
          {c.subagents.map((item, index) => (
            <SubagentChip
              key={index}
              lang={lang}
              item={{ ...item, done: SUBAGENTS_DONE[index] }}
              time={t}
              age={t - WORK.subagents - index * 0.125}
            />
          ))}
        </div>
      </Closing>
    );
  }
  if (t >= WORK.approval && t < APPROVAL_CLOSE + 0.12) {
    return (
      <Closing t={t} close={APPROVAL_CLOSE}>
        <ApprovalCard
          lang={lang}
          scope="bash"
          detail={c.approval}
          entry={c.entry}
          age={t - WORK.approval}
          pressed={0}
          press={pressAround(t, WORK.allow)}
        />
      </Closing>
    );
  }
  return undefined;
}

/** The progress capsule over the composer while the plan runs: its step, ring and subagents. */
function pillAt(lang: Lang, t: number): ReactNode {
  const [, , , , last] = WORK.todos;
  const fade = ramp(t, last + 0.3, 0.3);
  if (t < WORK.plan || fade >= 1) return undefined;
  const completed = WORK.todos.filter((tick) => t >= tick).length;
  const ring = WORK.todos.reduce((sum, tick) => sum + springAt(t, tick, springs.snappy), 0) / 5;
  const running = t >= WORK.subagents ? SUBAGENTS_DONE.filter((done) => t < done).length : 0;
  const waiting = t >= WORK.approval && t < WORK.allow;
  const open: PillPart | undefined =
    t < WORK.subagents
      ? 'todos'
      : t < SUBAGENTS_CLOSE
        ? 'subagents'
        : waiting || (t >= WORK.allow && t < APPROVAL_CLOSE)
          ? 'hitl'
          : undefined;
  return (
    <div className="anything-pill" style={{ '--o': 1 - fade }}>
      <ProgressPill
        lang={lang}
        step={{ current: Math.min(5, completed + 1), total: 5 }}
        ring={ring}
        running={running}
        waiting={waiting}
        open={open}
        age={t - WORK.plan}
      />
    </div>
  );
}

/** The composer through both requests: typed, sent, running, then ready for the next. */
function composerState(lang: Lang, t: number): ComposerProps {
  const c = content[lang];
  const [typeFrom, typeTo] = WORK.typing;
  const [appFrom, appTo] = APP.typing;
  const base = { lang, tier: 'auto', model: MODEL } as const;
  if (t < WORK.send) {
    const typing = ramp(t, typeFrom, typeTo - typeFrom, linear);
    const shown = Math.floor(graphemes(c.work.prompt).length * clamp01(typing));
    return { ...base, text: c.work.prompt, typing, caret: t, expanded: shown > WRAP[lang] };
  }
  if (t >= appFrom && t < APP.send) {
    return {
      ...base,
      text: c.app.prompt,
      typing: ramp(t, appFrom, appTo - appFrom, linear),
      caret: t,
    };
  }
  const running = t < APP.start ? t < WORK.answer[1] : t < APP.built;
  return { ...base, followUp: true, running };
}

/**
 * The Atd panel through the section: the welcome until the first request is sent, then the work
 * turn, the habit tracker's request and its build card. The popovers and the pill float over the
 * composer as the app shows them.
 */
export function TaskPanel({ lang, t }: { lang: Lang; t: number }) {
  const c = content[lang];
  const sent = t >= WORK.send;
  const building = t >= APP.send;
  return (
    <Panel
      lang={lang}
      {...(sent ? { title: c.work.title } : {})}
      popover={popoverAt(lang, t)}
      composer={<Composer {...composerState(lang, t)} pill={pillAt(lang, t)} />}
    >
      {sent ? (
        <>
          <UserMessage text={c.work.prompt} age={t - WORK.send} />
          <WorkTurn lang={lang} t={t} />
          {building && <UserMessage text={c.app.prompt} age={t - APP.send} />}
          {building && (
            <Turn>
              <BuildCard
                lang={lang}
                name={c.app.name}
                summary={c.app.summary}
                icon={<ListChecks className="pk-icon anything-app-icon" />}
                build={ramp(t, APP.build, APP.built - APP.build, linear)}
                built={t - APP.built}
                press={pressAround(t, APP.open - 0.05)}
                time={t}
                age={t - APP.build}
              />
            </Turn>
          )}
        </>
      ) : undefined}
    </Panel>
  );
}
