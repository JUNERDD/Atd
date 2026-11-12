import { useTranslation } from 'react-i18next';
import { ToggleGroup, ToggleGroupItem } from '@atd/ui/components/toggle-group';
import { MEMORY_GROUPS, MEMORY_GROUP_LABEL_KEYS, type MemoryGroup } from './memory-groups';

/** The Settings overview's memory groups, one selected at a time. */
export function MemoryFilters({
  value,
  counts,
  onChange,
}: {
  value: MemoryGroup;
  counts: Record<MemoryGroup, number>;
  onChange: (group: MemoryGroup) => void;
}) {
  const { t } = useTranslation('memory');
  return (
    <div className="memory-filters">
      <ToggleGroup
        type="single"
        value={value}
        variant="outline"
        size="sm"
        className="max-w-full flex-wrap"
        aria-label={t('memory.groups.label')}
        onValueChange={(next) => {
          if (MEMORY_GROUPS.includes(next as MemoryGroup)) onChange(next as MemoryGroup);
        }}
      >
        {MEMORY_GROUPS.map((group) => (
          <ToggleGroupItem
            key={group}
            value={group}
            aria-label={`${String(t(MEMORY_GROUP_LABEL_KEYS[group]))} (${String(counts[group])})`}
          >
            {t(MEMORY_GROUP_LABEL_KEYS[group])}
            <span className="memory-filter-count">{counts[group]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
