import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodemodeDetails } from '@atd/agent-contracts';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { ActivityRow } from './activity-row';
import { CodeBlock } from './code-block';
import { codemodeSource, codemodeStepBlock, NestedConfirmation } from './codemode-call';
import { ToolBlock } from './tool-block';

/**
 * The detail of a `codemode` row: the script, then every tool call it made as the row that call
 * would get on its own, on the activity rail. A step's approval is asked like any call's: the
 * step that asks reads as waiting, the script's row keeps the waiting summary, and the composer
 * popover holds the decision. The script's output follows in the caller's output box.
 */
export function CodemodeBody({ block, data }: { block: BlockOf<'tool'>; data: CodemodeDetails }) {
  const { t } = useTranslation('tasks');
  const pending = useContext(NestedConfirmation);
  const code = codemodeSource(block.args);
  return (
    <>
      {code && (
        // The code block leaves its height to its owner: a long script scrolls inside the row.
        <ScrollArea className="max-h-80" viewportClassName="max-h-[inherit]" gutter="stable">
          <CodeBlock contents={code} language="javascript" />
        </ScrollArea>
      )}
      {data.steps.length > 0 && (
        <ActivityRow.Steps aria-label={t('activity.codemodeSteps')}>
          {data.steps.map((step) => (
            <ActivityRow.Step key={step.id}>
              <ToolBlock
                block={codemodeStepBlock(block, step)}
                confirmation={pending?.toolCallId === step.id ? pending : undefined}
              />
            </ActivityRow.Step>
          ))}
        </ActivityRow.Steps>
      )}
      {data.truncated && (
        <p className="m-0 text-xs text-muted-foreground">{t('activity.truncatedNote')}</p>
      )}
    </>
  );
}
