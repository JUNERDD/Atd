import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { ToolSummary } from './tool-summary';
import './tool-row.css';

/**
 * The trailing fact of a settled tool row (`toolSummary`): compact tabular figures in the row's
 * muted face, with diff counts in the addition and deletion colors. Color is never the only
 * signal: the `+` / `−` signs carry the meaning, and terse figures (`+12 −3`, `L120–180`) are
 * hidden from assistive technology in favor of a spelled-out label, also shown as the tooltip.
 */
export function ToolRowSummary({ summary }: { summary: ToolSummary }) {
  const { t } = useTranslation('tasks');
  switch (summary.kind) {
    case 'diff': {
      const label = diffLabel(t, summary.added, summary.removed);
      return (
        <span className="tool-row-summary" title={label}>
          <span className="tool-row-figures" aria-hidden="true">
            {summary.added > 0 && <span className="tool-row-added">+{summary.added}</span>}
            {summary.removed > 0 && <span className="tool-row-removed">−{summary.removed}</span>}
          </span>
          <span className="sr-only">{label}</span>
        </span>
      );
    }
    case 'range': {
      const { start, end } = summary;
      const label = t('toolRow.rangeLabel', { start, end });
      return (
        <span className="tool-row-summary" title={label}>
          <span aria-hidden="true">{t('toolRow.range', { start, end })}</span>
          <span className="sr-only">{label}</span>
        </span>
      );
    }
    case 'count':
      return (
        <span className="tool-row-summary">
          {t(`toolCount.${summary.unit}`, { count: summary.count })}
        </span>
      );
    case 'empty':
      return <span className="tool-row-summary">{t(`toolRow.empty.${summary.unit}`)}</span>;
    default: {
      const _exhaustive: never = summary;
      void _exhaustive;
      return null;
    }
  }
}

/** "12 lines added, 3 lines removed", leaving out a side with no lines. */
function diffLabel(t: TFunction<'tasks'>, added: number, removed: number): string {
  const addedText = t('toolRow.added', { count: added });
  const removedText = t('toolRow.removed', { count: removed });
  if (added > 0 && removed > 0) {
    return t('toolRow.addedRemoved', { added: addedText, removed: removedText });
  }
  return added > 0 ? addedText : removedText;
}
