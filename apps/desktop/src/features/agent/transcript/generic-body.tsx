import { createElement, type ReactNode } from 'react';
import { Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { Root as JsonTree } from './json-tree';
import { mcpProxy } from './mcp-proxy';
import { ToolCard } from './tool-card';
import { toolIcon } from './tool-copy';
import './tool-list.css';

/** A labeled part of the card: what the call was given, or what it returned. */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="generic-section">
      <h4 className="generic-section-label">{label}</h4>
      <div className="generic-section-content font-mono">{children}</div>
    </section>
  );
}

/**
 * Any call without a dedicated body (MCP tools, memory, skills, MCP resources): one card naming
 * the tool (an MCP tool by its own name, with its server as the trailing fact), then the call's
 * arguments and its result, each as a JSON tree when it parses and as monospace text otherwise.
 * The header copies the result the agent read.
 */
export function GenericBody({ block }: { block: BlockOf<'tool'> }) {
  const { t } = useTranslation('tasks');
  const text = block.status === 'running' ? block.partial : block.output;
  const proxy = mcpProxy(block.name);
  const input = Object.keys(block.args).length > 0 ? JSON.stringify(block.args, null, 2) : '';
  return (
    <ToolCard.Root>
      <ToolCard.Header
        icon={createElement(proxy ? Plug : toolIcon(block.name))}
        label={<span className="font-mono">{proxy?.tool ?? block.name}</span>}
        meta={proxy?.server}
        copyText={text}
      />
      {(input || text) && (
        <ToolCard.Body size="lg" className="generic-sections">
          {input && (
            <Section label={t('toolList.input')}>
              <JsonTree text={input} bare />
            </Section>
          )}
          {text && (
            <Section label={t('toolList.output')}>
              <JsonTree text={text} bare />
            </Section>
          )}
        </ToolCard.Body>
      )}
      {block.status === 'interrupted' && (
        <ToolCard.Footer>{t('activity.interruptedNote')}</ToolCard.Footer>
      )}
    </ToolCard.Root>
  );
}
