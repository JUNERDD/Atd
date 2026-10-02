import { useTranslation } from 'react-i18next';
import type { PluginInstallPreview } from '@atd/agent-contracts';
import { Alert, AlertDescription } from '@atd/ui/components/alert';
import {
  ExtensionDetailFields,
  ExtensionDetailSection,
  type DetailField,
} from './extension-detail-fields';
import { PluginDiagnostics } from './plugin-diagnostics';
import { pluginSourceText } from './plugin-rows';

const KINDS = ['command', 'skill', 'agent', 'mcp'] as const;

/** Programs, endpoints or scripts to review, one per line in monospace. */
function ReviewList({ label, lines }: { label: string; lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ExtensionDetailSection label={label}>
      <ul className="plugin-review-list">
        {lines.map((line, index) => (
          <li key={`${index}\n${line}`} className="font-mono">
            {line}
          </li>
        ))}
      </ul>
    </ExtensionDetailSection>
  );
}

/**
 * What installing a fetched bundle would add, for the user to confirm: the manifest, its contents
 * by kind, the local programs it can start, the servers it connects to and the scripts its skills
 * carry, what the app does not import, and the only integrity the formats give (the pinned Git
 * commit or npm tarball hash). Confirming a bundle already installed updates it.
 */
export function PluginInstallPreviewView({ preview }: { preview: PluginInstallPreview }) {
  const { t } = useTranslation('settings');
  const { manifest, components, userConfig } = preview.plugin;
  const name = manifest.displayName || manifest.name;
  const pinned = preview.resolved.commit ?? preview.resolved.version;
  const fields: DetailField[] = [
    { label: t('extensions.plugins.install.preview.plugin'), value: name },
    ...(manifest.version
      ? [{ label: t('extensions.plugins.page.version'), value: manifest.version }]
      : []),
    {
      label: t('extensions.plugins.page.format'),
      value: t(`extensions.plugins.format.${preview.plugin.format}`),
    },
    {
      label: t('extensions.plugins.page.license'),
      value: manifest.license || t('extensions.plugins.install.preview.noLicense'),
    },
    ...(manifest.author?.name
      ? [{ label: t('extensions.plugins.install.preview.author'), value: manifest.author.name }]
      : []),
    {
      label: t('extensions.plugins.page.source'),
      value: pluginSourceText(preview.source),
      mono: true,
    },
    ...(pinned ? [{ label: t('extensions.plugins.page.pinned'), value: pinned, mono: true }] : []),
    ...(preview.resolved.integrity
      ? [
          {
            label: t('extensions.plugins.install.preview.integrity'),
            value: preview.resolved.integrity,
            mono: true,
          },
        ]
      : []),
  ];
  const contents: DetailField[] = KINDS.flatMap((kind) => {
    const names = components.filter((item) => item.kind === kind).map((item) => item.name);
    return names.length
      ? [
          {
            label: t(`extensions.plugins.count.${kind}`, { count: names.length }),
            value: names.join(', '),
            mono: true,
          },
        ]
      : [];
  });
  if (userConfig.length)
    contents.push({
      label: t('extensions.plugins.config.title'),
      value: userConfig.map((option) => option.title || option.key).join(', '),
    });
  const { stdio, urls, scripts } = preview.review;
  return (
    <>
      {preview.existing ? (
        <Alert>
          <AlertDescription>
            {t('extensions.plugins.install.preview.updatesExisting', {
              name,
              revision: preview.existing.revision.slice(0, 12),
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      <ExtensionDetailSection label={t('extensions.plugins.install.preview.title')}>
        {manifest.description ? (
          <p className="settings-field-note">{manifest.description}</p>
        ) : null}
        <ExtensionDetailFields fields={fields} />
      </ExtensionDetailSection>
      <ExtensionDetailSection label={t('extensions.plugins.install.preview.contents')}>
        {contents.length ? (
          <ExtensionDetailFields fields={contents} />
        ) : (
          <p className="settings-field-note">{t('extensions.plugins.page.noItems')}</p>
        )}
      </ExtensionDetailSection>
      <ReviewList
        label={t('extensions.plugins.install.preview.stdio')}
        lines={stdio.map((entry) => `${entry.name}: ${[entry.command, ...entry.args].join(' ')}`)}
      />
      <ReviewList
        label={t('extensions.plugins.install.preview.urls')}
        lines={urls.map((entry) => `${entry.name}: ${entry.url}`)}
      />
      <ReviewList label={t('extensions.plugins.install.preview.scripts')} lines={scripts} />
      <PluginDiagnostics
        label={t('extensions.plugins.page.diagnostics')}
        diagnostics={preview.plugin.diagnostics}
      />
      <p className="settings-field-note">{t('extensions.plugins.install.preview.trust')}</p>
    </>
  );
}
