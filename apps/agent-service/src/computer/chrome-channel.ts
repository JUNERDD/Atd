import {
  COMPUTER_ENGINE_FOR_KIND,
  isChromeBinding,
  type ComputerAccessTarget,
  type ComputerEffect,
  type ComputerEngine,
  type PreparedComputerAccessTarget,
  type RunComputer,
  type TargetBinding,
  type TargetBindingContent,
} from '@atd/agent-contracts';

/*
 * What the service enforces for the person's own Chrome (Atd for Chrome; browser bindings with
 * `channel: 'chrome'`, whose `profileId` is the pairing's installation id). It is their daily
 * browser with their signed-in sessions, so it serves attended runs only, a submit there always
 * asks, and a website opens there only when asked for or when the run was started from it.
 * Automations keep running on the managed profile.
 */

/** Why an unattended or recipe-bound run cannot use a target on the person's own Chrome. */
export const CHROME_ATTENDED_ONLY =
  "That target is the person's own Chrome (Atd for Chrome), which serves only tasks the person runs themselves, never automation runs, recipes or their trials; nothing was sent. An automation acts on Atd's managed browser: re-create its targets there instead.";

/**
 * Why this run may not act on the binding, or null: a binding on the person's own Chrome needs
 * an attended run that follows no recipe (no grant, no trial).
 */
export function chromeProblem(
  binding: TargetBindingContent,
  unattended: boolean,
  recipeBound: boolean,
): string | null {
  return isChromeBinding(binding) && (unattended || recipeBound) ? CHROME_ATTENDED_ONLY : null;
}

/**
 * Whether approving this effect on the binding must ask the person every time, with no session
 * grant, tier or review letting it through: a submit in their own Chrome sends something on their
 * behalf from their signed-in sessions.
 */
export function asksAlways(binding: TargetBindingContent, effect: ComputerEffect): boolean {
  return isChromeBinding(binding) && effect === 'submit';
}

/**
 * The target the host is asked to prepare: a website names its browser, the one the call asked
 * for, else `chrome` when the run was started with `browser: 'chrome'`, else `managed`.
 */
export function preparedTarget(
  target: ComputerAccessTarget,
  computer: RunComputer | undefined,
): PreparedComputerAccessTarget {
  if (target.kind === 'application') return target;
  const browser = target.browser ?? (computer?.browser === 'chrome' ? 'chrome' : 'managed');
  return { ...target, browser };
}

/** The engine that will drive the prepared target (`computerEngineFor` once it is a binding). */
export function preparedEngine(target: PreparedComputerAccessTarget): ComputerEngine {
  if (target.kind === 'application') return COMPUTER_ENGINE_FOR_KIND.native;
  return target.browser === 'chrome' ? 'chrome' : COMPUTER_ENGINE_FOR_KIND.browser;
}

/** Whether the host's candidate is on the browser it was asked to prepare. */
export function onPreparedBrowser(
  target: PreparedComputerAccessTarget,
  content: TargetBindingContent,
): boolean {
  if (target.kind === 'application') return true;
  return (target.browser === 'chrome') === isChromeBinding(content);
}

/**
 * The binding content of a site the person allowed in Atd for Chrome: the whole origin, from its
 * root page, on that paired Chrome.
 */
export function chromeSiteContent(installationId: string, origin: string): TargetBindingContent {
  const { host } = new URL(origin);
  return {
    kind: 'browser',
    channel: 'chrome',
    label: host.slice(0, 120),
    profileId: installationId,
    allowedOrigins: [origin],
    startUrl: `${origin}/`,
    pageRule: { urlPrefix: `${origin}/` },
  };
}

/**
 * The saved binding of one site on one paired Chrome, whichever way it was registered (the
 * person's site switch or an approved access request): the same installation and exactly that
 * origin.
 */
export function chromeSiteBinding(
  bindings: readonly TargetBinding[],
  installationId: string,
  origin: string,
): TargetBinding | undefined {
  return bindings.find(
    (binding) =>
      isChromeBinding(binding) &&
      binding.kind === 'browser' &&
      binding.profileId === installationId &&
      binding.allowedOrigins.length === 1 &&
      binding.allowedOrigins[0] === origin,
  );
}
