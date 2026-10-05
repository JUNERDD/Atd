import { Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MemoryUnit } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import { HighlightedText } from '@atd/ui/components/highlighted-text';
import { ItemActions, ItemMedia } from '@atd/ui/components/item';
import { Switch } from '@atd/ui/components/switch';
import type { FieldsMatch } from '@atd/ui/lib/fuzzy-match';
import { IconButton } from '../../components/icon-button';
import { ListCard } from '../../components/list-card';
import {
  MEMORY_ACTIVATIONS,
  MEMORY_CATEGORIES,
  MEMORY_SOURCES,
  MEMORY_TYPES,
} from './memory-labels';

/** The fields a list search matches; the card marks the description and the text. */
export type MemoryMatch = FieldsMatch<'description' | 'name' | 'body'>;

interface CardProps {
  unit: MemoryUnit;
  /** A write for this unit is running: its controls keep focus but ignore input. */
  busy: boolean;
  onOpen: (unit: MemoryUnit) => void;
  onToggle: (unit: MemoryUnit, enabled: boolean) => void;
  onDelete: (unit: MemoryUnit) => void;
}

/**
 * One memory wherever Settings list memories (the Memory section and Personal's Memory tab), as a
 * `ListCard` like Settings' plugin and app cards (Figma `App / Memory card · Rhea`): its type's
 * icon and its description, with its name under it; then the start of what it holds; and at the
 * foot its type, category and how runs use it, before badges for a source other than the user, New
 * until a learned memory is opened, and Disabled while it is off. The switch and More sit at the
 * top right; a click anywhere else on the card opens its page.
 */
export function MemoryCard({ match, ...props }: CardProps & { match: MemoryMatch | null }) {
  const { unit, busy, onOpen } = props;
  const { t } = useTranslation('memory');
  const { icon: Icon, labelKey } = MEMORY_TYPES[unit.type];
  const meta = [
    t(labelKey),
    unit.category ? t(MEMORY_CATEGORIES[unit.category]) : '',
    t(MEMORY_ACTIVATIONS[unit.activation].labelKey),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <ListCard
      media={
        <ItemMedia variant="icon">
          <Icon />
        </ItemMedia>
      }
      name={<HighlightedText text={unit.description} ranges={match?.ranges.description} />}
      nameText={unit.description}
      detail={unit.name}
      actions={<MemoryCardActions {...props} />}
      // The page shows the whole text; the card shows its start, without a tooltip that could be
      // pages long.
      description={<HighlightedText text={unit.body} ranges={match?.ranges.body} />}
      meta={meta}
      badges={
        <>
          {unit.source === 'user' ? null : (
            <Badge variant="outline">{t(MEMORY_SOURCES[unit.source])}</Badge>
          )}
          {unit.reviewed ? null : <Badge variant="secondary">{t('memory.list.new')}</Badge>}
          {unit.enabled ? null : <Badge variant="secondary">{t('memory.page.disabled')}</Badge>}
        </>
      }
      open={{
        label: t('memory.list.openLabel', { name: unit.name }),
        onOpen: () => {
          if (!busy) onOpen(unit);
        },
      }}
      busy={busy}
    />
  );
}

/** The switch that turns the memory on or off for runs, then More with Edit and Delete. */
function MemoryCardActions({ unit, busy, onOpen, onToggle, onDelete }: CardProps) {
  const { t } = useTranslation('memory');
  const { name } = unit;
  const busyProps = {
    'aria-disabled': busy || undefined,
    'aria-busy': busy || undefined,
    className: 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
  };
  return (
    <ItemActions>
      <Switch
        aria-label={t('memory.list.enableFor', { name })}
        checked={unit.enabled}
        {...busyProps}
        onCheckedChange={(enabled) => {
          if (!busy) onToggle(unit, enabled);
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label={t('memory.list.more')}
            aria-label={t('memory.list.moreActionsFor', { name })}
            {...busyProps}
            tooltipDismissOnClick
          >
            <Ellipsis />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={busy} onSelect={() => onOpen(unit)}>
            <Pencil />
            {t('memory.list.edit')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => onDelete(unit)}>
            <Trash2 />
            {t('memory.list.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ItemActions>
  );
}
