import { useTranslation } from 'react-i18next';
import { CircleAlert, Folder, FolderPlus, FolderX, X } from 'lucide-react';
import { MAX_FOLDERS, type FolderRef } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import { Label } from '@atd/ui/components/label';
import { IconButton } from '../../components/icon-button';
import { FieldError } from '../commands/field-error';
import type { DraftPatch } from './automation-draft';
import { errorId } from './use-automation-problems';
import { useFolderPicker } from './use-folder-picker';

/** `ids` with `id` swapped for `next`, kept once, in place. */
function swapped(ids: readonly string[], id: string, next: string): string[] {
  return ids.flatMap((item) => (item !== id ? [item] : ids.includes(next) ? [] : [next]));
}

/** `ids` and then the picked folders it does not hold yet, up to the contract's count. */
function added(ids: readonly string[], folders: readonly FolderRef[]): string[] {
  const fresh = folders.map(({ id }) => id).filter((id) => !ids.includes(id));
  return [...ids, ...fresh].slice(0, MAX_FOLDERS);
}

/**
 * The registered folders every run may read besides a watched folder (which runs always read):
 * one row each with Remove, and Add folder, which opens the shell's folder picker. A folder that
 * is no longer registered says so, and its row offers Choose again, which puts the folder picked
 * in its place.
 */
export function FolderListField({
  folderIds,
  patch,
  folderName,
  onFoldersPicked,
  error,
}: {
  folderIds: readonly string[];
  /** Changes the policy's folders as they are when a pick lands, after edits made meanwhile. */
  patch: DraftPatch;
  /** A folder's name; undefined once it is no longer registered. */
  folderName: (folderId: string) => string | undefined;
  onFoldersPicked: (folders: readonly FolderRef[]) => void;
  /** The editor's problem with these folders, shown under the list. */
  error: string;
}) {
  const { t } = useTranslation('automations');
  const picker = useFolderPicker();
  const setFolders = (update: (ids: readonly string[]) => string[]) =>
    patch((draft) => ({
      ...draft,
      policy: { ...draft.policy, folderIds: update(draft.policy.folderIds) },
    }));
  const add = () =>
    picker.pick((folders) => {
      onFoldersPicked(folders);
      setFolders((ids) => added(ids, folders));
    });
  const replace = (id: string) =>
    picker.pick(([folder]) => {
      if (!folder) return;
      onFoldersPicked([folder]);
      setFolders((ids) => swapped(ids, id, folder.id));
    });
  const full = folderIds.length >= MAX_FOLDERS;
  return (
    <div className="settings-field">
      <div className="settings-field-label">
        <Label id="automation-folders-label">{t('policy.folders')}</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={full}
          aria-busy={picker.picking || undefined}
          onClick={() => void add()}
        >
          <FolderPlus data-icon="inline-start" />
          {t('policy.addFolder')}
        </Button>
      </div>
      {folderIds.length > 0 && (
        <Card size="sm" className="settings-card">
          <ItemGroup
            aria-labelledby="automation-folders-label"
            aria-describedby={error ? errorId('folders') : undefined}
          >
            {folderIds.map((id) => {
              const name = folderName(id);
              const label = name ?? t('policy.unavailableFolder');
              return (
                <Item
                  key={id}
                  asChild
                  size="sm"
                  className="settings-card-row automation-folder-row"
                  data-unavailable={name === undefined || undefined}
                >
                  <li>
                    <ItemMedia variant="icon">
                      {name === undefined ? <FolderX /> : <Folder />}
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle>{label}</ItemTitle>
                    </ItemContent>
                    <ItemActions className="ml-auto">
                      {name === undefined && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-busy={picker.picking || undefined}
                          onClick={() => void replace(id)}
                        >
                          {t('folder.chooseAgain')}
                        </Button>
                      )}
                      <IconButton
                        label={t('policy.removeFolder')}
                        aria-label={t('policy.removeFolderFor', { name: label })}
                        onClick={() => setFolders((ids) => ids.filter((item) => item !== id))}
                      >
                        <X />
                      </IconButton>
                    </ItemActions>
                  </li>
                </Item>
              );
            })}
          </ItemGroup>
        </Card>
      )}
      {error ? (
        <FieldError id={errorId('folders')}>{error}</FieldError>
      ) : (
        <p className="settings-field-note">
          {folderIds.length ? t('policy.foldersNote') : t('policy.noFolders')}
        </p>
      )}
      {picker.failure && (
        <p role="alert" className="settings-inline-error">
          <CircleAlert aria-hidden />
          {picker.failure}
        </p>
      )}
    </div>
  );
}
