import { MCP_DEFERRED_TOOL_THRESHOLD, type McpServerExposure } from '@ai/agent-contracts';
import { useTranslation } from 'react-i18next';
import { Label } from '@ai/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import { Switch } from '@ai/ui/components/switch';
import { ExtensionDetailFields, ExtensionDetailSection } from './extension-detail-fields';
import type { McpDraft } from './extension-mcp-draft';
import { McpField } from './extension-mcp-field';
import { MCP_FIELD_ID } from './extension-mcp-problems';

const EXPOSURES: readonly McpServerExposure[] = ['auto', 'direct', 'deferred'];
const RESOURCES_ID = 'mcp-expose-resources';

function isExposure(value: string): value is McpServerExposure {
  return EXPOSURES.some((exposure) => exposure === value);
}

/** Exposure names, shared by the selector and the read-only facts. */
function useExposureLabel() {
  const { t } = useTranslation('settings');
  return (exposure: McpServerExposure) =>
    ({
      auto: t('extensions.mcpPage.exposureAuto'),
      direct: t('extensions.mcpPage.exposureDirect'),
      deferred: t('extensions.mcpPage.exposureDeferred'),
    })[exposure];
}

/**
 * How a server's tools and resources reach the agent: the exposure selector, explaining the
 * current choice (for Automatic, what the server's current tool count picks), and the resources
 * switch. `toolCount` is null until the server is connected and has listed its tools.
 */
export function McpAccessFields({
  draft,
  toolCount,
  onChange,
}: {
  draft: McpDraft;
  toolCount: number | null;
  onChange: (next: McpDraft) => void;
}) {
  const { t } = useTranslation('settings');
  const exposureLabel = useExposureLabel();
  const threshold = MCP_DEFERRED_TOOL_THRESHOLD;
  const autoNote =
    toolCount === null
      ? t('extensions.mcpPage.exposureAutoHint', { threshold })
      : t(
          toolCount > threshold
            ? 'extensions.mcpPage.exposureAutoNowDeferred'
            : 'extensions.mcpPage.exposureAutoNowDirect',
          { threshold, count: toolCount },
        );
  const exposureNote = {
    auto: autoNote,
    direct: t('extensions.mcpPage.exposureDirectHint'),
    deferred: t('extensions.mcpPage.exposureDeferredHint'),
  }[draft.exposure];
  return (
    <>
      <McpField
        id={MCP_FIELD_ID.exposure}
        label={t('extensions.mcpPage.exposure')}
        message={exposureNote}
      >
        <Select
          value={draft.exposure}
          onValueChange={(value) => {
            if (isExposure(value)) onChange({ ...draft, exposure: value });
          }}
        >
          <SelectTrigger id={MCP_FIELD_ID.exposure} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPOSURES.map((exposure) => (
              <SelectItem key={exposure} value={exposure}>
                {exposureLabel(exposure)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </McpField>
      <div className="flex min-w-0 items-center gap-4">
        <Label htmlFor={RESOURCES_ID} className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span className="leading-5">{t('extensions.mcpPage.resources')}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {t('extensions.mcpPage.resourcesHint')}
          </span>
        </Label>
        <Switch
          id={RESOURCES_ID}
          checked={draft.exposeResources}
          onCheckedChange={(exposeResources) => onChange({ ...draft, exposeResources })}
        />
      </div>
    </>
  );
}

/**
 * A plugin server's tool exposure and resource access as facts. Plugins cannot set them: the
 * service always applies Automatic and no resources (agent-service `plugins/map.ts`), which a
 * Personal duplicate can change.
 */
export function McpAccessFacts() {
  const { t } = useTranslation('settings');
  const exposureLabel = useExposureLabel();
  return (
    <ExtensionDetailSection label={t('extensions.mcpPage.accessSection')}>
      <ExtensionDetailFields
        fields={[
          { label: t('extensions.mcpPage.exposure'), value: exposureLabel('auto') },
          {
            label: t('extensions.mcpPage.resourcesFact'),
            value: t('extensions.mcpPage.resourcesBlocked'),
          },
        ]}
      />
      <p className="text-xs text-muted-foreground">{t('extensions.mcpPage.pluginAccessNote')}</p>
    </ExtensionDetailSection>
  );
}
