import { useId, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CircleAlert, Info, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@ai/ui/components/input-group';
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@ai/ui/components/item';
import {
  SHELL_ALLOWLIST_MAX_ENTRIES,
  normalizeShellAllowlistEntry,
  type ShellAllowlistEntryError,
} from '@ai/agent-contracts';
import { DEFAULT_PERMISSION_TIER } from '../../client/agent/permission-schema';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { IconButton } from '../../components/icon-button';
import { queryClient } from '../../lib/query-client';
import { useSettingsSectionExit } from './settings-navigation';
import { ShellAllowlistEntryDialog } from './shell-allowlist-entry-dialog';
import { showSettingsSnapshot } from './use-settings';

type AddError = ShellAllowlistEntryError | 'save';

/** Validates a new entry against the shared entry rules, then against the list it joins. */
function checkEntry(
  value: string,
  entries: readonly string[],
): { entry: string } | { error: ShellAllowlistEntryError } {
  const normalized = normalizeShellAllowlistEntry(value);
  if ('error' in normalized) return normalized;
  if (entries.includes(normalized.entry)) return { error: 'duplicate' };
  if (entries.length >= SHELL_ALLOWLIST_MAX_ENTRIES) return { error: 'limit' };
  return normalized;
}

/**
 * The user's shell allowlist: commands starting with an entry run without a confirm (Manual) or
 * without review (Auto). Under Always allow the list decides nothing, since every command already
 * runs; the section stays, says so, and keeps its entries manageable for a switch back. One card
 * holds the add field and the entries, each one line after a `$` prompt; a click on a row opens it
 * in full. The list comes from the settings snapshot; every change saves the whole list through
 * main, which validates it again, persists it, and pushes it to the agent service. The renderer
 * checks entries first so each problem gets its own message; main only rejects generically.
 */
export function ShellAllowlistSettings({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const bridge = window.desktop?.settings;
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<AddError | null>(null);
  // An error answers the last attempt; after leaving the section the field starts clean.
  useSettingsSectionExit(() => setError(null));
  // Each save answers the saved snapshot, which replaces the cached one at once, so a quick
  // second edit never builds on the list from before the first save. A failure shows in place.
  const saving = useMutation(
    {
      mutationKey: ['settings', 'shellAllowlist'],
      mutationFn: (entries: string[]) => {
        if (!bridge) throw new Error('Open the desktop app to change settings.');
        return bridge.saveShellAllowlist(entries);
      },
      onSuccess: showSettingsSnapshot,
      meta: { errorToast: false },
    },
    queryClient,
  );
  const pending = saving.isPending;
  // The entry stays set while its dialog closes, so the closing dialog keeps its text.
  // `failed` marks a Remove from the dialog that did not save, which the dialog itself reports.
  const [detail, setDetail] = useState<{
    entry: string;
    open: boolean;
    failed?: boolean;
  } | null>(null);
  const entries = snapshot?.shellAllowlist ?? [];
  // Without the bridge or a snapshot nothing can change. While a save is in flight the field and
  // the buttons stay focusable, so the next entry can be typed, and submits wait for it.
  const unavailable = !bridge || !snapshot;
  const inactive = (snapshot?.permissionTier ?? DEFAULT_PERMISSION_TIER) === 'always';

  /** Saves the whole list; resolves to whether it saved. */
  function save(next: string[]) {
    if (unavailable) return Promise.resolve(false);
    return saving.mutateAsync(next).then(
      () => true,
      () => false,
    );
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unavailable || pending) return;
    const submitted = value;
    const checked = checkEntry(submitted, entries);
    if ('error' in checked) {
      setError(checked.error);
      return;
    }
    setError(null);
    if (await save([...entries, checked.entry])) {
      // Keeps whatever was typed meanwhile.
      setValue((current) => (current === submitted ? '' : current));
    } else setError('save');
  }

  async function remove(entry: string) {
    if (unavailable || pending) return false;
    setError(null);
    const removed = await save(entries.filter((item) => item !== entry));
    if (!removed) setError('save');
    return removed;
  }

  return (
    <section className="settings-shell-allowlist" aria-labelledby={`${inputId}-title`}>
      <div className="settings-shell-allowlist-heading">
        <h3 id={`${inputId}-title`} className="settings-section-title">
          {t('permissions.shellAllowlist.title')}
        </h3>
        <p className="settings-field-note">{t('permissions.shellAllowlist.description')}</p>
        {inactive && (
          <p className="settings-shell-allowlist-inactive">
            <Info aria-hidden="true" />
            <span>{t('permissions.shellAllowlist.inactive')}</span>
          </p>
        )}
      </div>
      <div
        className="settings-shell-allowlist-card rounded-2xl border"
        data-settings-anchor="shell-allowlist"
      >
        <form
          className="settings-shell-allowlist-form"
          aria-busy={pending || undefined}
          onSubmit={(event) => void add(event)}
        >
          <InputGroup className="bg-transparent" data-disabled={unavailable || undefined}>
            <InputGroupAddon>
              <InputGroupText className="font-mono">$</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id={inputId}
              className="font-mono"
              value={value}
              placeholder={t('permissions.shellAllowlist.placeholder')}
              aria-label={t('permissions.shellAllowlist.inputLabel')}
              autoComplete="off"
              spellCheck={false}
              disabled={unavailable}
              aria-invalid={(error !== null && error !== 'save') || undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="submit"
                variant="secondary"
                disabled={unavailable}
                aria-disabled={pending || undefined}
              >
                <Plus />
                {t('permissions.shellAllowlist.add')}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
        {error && (
          <p
            id={errorId}
            role="alert"
            className="settings-inline-error settings-shell-allowlist-error"
          >
            <CircleAlert aria-hidden="true" />
            <span>{t(`permissions.shellAllowlist.errors.${error}`)}</span>
          </p>
        )}
        {entries.length === 0 ? (
          <p className="settings-shell-allowlist-empty">{t('permissions.shellAllowlist.empty')}</p>
        ) : (
          <ItemGroup
            className="settings-shell-allowlist-list"
            aria-label={t('permissions.shellAllowlist.listLabel')}
          >
            {entries.map((entry) => (
              <Item asChild key={entry} size="xs" className="settings-open-row">
                <li>
                  <button
                    type="button"
                    className="settings-open-row-button"
                    aria-label={t('permissions.shellAllowlist.viewLabel', { entry })}
                    onClick={() => setDetail({ entry, open: true })}
                  />
                  <span className="settings-shell-allowlist-prompt font-mono" aria-hidden="true">
                    $
                  </span>
                  <ItemContent>
                    <ItemTitle className="font-mono font-normal">{entry}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <IconButton
                      size="icon-xs"
                      label={t('permissions.shellAllowlist.remove')}
                      aria-label={t('permissions.shellAllowlist.removeLabel', { entry })}
                      disabled={unavailable}
                      aria-disabled={pending || undefined}
                      onClick={() => void remove(entry)}
                    >
                      <Trash2 />
                    </IconButton>
                  </ItemActions>
                </li>
              </Item>
            ))}
          </ItemGroup>
        )}
      </div>
      {detail ? (
        <ShellAllowlistEntryDialog
          entry={detail.entry}
          open={detail.open}
          onOpenChange={(open) => setDetail({ entry: detail.entry, open })}
          unavailable={unavailable}
          removing={pending}
          error={detail.failed ? t('permissions.shellAllowlist.errors.save') : undefined}
          onRemove={() =>
            void remove(detail.entry).then((removed) =>
              setDetail({ entry: detail.entry, open: !removed, failed: !removed }),
            )
          }
        />
      ) : null}
    </section>
  );
}
