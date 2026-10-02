import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PluginSummary } from '@atd/agent-contracts';
import { ExtensionDetailSection } from './extension-detail-fields';

type PluginDiagnostic = PluginSummary['diagnostics'][number];

const LEVEL_ICON = { error: CircleAlert, warning: TriangleAlert, info: Info } as const;

/**
 * What the service could not import from a bundle, or noticed about it: unsupported components
 * (hooks, `bin/`, LSP, extensions…), skipped or renamed items, and prompt blocks kept as text.
 * The messages come from the service as it wrote them; the path or component shows where.
 */
export function PluginDiagnostics({
  label,
  diagnostics,
}: {
  label: string;
  diagnostics: readonly PluginDiagnostic[];
}) {
  const { t } = useTranslation('settings');
  if (!diagnostics.length) return null;
  return (
    <ExtensionDetailSection label={label}>
      <ul className="plugin-diagnostics">
        {diagnostics.map((diagnostic, index) => {
          const Icon = LEVEL_ICON[diagnostic.level];
          const where = diagnostic.component
            ? `${diagnostic.component.kind} ${diagnostic.component.name}`
            : (diagnostic.path ?? '');
          return (
            <li key={`${diagnostic.code}\n${where}\n${index}`} data-level={diagnostic.level}>
              <Icon aria-label={t(`extensions.plugins.diagnosticLevel.${diagnostic.level}`)} />
              <div>
                <p>{diagnostic.message}</p>
                {where ? <p className="font-mono">{where}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </ExtensionDetailSection>
  );
}
