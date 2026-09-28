import { useEffect, useState } from 'react';
import { Download, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PluginDetail, PluginInstallPreview } from '@ai/agent-contracts';
import { Button } from '@ai/ui/components/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@ai/ui/components/empty';
import { Input } from '@ai/ui/components/input';
import { Label } from '@ai/ui/components/label';
import { ExtensionDetailStatus } from './extension-detail-fields';
import { ExtensionPage } from './extension-page';
import { PluginInstallPreviewView } from './plugin-install-preview';
import { pluginSourceText, type PluginSourceSpec } from './plugin-rows';
import { parsePluginSource } from './plugin-source';
import type { PluginResult } from './use-plugin-mutations';

/**
 * Installs a plugin in two steps. Fetch copies the bundle from a local folder, a Git repository or
 * an npm package into staging and shows what it holds; nothing runs. Install publishes that
 * preview, and the root then opens the plugin's page, where it waits turned off. Editing the source
 * drops the preview, so what is installed is always what was reviewed. With `updateOf` the page
 * fetches that plugin's recorded source at once and Install updates it. Errors stay on the page.
 */
export function PluginInstallPage({
  updateOf,
  updateName,
  connected,
  busy,
  onBack,
  onPreview,
  onPreviewUpdate,
  onInstall,
}: {
  /** The installed plugin to update, or undefined to install a new one. */
  updateOf?: string;
  updateName?: string;
  connected: boolean;
  busy: boolean;
  onBack: () => void;
  onPreview: (source: PluginSourceSpec) => Promise<PluginResult<PluginInstallPreview>>;
  onPreviewUpdate: (id: string) => Promise<PluginResult<PluginInstallPreview>>;
  onInstall: (previewId: string) => Promise<PluginResult<PluginDetail>>;
}) {
  const { t } = useTranslation('settings');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<PluginInstallPreview | null>(null);
  const [error, setError] = useState('');
  // An update fetches as the page opens; the root keys the page by `updateOf`.
  const [fetching, setFetching] = useState(updateOf !== undefined);
  const locked = busy || !connected;
  const source = parsePluginSource(text);
  const updating = updateOf !== undefined;

  useEffect(() => {
    if (updateOf === undefined) return;
    let active = true;
    void onPreviewUpdate(updateOf).then((result) => {
      if (!active) return;
      setFetching(false);
      if (result.ok) {
        setPreview(result.value);
        setText(pluginSourceText(result.value.source));
      } else setError(result.error);
    });
    return () => {
      active = false;
    };
  }, [onPreviewUpdate, updateOf]);

  function fetchPreview() {
    if (!text.trim() || !source) {
      setError(
        text.trim()
          ? t('extensions.plugins.install.sourceInvalid')
          : t('extensions.plugins.install.sourceRequired'),
      );
      document.getElementById('plugin-install-source')?.focus();
      return;
    }
    setError('');
    setFetching(true);
    void onPreview(source).then((result) => {
      setFetching(false);
      if (result.ok) setPreview(result.value);
      else setError(result.error);
    });
  }

  function install() {
    if (!preview) return;
    setError('');
    void onInstall(preview.previewId).then((result) => {
      if (!result.ok) setError(result.error);
    });
  }

  const title = updating
    ? t('extensions.plugins.install.updateTitle', { name: updateName ?? updateOf })
    : t('extensions.plugins.install.title');
  const detected = source ? t(`extensions.plugins.install.detected.${source.kind}`) : '';
  return (
    <ExtensionPage
      label={title}
      title={title}
      description={t('extensions.plugins.install.description')}
      backLabel={t('extensions.plugins.page.back')}
      onBack={onBack}
      note={t('extensions.plugins.install.startsOff')}
      actions={
        <>
          <Button type="button" variant="outline" onClick={onBack}>
            {t('extensions.cancel')}
          </Button>
          <Button type="button" disabled={locked || !preview} onClick={install}>
            {updating || preview?.existing
              ? t('extensions.plugins.install.updateAction')
              : t('extensions.plugins.install.installAction')}
          </Button>
        </>
      }
    >
      <form
        className="editor-fields"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!locked && !fetching && !updating) fetchPreview();
        }}
      >
        <div className="settings-field">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <Label htmlFor="plugin-install-source">{t('extensions.plugins.install.source')}</Label>
            {detected ? <span className="settings-field-note">{detected}</span> : null}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <Input
              id="plugin-install-source"
              className="min-w-0 flex-1"
              value={text}
              disabled={locked || fetching || updating}
              autoComplete="off"
              spellCheck={false}
              placeholder={t('extensions.plugins.install.sourcePlaceholder')}
              aria-invalid={Boolean(error) && !preview}
              aria-describedby={
                error ? 'plugin-install-error plugin-install-hint' : 'plugin-install-hint'
              }
              onChange={(event) => {
                setText(event.target.value);
                setPreview(null);
                setError('');
              }}
            />
            {/* The form's submit button, so Enter in the field fetches as well. */}
            <Button type="submit" variant="outline" disabled={locked || fetching || updating}>
              <Download data-icon="inline-start" />
              {fetching
                ? t('extensions.plugins.install.fetching')
                : t('extensions.plugins.install.fetch')}
            </Button>
          </div>
          {error ? (
            <p id="plugin-install-error" role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <p id="plugin-install-hint" className="settings-field-note">
            {t('extensions.plugins.install.sourceHint')}
          </p>
        </div>
      </form>
      {preview ? (
        <PluginInstallPreviewView preview={preview} />
      ) : fetching ? (
        <ExtensionDetailStatus text={t('extensions.plugins.install.fetching')} error={false} />
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Package />
            </EmptyMedia>
            <EmptyTitle>{t('extensions.plugins.install.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('extensions.plugins.install.emptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </ExtensionPage>
  );
}
