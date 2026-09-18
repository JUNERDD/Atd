import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import type { ModelReference, ModelThinkingLevel } from '../../../electron/providers/schema';
import { useThinkingLevels } from './use-thinking-levels';

/**
 * The thinking level for one model. Options come from the main process, never invented here: the
 * control stays disabled while the levels load, when there is no model, or when the model offers
 * fewer than two. A value the model does not offer shows the first supported level; the run's level
 * is clamped in the main process, and the title explains the substitution.
 */
export function ThinkingLevelSelect({
  reference,
  value,
  onChange,
  label,
  compact = false,
  disabled = false,
}: {
  reference: ModelReference | null;
  value: ModelThinkingLevel;
  onChange: (level: ModelThinkingLevel) => void;
  label: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation('providers');
  const { levels, loading } = useThinkingLevels(reference);
  const selected = levels.includes(value) ? value : (levels[0] ?? value);
  return (
    <Select
      value={selected}
      disabled={disabled || !reference || loading || levels.length < 2}
      onValueChange={(next) => {
        const level = levels.find((item) => item === next);
        if (level) onChange(level);
      }}
    >
      <SelectTrigger
        size={compact ? 'sm' : 'default'}
        className={compact ? 'thinking-level-select' : 'thinking-level-select w-full'}
        aria-label={label}
        title={
          selected === value
            ? label
            : t('thinkingLevels.unavailable', { level: t(`thinkingLevels.levels.${value}`) })
        }
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {levels.map((level) => (
          <SelectItem key={level} value={level}>
            {t(`thinkingLevels.levels.${level}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
