import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Folder } from 'lucide-react';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemTitle,
} from '@atd/ui/components/item';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import type { SaveLocationFolder, SaveLocationKind } from '../../client/save-location-contract';
import { ASK_EACH_TIME_VALUE, CHOOSE_FOLDER_VALUE, useSaveLocation } from './use-save-location';

export interface SaveLocationRowProps {
  readonly kind: SaveLocationKind;
  readonly anchor: string;
  readonly label: string;
  readonly description: string;
  readonly saveFailedMessage: string;
}

/**
 * Shared General settings row for choosing "Ask each time" or a remembered local save folder
 * (with native folder picking) for screenshots or screen recordings.
 */
export function SaveLocationRow({
  kind,
  anchor,
  label,
  description,
  saveFailedMessage,
}: SaveLocationRowProps) {
  const { t } = useTranslation('settings');
  const descriptionId = useId();
  const saveLocation = useSaveLocation(kind, saveFailedMessage);
  const state = saveLocation.state;

  if (!saveLocation.available || state === null) return null;

  const nameCounts = new Map<string, number>();
  for (const folder of state.folders) {
    nameCounts.set(folder.name, (nameCounts.get(folder.name) ?? 0) + 1);
  }
  const folderLabel = (folder: SaveLocationFolder) =>
    (nameCounts.get(folder.name) ?? 0) > 1 ? `${folder.name} (${folder.displayPath})` : folder.name;

  const currentFolder =
    state.current !== null ? state.folders.find((f) => f.path === state.current) : undefined;
  const triggerLabel =
    state.current === null
      ? t('saveLocation.askEachTime')
      : currentFolder
        ? folderLabel(currentFolder)
        : (state.current.split('/').filter(Boolean).pop() ?? state.current);

  return (
    <Item asChild size="sm" className="settings-card-row">
      <li data-settings-anchor={anchor}>
        {/* Wide enough that the select wraps below a long description in a narrow column. */}
        <ItemContent className="min-w-[min(200px,100%)]">
          <ItemTitle className="whitespace-normal">{label}</ItemTitle>
          <ItemDescription id={descriptionId} className="whitespace-normal">
            {description}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto flex-wrap justify-end">
          <Select
            value={state.current ?? ASK_EACH_TIME_VALUE}
            disabled={saveLocation.pending}
            onValueChange={(val) => {
              if (val) void saveLocation.selectOption(val);
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-auto max-w-60 min-w-36"
              aria-label={label}
              aria-describedby={descriptionId}
              aria-busy={saveLocation.pending || undefined}
            >
              <SelectValue>{triggerLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value={ASK_EACH_TIME_VALUE}>{t('saveLocation.askEachTime')}</SelectItem>
              {state.folders.length > 0 && (
                <>
                  <SelectSeparator />
                  {state.folders.map((folder) => (
                    <SelectItem key={folder.path} value={folder.path} title={folder.displayPath}>
                      <Folder
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="truncate">{folderLabel(folder)}</span>
                    </SelectItem>
                  ))}
                </>
              )}
              <SelectSeparator />
              <SelectItem value={CHOOSE_FOLDER_VALUE}>{t('saveLocation.chooseFolder')}</SelectItem>
            </SelectContent>
          </Select>
        </ItemActions>
        {saveLocation.error !== null && (
          <ItemFooter role="alert" className="settings-inline-error items-start justify-start">
            <CircleAlert aria-hidden="true" />
            <span>{saveLocation.error}</span>
          </ItemFooter>
        )}
      </li>
    </Item>
  );
}
