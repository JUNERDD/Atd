import { Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { ToolCard } from './tool-card';
import { bashCommand } from './tool-copy';
import { splitBashExit, splitNotice } from './tool-output';
import './tool-code.css';

/**
 * How the command ended, for the closing note: Pi appends a status line only for a non-zero exit
 * (`exitCode`) or a kill (`null`); a clean exit and a running command have none.
 */
function ExitNote({ exitCode }: { exitCode: number | null | undefined }) {
  const { t } = useTranslation('tasks');
  if (exitCode === undefined) return null;
  return (
    <span className="tool-code-note">
      {exitCode === null ? t('toolCode.terminated') : t('toolCode.exitCode', { code: exitCode })}
    </span>
  );
}

/**
 * A `bash` call as a terminal transcript: the command after a `$` prompt, its continuation lines
 * aligned under its text, then its combined output (live while running). The closing note names
 * a non-zero exit or a kill in the destructive tone, with Pi's truncation notice beside it; copy
 * takes the output as the agent read it, or the command when there is none yet.
 */
export function BashBody({ block }: { block: BlockOf<'tool'> }) {
  const { t } = useTranslation('tasks');
  const command = bashCommand(block.args);
  const text = block.status === 'running' ? block.partial : block.output;
  const { body: withNotice, exitCode } = splitBashExit(text);
  // Pi writes the truncation notice before the exit status, so the notice comes off second.
  const { body, notice } = splitNotice(withNotice);
  const output = body.replace(/\n+$/, '');
  const interrupted = block.status === 'interrupted';
  const hasFooter = exitCode !== undefined || notice !== null || interrupted;
  return (
    <ToolCard.Root className="tool-code">
      {/* `Shell` stays untranslated, matching the technical-term convention. */}
      <ToolCard.Header icon={<Terminal />} label="Shell" copyText={text || command} />
      <ToolCard.Body size="lg" className="font-mono">
        {command && (
          <pre className="tool-shell-command">
            <span className="tool-shell-prompt" aria-hidden="true">
              $
            </span>
            <span>{command}</span>
          </pre>
        )}
        {output && <pre className="tool-shell-output">{output}</pre>}
      </ToolCard.Body>
      {hasFooter && (
        <ToolCard.Footer tone={exitCode === undefined ? 'muted' : 'destructive'}>
          <ExitNote exitCode={exitCode} />
          {notice && (
            <span className="tool-code-note" data-tone="muted">
              {notice}
            </span>
          )}
          {interrupted && (
            <span className="tool-code-note" data-tone="muted">
              {t('activity.interruptedNote')}
            </span>
          )}
        </ToolCard.Footer>
      )}
    </ToolCard.Root>
  );
}
