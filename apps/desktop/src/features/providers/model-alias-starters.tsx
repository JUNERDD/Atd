import { useState } from 'react';
import { CircleAlert, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@atd/ui/components/card';
import type {
  Connection,
  ModelAlias,
  ModelAliasDraft,
  ModelDefinition,
} from '../../client/providers/schema';
import { IconButton } from '../../components/icon-button';
import { messageOf } from '../../lib/errors';
import { formatContextWindow } from './context-window';
import { ProviderBrand } from './provider-brand';
import { providerPresentation } from './provider-services';

interface Candidate {
  connection: Connection;
  model: ModelDefinition;
  isDefaultConnection: boolean;
}

const FAST_MODEL_RE = /haiku|flash|mini|nano|fast|lite|turbo|instant/i;
const FLAGSHIP_MODEL_RE = /opus|sonnet|gpt-5|o3|o4|gemini-2\.5-pro|gemini-3|max|pro|r1/i;
const EXTENDED_OPENAI_IDS = new Set(['gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);

function hasExtendedContext(connection: Connection, model: ModelDefinition): boolean {
  const thresholds = (model.cost.tiers ?? [])
    .map((tier) => tier.inputTokensAbove)
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  if (thresholds.some((threshold) => threshold < model.contextWindow)) return true;
  if ((model.maxContextWindow ?? 0) > model.contextWindow) return true;
  return connection.provider === 'openai' && EXTENDED_OPENAI_IDS.has(model.id);
}

function scoreFast(candidate: Candidate): number {
  const { connection, model, isDefaultConnection } = candidate;
  let score = isDefaultConnection ? 0 : 100;
  if (FAST_MODEL_RE.test(model.id) || FAST_MODEL_RE.test(model.name)) score -= 50;
  if (connection.defaultModel === model.id) score -= 10;
  if (model.cost.input > 0) score += Math.min(model.cost.input, 40);
  return score;
}

function scoreFlagship(candidate: Candidate): number {
  const { connection, model, isDefaultConnection } = candidate;
  let score = isDefaultConnection ? 0 : 100;
  const isFast = FAST_MODEL_RE.test(model.id) || FAST_MODEL_RE.test(model.name);
  if (FLAGSHIP_MODEL_RE.test(model.id) && !isFast) score -= 50;
  if (/opus/i.test(model.id)) score -= 15;
  if (model.reasoning) score -= 10;
  if (connection.defaultModel === model.id) score -= 5;
  if (model.cost.input > 0) score -= Math.min(model.cost.input, 40);
  return score;
}

function bestBy(candidates: readonly Candidate[], score: (item: Candidate) => number): Candidate {
  return candidates.reduce((best, item) => (score(item) < score(best) ? item : best));
}

function draftKey(draft: ModelAliasDraft): string {
  const ctx = !draft.contextChoice
    ? 'default'
    : 'tier' in draft.contextChoice
      ? draft.contextChoice.tier
      : String(draft.contextChoice.contextWindow);
  return `${draft.connectionId}\n${draft.modelId}\n${ctx}\n${draft.thinkingLevel ?? 'default'}`;
}

function deriveStarterDrafts(
  connections: readonly Connection[],
  defaultConnectionId: string | null,
  isZh: boolean,
): ModelAliasDraft[] {
  const candidates: Candidate[] = connections
    .filter((connection) => connection.connected && connection.catalog.length > 0)
    .flatMap((connection) =>
      connection.catalog.map((model) => ({
        connection,
        model,
        isDefaultConnection: connection.connectionId === defaultConnectionId,
      })),
    );
  if (!candidates.length) return [];

  const fast = bestBy(candidates, scoreFast);
  const dailyEffort = fast.model.reasoning
    ? fast.model.thinkingLevelMap?.low !== null
      ? 'low'
      : 'medium'
    : undefined;
  const daily: ModelAliasDraft = {
    name: isZh ? '日常' : 'Daily',
    connectionId: fast.connection.connectionId,
    modelId: fast.model.id,
    ...(dailyEffort ? { thinkingLevel: dailyEffort } : {}),
  };

  const complexPick = bestBy(candidates, scoreFlagship);
  const complexEffort = complexPick.model.reasoning
    ? complexPick.model.thinkingLevelMap?.high !== null
      ? 'high'
      : complexPick.model.defaultThinkingLevel
    : undefined;
  const complex: ModelAliasDraft = {
    name: isZh ? '复杂任务' : 'Complex tasks',
    connectionId: complexPick.connection.connectionId,
    modelId: complexPick.model.id,
    ...(hasExtendedContext(complexPick.connection, complexPick.model)
      ? { contextChoice: { tier: 'long' } }
      : {}),
    ...(complexEffort ? { thinkingLevel: complexEffort } : {}),
  };

  const drafts: ModelAliasDraft[] = [daily, complex];
  const reasoning = candidates.filter((item) => item.model.reasoning);
  if (reasoning.length > 0) {
    const deepPick = bestBy(reasoning, (item) => {
      let score = scoreFlagship(item);
      if (item.model.thinkingLevelMap?.xhigh != null) score -= 25;
      return score;
    });
    const deepEffort = deepPick.model.thinkingLevelMap?.xhigh != null ? 'xhigh' : 'high';
    const deep: ModelAliasDraft = {
      name: isZh ? '架构深思' : 'Deep reasoning',
      connectionId: deepPick.connection.connectionId,
      modelId: deepPick.model.id,
      ...(hasExtendedContext(deepPick.connection, deepPick.model)
        ? { contextChoice: { tier: 'long' } }
        : {}),
      thinkingLevel: deepEffort,
    };
    if (draftKey(deep) !== draftKey(complex) && draftKey(deep) !== draftKey(daily)) {
      drafts.push(deep);
    }
  }
  return drafts;
}

/**
 * Cold-start starter card rendered on Settings -> Providers when the user has at least one
 * connected provider catalog and zero aliases configured yet.
 */
export function ModelAliasStarters({
  connections,
  defaultConnectionId,
  disabled,
  onDismiss,
  onCreateCustom,
  onSeeded,
}: {
  connections: readonly Connection[];
  defaultConnectionId: string | null;
  disabled: boolean;
  onDismiss: () => void;
  onCreateCustom: () => void;
  onSeeded: (aliases: ModelAlias[]) => void;
}) {
  const { t, i18n } = useTranslation('providers');
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState('');
  const bridge = window.desktop?.settings.providers;
  const starters = deriveStarterDrafts(
    connections,
    defaultConnectionId,
    i18n.language.startsWith('zh'),
  );
  if (!starters.length) return null;

  async function handleSeed() {
    if (!bridge || seeding || disabled) return;
    setError('');
    setSeeding(true);
    try {
      const created = await bridge.seedAliases(starters);
      onSeeded(created);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setSeeding(false);
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
          <span>{t('aliases.starters.title')}</span>
        </CardTitle>
        <CardDescription>{t('aliases.starters.description')}</CardDescription>
        <CardAction>
          <IconButton
            label={t('aliases.starters.dismiss')}
            disabled={seeding || disabled}
            onClick={onDismiss}
          >
            <X />
          </IconButton>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="model-alias-starter-list">
          {starters.map((draft) => {
            const connection = connections.find((c) => c.connectionId === draft.connectionId);
            const presentation = connection ? providerPresentation(connection) : null;
            const modelName =
              connection?.catalog.find((m) => m.id === draft.modelId)?.name ?? draft.modelId;
            const contextText = !draft.contextChoice
              ? t('aliases.tuple.connectionContextDefault')
              : 'tier' in draft.contextChoice
                ? draft.contextChoice.tier === 'long'
                  ? t('aliases.tuple.extendedContext')
                  : t('aliases.tuple.standardContext')
                : t('aliases.tuple.windowContext', {
                    size: formatContextWindow(draft.contextChoice.contextWindow),
                  });
            const effortText = draft.thinkingLevel
              ? t('aliases.tuple.effortValue', {
                  level: t(`thinkingLevels.levels.${draft.thinkingLevel}`),
                })
              : t('aliases.tuple.modelEffortDefault');
            return (
              <div key={draft.name} className="model-alias-starter-item">
                <ProviderBrand
                  provider={
                    presentation?.service.brand ?? connection?.provider ?? 'openai-compatible'
                  }
                />
                <div className="model-alias-starter-info">
                  <span className="truncate font-medium text-foreground">{draft.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[
                      connection?.name ?? t('aliases.unavailableConnection'),
                      modelName,
                      contextText,
                      effortText,
                    ].join(' · ')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        {error && (
          <p className="settings-inline-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
      </CardContent>
      <CardFooter className="model-alias-starter-actions">
        <Button
          type="button"
          disabled={!bridge || seeding || disabled}
          aria-busy={seeding || undefined}
          onClick={() => void handleSeed()}
        >
          {seeding ? t('aliases.starters.creating') : t('aliases.starters.create')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={seeding || disabled}
          onClick={onCreateCustom}
        >
          {t('aliases.starters.createCustom')}
        </Button>
      </CardFooter>
    </Card>
  );
}
