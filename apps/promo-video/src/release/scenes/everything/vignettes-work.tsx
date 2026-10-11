import { FilePen, Terminal, TextSearch, Users } from 'lucide-react';
import { ramp } from '../../../motion/ease.ts';
import { springAt, springs } from '../../../motion/spring.ts';
import { ActivityGroup } from '../../../kit/product/ActivityGroup.tsx';
import { Chip } from '../../../kit/product/Chip.tsx';
import { Composer } from '../../../kit/product/Composer.tsx';
import { FileChip } from '../../../kit/product/FileChip.tsx';
import { ProgressPill } from '../../../kit/product/ProgressPill.tsx';
import { SubagentChips } from '../../../kit/product/SubagentChips.tsx';
import { ThinkingRow } from '../../../kit/product/ThinkingRow.tsx';
import { TodoList } from '../../../kit/product/TodoList.tsx';
import { ToolCard } from '../../../kit/product/ToolCard.tsx';
import { UserMessage } from '../../../kit/product/UserMessage.tsx';
import { MODEL_MARK } from './brands.ts';
import { content } from './content.ts';
import { Fit, type VignetteProps } from './Fit.tsx';
import './vignettes.css';

/** When each todo ticks, after the tasks tile lands: two while the camera holds, the rest later. */
const TODO_TICKS = [0.15, 0.45, 2.1, 4.2, 7.5];

/**
 * The task panel working a plan: the request, a reasoning row, two tool rows streaming and
 * folding, and the todos ticking above the progress capsule.
 */
export function TasksVignette({ lang, t, age, spec }: VignetteProps) {
  const c = content[lang].tasks;
  const todos = c.todos.map((text, index) => ({
    text,
    done: spec.arrive + (TODO_TICKS[index] ?? 99),
  }));
  const completed = todos.filter((todo) => t >= todo.done).length;
  return (
    <Fit width={380} height={805} scale={0.85}>
      <div className="r08-every-v__transcript">
        <UserMessage text={c.prompt} age={age} />
        <ActivityGroup>
          <ThinkingRow
            lang={lang}
            time={t}
            age={age - 0.05}
            {...(age > 0.3 ? { seconds: 4, excerpt: c.thinking } : {})}
          />
          <ToolCard
            icon={TextSearch}
            title={c.grep}
            detail={c.grepDetail}
            label={c.grepDetail}
            lines={c.grepLines}
            stream={ramp(age, 0.1, 0.35)}
            collapse={springAt(age, 0.5, springs.smooth)}
            summary={c.files}
            done={age > 0.45}
            time={t}
            age={age - 0.05}
          />
          <ToolCard
            icon={Terminal}
            title={c.bash}
            detail={c.bashDetail}
            label={c.bashLines[0]}
            lines={c.bashLines.slice(1)}
            stream={ramp(age, 0.45, 0.4)}
            done={age > 1.2}
            time={t}
            age={age - 0.4}
          />
        </ActivityGroup>
      </div>
      <div className="r08-every-v__dock">
        <TodoList lang={lang} items={todos} time={t} start={spec.arrive} />
        <ProgressPill
          lang={lang}
          step={{ current: Math.min(5, completed + 1), total: 5 }}
          ring={completed / 5}
          open="todos"
        />
      </div>
    </Fit>
  );
}

/** Subagents in parallel: the popover's rows finishing one by one beside the run's tool rows. */
export function SubagentsVignette({ lang, t, age, spec }: VignetteProps) {
  const c = content[lang].subagents;
  const items = c.items.map((item, index) => ({
    ...item,
    done: spec.arrive + [0.45, 0.75, 2.4][index]!,
  }));
  const running = items.filter((item) => t < item.done).length;
  return (
    <Fit width={684} height={324}>
      <div className="r08-every-v__split">
        <SubagentChips lang={lang} items={items} time={t} age={age} />
        <div className="r08-every-v__stack">
          {items.map((item, index) => (
            <ToolCard
              key={item.agent}
              icon={Users}
              title={c.run}
              detail={item.agent}
              done={t > item.done}
              time={t}
              age={age - 0.05 * index}
            />
          ))}
          <div className="r08-every-v__pill">
            <ProgressPill lang={lang} running={running} open="subagents" />
          </div>
        </div>
      </div>
    </Fit>
  );
}

/** The task's result: the summary written, as a file to open. */
export function FileVignette({ lang, t, age }: VignetteProps) {
  const c = content[lang].tasks;
  return (
    <Fit width={300} height={300} scale={1.06} x={3} y={3}>
      <div className="r08-every-v__center">
        <ToolCard icon={FilePen} title={c.write} detail={c.result} done time={t} age={age} />
        <FileChip lang={lang} variant="result" name={c.result} size={c.size} age={age - 0.12} />
      </div>
    </Fit>
  );
}

/** Context chips in the composer: a file, a skill and a memory, one an eighth after another. */
export function ChipsVignette({ lang, age }: VignetteProps) {
  const c = content[lang].chips;
  return (
    <Fit width={240} height={240} scale={1.35}>
      <div className="r08-every-v__center">
        <Chip kind="file" name={c.file} age={age} />
        <Chip kind="skill" name={c.skill} age={age - 0.15} />
        <Chip kind="memory" name={c.memory} age={age - 0.3} />
      </div>
    </Fit>
  );
}

/** Ask anything: a question typed into the composer with its model, then sent. */
export function ComposerVignette({ lang, t, age }: VignetteProps) {
  const c = content[lang].composer;
  return (
    <Fit width={520} height={250} scale={1.3}>
      <div className="r08-every-v__center">
        <Composer
          lang={lang}
          text={c.text}
          typing={ramp(age, 0.05, 0.7, (x) => x)}
          caret={t}
          tier="auto"
          model={{ name: c.model, context: c.context, effort: 'high', brand: MODEL_MARK }}
          press={ramp(age, 1.0, 0.08) - ramp(age, 1.12, 0.15)}
        />
      </div>
    </Fit>
  );
}

/** The progress capsule's ring filling step by step. */
export function ProgressVignette({ lang, age }: VignetteProps) {
  const step = Math.min(5, 3 + Math.floor(Math.max(0, age) / 0.6));
  return (
    <Fit width={216} height={216} scale={1.5}>
      <div className="r08-every-v__center">
        <ProgressPill
          lang={lang}
          step={{ current: step, total: 5 }}
          ring={(step - 1) / 5 + ramp(age, 0, 0.4) * 0.2}
          running={1}
          age={age}
        />
      </div>
    </Fit>
  );
}
