import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@atd/ui/components/label';
import type { Connection, ConnectionDraft } from '../../client/providers/schema';
import { ThinkingLevelSelect } from './thinking-level-select';
import type { ConnectionDraftPatch } from './use-provider-draft';
import { useThinkingLevels } from './use-thinking-levels';

/**
 * The connection's saved thinking level for its default model. Selectable once the default model is
 * chosen and the connection is saved; changing the default model drops a level the new model does
 * not offer, so the connection falls back to its default.
 */
export function ProviderThinkingLevel({
  draft,
  saved,
  disabled,
  onChange,
  onNormalize,
}: {
  draft: ConnectionDraft;
  saved: Connection | null;
  disabled: boolean;
  onChange: (patch: ConnectionDraftPatch) => void;
  /** Applies the drop of a level the model does not offer, which is no edit of the user's. */
  onNormalize: (patch: ConnectionDraftPatch) => void;
}) {
  const { t } = useTranslation('providers');
  const reference =
    saved && draft.defaultModel
      ? { connectionId: saved.connectionId, modelId: draft.defaultModel }
      : null;
  const level = draft.defaultThinkingLevel;
  const key = reference ? `${reference.connectionId}:${reference.modelId}` : null;
  const { levels, loading } = useThinkingLevels(reference);
  const checked = useRef<string | null>(null);
  useEffect(() => {
    if (!key || loading || checked.current === key) return;
    checked.current = key;
    if (!level || !levels.length || levels.includes(level)) return;
    onNormalize({ defaultThinkingLevel: undefined });
  }, [key, loading, levels, level, onNormalize]);
  return (
    <div className="settings-field">
      <Label>{t('thinkingLevels.label')}</Label>
      <ThinkingLevelSelect
        reference={reference}
        value={level ?? 'off'}
        label={t('thinkingLevels.label')}
        disabled={disabled}
        onChange={(defaultThinkingLevel) => onChange({ defaultThinkingLevel })}
      />
    </div>
  );
}
