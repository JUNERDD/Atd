import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import { IconButton } from '../../components/icon-button';
import { HISTORY_GROUPS, HISTORY_SORTS, type HistoryView } from './history-view';

/** The history list's sort and group: one trigger beside the search, a radio list for each. */
export function HistoryViewMenu({
  view,
  onChange,
}: {
  view: HistoryView;
  onChange: (view: HistoryView) => void;
}) {
  const { t } = useTranslation('tasks');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={t('history.view.label')} className="shrink-0" tooltipDismissOnClick>
          <SlidersHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('history.view.groupBy')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={view.group}
          onValueChange={(value) => {
            const group = HISTORY_GROUPS.find((item) => item === value);
            if (group) onChange({ ...view, group });
          }}
        >
          {HISTORY_GROUPS.map((group) => (
            <DropdownMenuRadioItem key={group} value={group}>
              {t(`history.view.groups.${group}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('history.view.sortBy')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={view.sort}
          onValueChange={(value) => {
            const sort = HISTORY_SORTS.find((item) => item === value);
            if (sort) onChange({ ...view, sort });
          }}
        >
          {HISTORY_SORTS.map((sort) => (
            <DropdownMenuRadioItem key={sort} value={sort}>
              {t(`history.view.sorts.${sort}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
