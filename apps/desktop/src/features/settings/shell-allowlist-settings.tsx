import { useId, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { Label } from '@ai/ui/components/label';
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@ai/ui/components/item';
import {
  SHELL_ALLOWLIST_MAX_ENTRIES,
  normalizeShellAllowlistEntry,
  type ShellAllowlistEntryError,
} from '@ai/agent-contracts';
import type { SettingsSnapshot } from '../../../electron/settings-contract';
import { IconButton } from '../../components/icon-button';
import { showErrorToast } from '../../components/toast-store';

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
 * The user's shell allowlist: commands starting with an entry run without a confirm. The list
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
    if (unavailable) return;
    if (!(await save(entries.filter((item) => item !== entry))))
      showErrorToast(t('permissions.shellAllowlist.errors.save'));
  }

  return (
    <section className="settings-shell-allowlist" aria-labelledby={`${inputId}-title`}>
      <div className="settings-shell-allowlist-heading">
        <h3 id={`${inputId}-title`}>{t('permissions.shellAllowlist.title')}</h3>
        <p className="settings-field-note">{t('permissions.shellAllowlist.description')}</p>
      </div>
      <form className="settings-shell-allowlist-form" onSubmit={(event) => void add(event)}>
        <Label htmlFor={inputId}>{t('permissions.shellAllowlist.inputLabel')}</Label>
        <div className="settings-shell-allowlist-control">
          <Input
            id={inputId}
            value={value}
            placeholder={t('permissions.shellAllowlist.placeholder')}
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
          <Button type="submit" variant="outline" disabled={unavailable}>
            <Plus />
            {t('permissions.shellAllowlist.add')}
          </Button>
        </div>
        {error && (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {t(`permissions.shellAllowlist.errors.${error}`)}
          </p>
        )}
      </form>
      {entries.length === 0 ? (
        <p className="settings-field-note">{t('permissions.shellAllowlist.empty')}</p>
      ) : (
        <ItemGroup aria-label={t('permissions.shellAllowlist.listLabel')}>
          {entries.map((entry) => (
            <Item asChild key={entry} variant="outline" size="xs">
              <li>
                <ItemContent>
                  <ItemTitle className="font-mono font-normal">{entry}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <IconButton
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
    </section>
  );
}
