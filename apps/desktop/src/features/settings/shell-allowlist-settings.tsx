import { useId, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
import { showErrorToast } from '../../components/toast-store';
import { ShellAllowlistEntryDialog } from './shell-allowlist-entry-dialog';

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
 * without review (Auto); under Always allow the section is not shown. One card holds the add
 * field and the entries, each one line after a `$` prompt; a click on a row opens it in full. The list
 * comes from the settings snapshot; every change saves the whole list through main, which
 * validates it again, persists it, and pushes it to the agent service. The renderer checks
 * entries first so each problem gets its own message; main only rejects generically.
 */
export function ShellAllowlistSettings({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const bridge = window.desktop?.settings;
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<AddError | null>(null);
  const [pending, setPending] = useState(false);
  // The saved list until the next settings broadcast replaces the snapshot, so a quick second
  // edit never builds on the list from before the first save.
  // The entry stays set while its dialog closes, so the closing dialog keeps its text.
  const [detail, setDetail] = useState<{ entry: string; open: boolean } | null>(null);
  const [saved, setSaved] = useState<{ basis: SettingsSnapshot; entries: string[] } | null>(null);
  const entries =
    saved && saved.basis === snapshot ? saved.entries : (snapshot?.shellAllowlist ?? []);
  const unavailable = !bridge || !snapshot || pending;

  async function save(next: string[]) {
    if (!bridge || !snapshot) return false;
    setPending(true);
    try {
      const result = await bridge.saveShellAllowlist(next);
      setSaved({ basis: snapshot, entries: result.shellAllowlist });
      return true;
    } catch {
      return false;
    } finally {
      setPending(false);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unavailable) return;
    const checked = checkEntry(value, entries);
    if ('error' in checked) {
      setError(checked.error);
      return;
    }
    if (await save([...entries, checked.entry])) {
      setValue('');
      setError(null);
    } else setError('save');
  }

  async function remove(entry: string) {
    if (unavailable) return false;
    const removed = await save(entries.filter((item) => item !== entry));
    if (!removed) showErrorToast(t('permissions.shellAllowlist.errors.save'));
    return removed;
  }

  // The list only decides anything when a tier asks: under Always allow every command already
  // runs, so the section would describe a setting with no effect.
  if ((snapshot?.permissionTier ?? DEFAULT_PERMISSION_TIER) === 'always') return null;

  return (
    <section className="settings-shell-allowlist" aria-labelledby={`${inputId}-title`}>
      <div className="settings-shell-allowlist-heading">
        <h3 id={`${inputId}-title`}>{t('permissions.shellAllowlist.title')}</h3>
        <p className="settings-field-note">{t('permissions.shellAllowlist.description')}</p>
      </div>
      <div className="settings-shell-allowlist-card rounded-2xl border">
        <form className="settings-shell-allowlist-form" onSubmit={(event) => void add(event)}>
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
              aria-invalid={error !== null}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton type="submit" variant="secondary" disabled={unavailable}>
                <Plus />
                {t('permissions.shellAllowlist.add')}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
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
          removing={unavailable}
          onRemove={() =>
            void remove(detail.entry).then((removed) => {
              if (removed) setDetail({ entry: detail.entry, open: false });
            })
          }
        />
      ) : null}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {t(`permissions.shellAllowlist.errors.${error}`)}
        </p>
      )}
    </section>
  );
}
