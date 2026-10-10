import { FileSpreadsheet, Folder, Terminal, TextSearch } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { ActivityGroup } from './ActivityGroup.tsx';
import { ApprovalCard } from './ApprovalCard.tsx';
import { AssistantText } from './AssistantText.tsx';
import { BuildCard } from './BuildCard.tsx';
import { Composer } from './Composer.tsx';
import { CreatedCard } from './CreatedCard.tsx';
import { FileChip } from './FileChip.tsx';
import { MemoryChip } from './MemoryChip.tsx';
import { Panel } from './Panel.tsx';
import { ProgressPill } from './ProgressPill.tsx';
import { sheetContent } from './sheet-content.ts';
import { SubagentChips } from './SubagentChips.tsx';
import { ThinkingRow } from './ThinkingRow.tsx';
import { TodoList } from './TodoList.tsx';
import { ToolCard } from './ToolCard.tsx';
import { Turn } from './Turn.tsx';
import { UserMessage } from './UserMessage.tsx';

/** When each todo ticks on the sheet's first page. */
const TICKS = [0.9, 1.5, 2.1, 2.8, 3.5];

/** Page one of the sheet (`t` 0 → 4 s): the panel at work, then the transcript parts on their own. */
export function SheetWork({ lang, t }: { lang: Lang; t: number }) {
  const c = sheetContent[lang];
  const todos = c.todos.map((text, index) => ({ text, done: TICKS[index] ?? 99 }));
  const completed = TICKS.filter((tick) => t >= tick).length;
  const ring = completed / TICKS.length;
  const popover =
    t < 2.3 ? (
      <TodoList lang={lang} items={todos} time={t} start={0.3} age={t - 0.3} />
    ) : t < 3.1 ? (
      <ApprovalCard
        lang={lang}
        scope="editOutside"
        detail={c.editDetail}
        age={t - 2.3}
        pressed={0}
        press={ramp(t, 2.85, 0.1) - ramp(t, 3, 0.1)}
      />
    ) : undefined;
  return (
    <>
      <div className="pk-sheet__at" data-at="panel">
        <Panel
          lang={lang}
          title={c.prompt}
          popover={popover}
          composer={
            <Composer
              lang={lang}
              followUp
              tier="auto"
              running
              model={{ name: 'Claude Sonnet 4.5', context: '200K', effort: 'high' }}
              pill={
                <ProgressPill
                  lang={lang}
                  step={{ current: Math.min(5, completed + 1), total: 5 }}
                  ring={ring}
                  running={t > 1 && t < 2.6 ? 2 : 0}
                  waiting={t >= 2.3 && t < 3.1}
                  open={t < 2.3 ? 'todos' : t < 3.1 ? 'hitl' : undefined}
                  age={t - 0.2}
                />
              }
            />
          }
        >
          <UserMessage
            age={t}
            text={c.prompt}
            attachments={
              <FileChip lang={lang} variant="attachment" name="March.zip" size="2.4 MB" />
            }
          />
          <Turn>
            <ActivityGroup>
              <ThinkingRow
                lang={lang}
                time={t}
                age={t - 0.1}
                {...(t > 0.7 ? { seconds: 4, excerpt: c.thinking } : {})}
              />
              <ToolCard
                icon={TextSearch}
                title={lang === 'zh' ? '搜索文件内容' : 'Search file contents'}
                detail={c.search}
                label={c.search}
                lines={c.searchLines}
                stream={ramp(t, 0.7, 0.6)}
                collapse={springAt(t, 1.5, springs.smooth)}
                summary={lang === 'zh' ? '5 个文件' : '5 files'}
                done={t > 1.4}
                time={t}
                age={t - 0.6}
              />
              <ToolCard
                icon={Terminal}
                title={lang === 'zh' ? '运行命令' : 'Run command'}
                detail={c.command}
                label={c.commandLines[0]}
                lines={c.commandLines.slice(1)}
                stream={ramp(t, 1.5, 0.6)}
                collapse={springAt(t, 2.3, springs.smooth)}
                done={t > 2.2}
                time={t}
                age={t - 1.4}
              />
            </ActivityGroup>
            {t > 3.1 && <AssistantText content={c.reply} progress={ramp(t, 3.1, 0.8, (x) => x)} />}
            {t > 3.6 && (
              <FileChip lang={lang} variant="result" name="summary.md" size="2 KB" age={t - 3.6} />
            )}
          </Turn>
        </Panel>
      </div>
      <div className="pk-sheet__stack" data-at="middle">
        <TodoList lang={lang} items={todos} time={t} start={0.3} />
        <SubagentChips
          lang={lang}
          time={t}
          items={c.subagents.map((item, index) => ({ ...item, done: 2 + index * 0.8 }))}
        />
        <ApprovalCard
          lang={lang}
          scope="bash"
          entry="pdftotext"
          detail={c.commandLines[0] ?? ''}
          pressed={1}
          press={ramp(t, 1, 0.1) - ramp(t, 1.2, 0.15)}
        />
        <BuildCard
          lang={lang}
          name={c.appName}
          summary={c.appSummary}
          build={ramp(t, 0.3, 2.1, (x) => x)}
          built={t - 2.5}
          press={ramp(t, 3.3, 0.1) - ramp(t, 3.5, 0.15)}
          time={t}
        />
      </div>
      <div className="pk-sheet__stack" data-at="right">
        <CreatedCard
          lang={lang}
          kind="command"
          name={c.created.command}
          keys={['⌥', 'T']}
          age={t - 0.3}
          confirm={t - 0.7}
        />
        <CreatedCard
          lang={lang}
          kind="skill"
          name={c.created.skill}
          detail={c.created.skillDetail}
          age={t - 0.9}
          confirm={t - 1.3}
        />
        <CreatedCard
          lang={lang}
          kind="automation"
          name={c.created.automation}
          detail={c.created.trigger}
          detailIcon={Folder}
          age={t - 1.5}
          confirm={t - 1.9}
        />
        <MemoryChip lang={lang} text={c.memory} age={t - 2.2} />
        <div className="pk-sheet__reply">
          <AssistantText
            content={c.later}
            progress={ramp(t, 0.2, 1, (x) => x)}
            highlight={ramp(t, 2.6, 0.5)}
          />
        </div>
        <div className="pk-sheet__row">
          <Composer
            lang={lang}
            text={c.typing}
            typing={ramp(t, 0.4, 1.4, (x) => x)}
            caret={t}
            chips={[
              { kind: 'quote', name: c.quote, age: t - 0.2 },
              { kind: 'image', name: 'Screenshot 10.42.png', age: t - 1.9 },
            ]}
            expanded
            press={ramp(t, 3, 0.08) - ramp(t, 3.15, 0.15)}
          />
        </div>
        <div className="pk-sheet__row">
          <FileChip
            lang={lang}
            variant="attachment"
            name="Q1-report.xlsx"
            size="88 KB"
            icon={FileSpreadsheet}
            age={t - 0.5}
          />
          <ThinkingRow lang={lang} time={t} />
        </div>
      </div>
    </>
  );
}
