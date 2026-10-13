import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import type {
  Connection,
  ContextTier,
  ModelContextChoice,
  ModelContexts,
  ModelReference,
} from '../../client/providers/schema';
import { showErrorToast } from '../../components/toast-store';
import i18n from '../../i18n';
import { useServiceStatus } from '../service/use-service';
import { formatContextWindow } from './context-window';
import { modelDefinitionKey } from './model-definition-key';

const NONE: ModelContexts = {
  options: [],
  defaultTier: null,
  selected: null,
  catalogWindow: null,
  custom: null,
  choices: [],
};

/** One request per connection revision and model definition; concurrent consumers share it. */
const pending = new Map<string, Promise<ModelContexts>>();

/**
 * The model's context windows from the main process. Never rejects to the caller: a missing
 * bridge, an unknown model, or a failed request all resolve to no windows, which keeps the
 * Context row read-only.
 */
function loadContexts(reference: ModelReference, key: string): Promise<ModelContexts> {
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const bridge = window.desktop?.settings.providers;
  const request = bridge ? bridge.contexts(reference).catch(() => NONE) : Promise.resolve(NONE);
  pending.set(key, request);
  void request.finally(() => pending.delete(key));
  return request;
}

export interface ModelContextState {
  /** Both tiers when the model offers a priced choice (`standard` first); otherwise empty. */
  options: ModelContexts['options'];
  /** The tier later runs of this model use without a custom window; null without tiers. */
  selected: ContextTier | null;
  /** The model's own window in the catalog; null for an unknown model (no choice offered). */
  catalogWindow: number | null;
  /** The window the user set for the model; null when none is set. */
  custom: number | null;
  /** The other windows the user may pick, smallest first. */
  choices: number[];
  /** The window new runs use: the custom one, else the selected tier's, else the catalog's. */
  window: number | null;
  loading: boolean;
}

/**
 * Context windows for one model selection, requested while the service is connected. The saved
 * choice lives on `connection`, so a new revision (after a context write, or any other edit) asks
 * again, and so does a catalog refresh that changes the model's definition; the previous answer
 * stays shown meanwhile so the trigger does not flicker.
 */
export function useModelContexts(
  reference: ModelReference | null,
  connection: Connection | undefined,
): ModelContextState {
  const connectionId = reference?.connectionId ?? null;
  const modelId = reference?.modelId ?? null;
  const revision = connection?.connectionId === connectionId ? connection?.revision : undefined;
  const connected = useServiceStatus().status?.state === 'connected';
  const model =
    connected && connectionId && modelId && revision ? `${connectionId}:${modelId}` : null;
  const version =
    model && modelId ? `${revision}:${modelDefinitionKey(connection, modelId)}` : null;
  const [answers, setAnswers] = useState<
    ReadonlyMap<string, { version: string; contexts: ModelContexts }>
  >(() => new Map());
  useEffect(() => {
    if (!model || !version || !connectionId || !modelId) return;
    let active = true;
    void loadContexts({ connectionId, modelId }, `${model}:${version}`).then((contexts) => {
      if (active) setAnswers((current) => new Map(current).set(model, { version, contexts }));
    });
    return () => {
      active = false;
    };
  }, [model, version, connectionId, modelId]);
  const answer = model ? answers.get(model) : undefined;
  const contexts = answer?.contexts ?? NONE;
  const options = contexts.options.length === 2 ? contexts.options : [];
  const tier = options.find((option) => option.tier === contexts.selected);
  return {
    options,
    selected: contexts.selected,
    catalogWindow: contexts.catalogWindow,
    custom: contexts.custom,
    choices: contexts.choices,
    window: contexts.custom ?? tier?.contextWindow ?? contexts.catalogWindow,
    loading: Boolean(model) && answer?.version !== version,
  };
}

/** One row of a context choice list, shared by the model popover and `/context`. */
export interface ContextRow {
  /** Unique within the list: the tier, `default`, `custom`, or `choice:<window>`. */
  key: string;
  kind: ContextTier | 'default' | 'choice' | 'custom';
  window: number;
  /** The tokens above which a `long` request is billed higher; null elsewhere. */
  pricedAbove: number | null;
  checked: boolean;
  /** The write picking this row makes; null when the row is already what runs use. */
  choice: ModelContextChoice | null;
}

/** Each named row's title in the `providers` namespace; a choice row is titled by its window. */
const ROW_LABELS = {
  standard: 'modelConfig.tiers.standard',
  long: 'modelConfig.tiers.long',
  default: 'modelConfig.modelDefault',
  custom: 'modelConfig.custom.row',
} as const satisfies Record<Exclude<ContextRow['kind'], 'choice'>, string>;

/** A row's title: its name, or for a choice the window itself (`128k`, `1M`). */
export function contextRowTitle(row: ContextRow, t: TFunction<'providers'>): string {
  return row.kind === 'choice' ? formatContextWindow(row.window) : t(ROW_LABELS[row.kind]);
}

/**
 * The rows a model's context choice lists: its two tiers or its catalog window as the model
 * default, then each window the service offers besides them (smallest first). A custom window
 * checks its choice row instead of a tier or the default; one no longer among the choices (saved
 * before they changed) stays listed as a checked Custom row. Picking a tier or the default clears
 * the custom window; none without a known catalog window.
 */
export function contextRows(contexts: ModelContextState): ContextRow[] {
  const { custom, catalogWindow, selected, choices } = contexts;
  if (catalogWindow === null) return [];
  const base: ContextRow[] =
    contexts.options.length === 2
      ? contexts.options.map((option) => {
          const checked = custom === null && option.tier === selected;
          return {
            key: option.tier,
            kind: option.tier,
            window: option.contextWindow,
            pricedAbove: option.tier === 'long' ? option.pricedAbove : null,
            checked,
            choice: checked ? null : { tier: option.tier },
          };
        })
      : [
          {
            key: 'default',
            kind: 'default',
            window: catalogWindow,
            pricedAbove: null,
            checked: custom === null,
            choice: custom === null ? null : { contextWindow: null },
          },
        ];
  const offered = choices.map((window): ContextRow => {
    const checked = custom === window;
    return {
      key: `choice:${window}`,
      kind: 'choice',
      window,
      pricedAbove: null,
      checked,
      choice: checked ? null : { contextWindow: window },
    };
  });
  const legacy: ContextRow[] =
    custom !== null && !choices.includes(custom)
      ? [
          {
            key: 'custom',
            kind: 'custom',
            window: custom,
            pricedAbove: null,
            checked: true,
            choice: null,
          },
        ]
      : [];
  return [...base, ...offered, ...legacy];
}

/**
 * Saves a model's context choice on its connection: a tier, or one of its offered windows (null
 * clears it). Failures (a stale revision, a lost service) show as an error toast; the settings
 * snapshot that follows every write refreshes the shown window either way.
 */
export async function saveModelContext(
  reference: ModelReference,
  choice: ModelContextChoice,
  revision: number,
): Promise<void> {
  try {
    const bridge = window.desktop?.settings.providers;
    if (!bridge) throw new Error(i18n.t('panel:errors.openDesktopApp'));
    await bridge.setContext(reference, choice, revision);
  } catch (error) {
    showErrorToast(error);
  }
}
