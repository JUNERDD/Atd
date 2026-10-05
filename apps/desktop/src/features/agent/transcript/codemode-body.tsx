import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodemodeDetails } from '@atd/agent-contracts';
import { SquareCode } from 'lucide-react';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { ActivityRow } from './activity-row';
import { CodeBlock } from './code-block';
import { codemodeSource, codemodeStepBlock, NestedConfirmation } from './codemode-call';
import { ToolBlock } from './tool-block';
import { ToolCard } from './tool-card';
import './tool-code.css';

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
        // The code block leaves its scrolling to its owner: a long script scrolls inside the card,
        // both ways. `JavaScript` stays untranslated, like the `Shell` label.
        <ToolCard.Root className="tool-code">
          <ToolCard.Header icon={<SquareCode />} label="JavaScript" copyText={code} />
          <ToolCard.Body size="lg" scroll="both" flush>
            <CodeBlock contents={code} language="javascript" flush />
          </ToolCard.Body>
        </ToolCard.Root>
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
