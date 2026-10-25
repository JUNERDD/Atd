import type { TFunction } from 'i18next';
import type { Connection, ProviderCatalogEntry } from '../../client/providers/schema';
import { matchFields } from '@atd/ui/lib/fuzzy-match';
import { PROVIDER_SERVICES } from './provider-presets';
import type {
  ProviderPlanDefinition,
  ProviderServiceDefinition,
} from './provider-service-definition';

export interface ProviderPlan {
  id: string;
  source: ProviderCatalogEntry;
  definition?: ProviderPlanDefinition;
}

export interface ProviderService {
  id: string;
  brand: string;
  plans: ProviderPlan[];
  definition?: ProviderServiceDefinition;
}

export type ProviderConnectionIdentity = Pick<
  Connection,
  'provider' | 'baseUrl' | 'presetId' | 'authType'
>;

function normalizeBaseUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.href;
  } catch {
    return null;
  }
}

/** Explicit UI identity survives proxy URLs, but must still match the runtime provider and auth. */
export function providerPresentation({
  provider,
  baseUrl,
  presetId,
  authType,
}: ProviderConnectionIdentity) {
  const candidates = PROVIDER_SERVICES.flatMap((service) =>
    service.plans
      .filter(
        (plan) =>
          plan.providerId === provider &&
          (!plan.defaults.authTypes || plan.defaults.authTypes.includes(authType)),
      )
      .map((plan) => ({ service, plan })),
  );
  if (presetId !== undefined) return candidates.find(({ plan }) => plan.id === presetId);
  // Shared endpoints cannot reveal which billing credential a legacy connection holds.
  // Keep ambiguous records generic rather than relabeling them as the first plan.
  const normalized = normalizeBaseUrl(baseUrl);
  const endpointMatches = candidates.filter(
    ({ plan }) => plan.baseUrl && normalized && normalizeBaseUrl(plan.baseUrl) === normalized,
  );
  const matches = endpointMatches.length
    ? endpointMatches
    : candidates.filter(({ plan }) => plan.kind === 'builtin' && !plan.baseUrl);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Only explicitly grouped built-ins disappear into a service; generic custom providers remain. */
export function providerServices(catalog: ProviderCatalogEntry[]): ProviderService[] {
  const configured = PROVIDER_SERVICES.map((definition): ProviderService => ({
    id: definition.id,
    brand: definition.brand,
    definition,
    plans: definition.plans.flatMap((plan) => {
      const source = catalog.find((provider) => provider.id === plan.providerId);
      if (!source) return [];
      const authTypes = plan.defaults.authTypes;
      if (authTypes && !source.auth.some((auth) => authTypes.includes(auth.type))) return [];
      return [{ id: plan.id, source, definition: plan }];
    }),
  })).filter((service) => service.plans.length);
  const result: ProviderService[] = [];
  const included = new Set<string>();
  for (const provider of catalog) {
    const grouped = configured.find((service) =>
      service.plans.some(
        (plan) => plan.definition?.kind === 'builtin' && plan.source.id === provider.id,
      ),
    );
    if (grouped) {
      if (!included.has(grouped.id)) result.push(grouped);
      included.add(grouped.id);
    } else {
      result.push({
        id: provider.id,
        brand: provider.id,
        plans: [{ id: provider.id, source: provider }],
      });
    }
  }
  return [...result, ...configured.filter((service) => !included.has(service.id))];
}

export function serviceName(service: ProviderService, t: TFunction<'providers'>): string {
  return service.definition ? t(service.definition.nameKey) : service.plans[0]!.source.name;
}

export function serviceDescription(service: ProviderService, t: TFunction<'providers'>): string {
  return service.definition
    ? t(service.definition.descriptionKey)
    : service.plans[0]!.source.auth.map((method) => method.label).join(' · ');
}

export function planName(plan: ProviderPlan, t: TFunction<'providers'>): string {
  return plan.definition ? t(plan.definition.nameKey) : plan.source.name;
}

/** New-connection defaults only. Editing always loads the saved connection through draftFrom. */
export function providerForPlan(
  plan: ProviderPlan,
  t: TFunction<'providers'>,
): ProviderCatalogEntry {
  const { source, definition } = plan;
  if (!definition) return source;
  const authTypes = definition.defaults.authTypes;
  return {
    ...source,
    name: definition.defaults.nameKey ? t(definition.defaults.nameKey) : source.name,
    auth: authTypes ? source.auth.filter((auth) => authTypes.includes(auth.type)) : source.auth,
    ...(definition.baseUrl !== undefined ? { baseUrl: definition.baseUrl } : {}),
    ...(definition.kind === 'preset' ? { category: definition.category, models: [] } : {}),
  };
}

export function providerSearchAliases(
  identity: ProviderConnectionIdentity,
  t?: TFunction<'providers'>,
): string {
  const match = providerPresentation(identity);
  if (!match) return identity.provider;
  const { service, plan } = match;
  return [
    identity.provider,
    service.id,
    service.aliases,
    plan.id,
    plan.aliases,
    ...(t ? [t(service.nameKey), t(plan.nameKey)] : []),
  ].join(' ');
}

/** Search one service card and retain the matching plans as useful context under its subtitle. */
export function matchProviderService(
  service: ProviderService,
  query: string,
  t: TFunction<'providers'>,
) {
  const name = serviceName(service, t);
  const description = serviceDescription(service, t);
  const matchingPlans = query.trim()
    ? service.plans.filter((plan) =>
        matchFields(query, {
          name: planName(plan, t),
          description: plan.definition ? t(plan.definition.descriptionKey) : '',
          aliases: `${plan.id} ${plan.source.id} ${plan.source.name} ${plan.definition?.aliases ?? ''}`,
        }),
      )
    : [];
  const match = matchFields(query, {
    name,
    description,
    aliases: `${service.id} ${service.definition?.aliases ?? ''}`,
    plans: matchingPlans.map((plan) => `${plan.id} ${planName(plan, t)}`).join(' '),
  });
  return match || matchingPlans.length || !query.trim()
    ? {
        name,
        description,
        match,
        matchingPlans: matchingPlans.length
          ? matchingPlans
          : query.trim() && match
            ? service.plans
            : [],
      }
    : null;
}

/** Unknown or incompatible preset ids keep the generic editor and the source's auth options. */
export function serviceForConnection(catalog: ProviderCatalogEntry[], connection: Connection) {
  const source = catalog.find((provider) => provider.id === connection.provider);
  if (!source) return null;
  const identity = providerPresentation(connection);
  return (
    (identity &&
      providerServices(catalog).find(
        (service) =>
          service.id === identity.service.id &&
          service.plans.some((plan) => plan.id === identity.plan.id),
      )) || {
      id: source.id,
      brand: source.id,
      plans: [{ id: source.id, source }],
    }
  );
}
