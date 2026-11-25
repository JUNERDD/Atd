import { isChromeBinding, type ComputerEffect } from '@atd/agent-contracts';
import type { GrantScope } from '../../../client/agent/permission-schema';
import { useComputerStatus } from '../../computer/use-computer';

/** A computer action's target as its approval names it (`useComputerActTarget`). */
export interface ComputerActTarget {
  label: string;
  effect: ComputerEffect;
  /** The target is a site of the person's own Chrome (Atd for Chrome). */
  chrome: boolean;
}

/**
 * The registered target a computer action's approval names (`computer` scope), found among the
 * service's targets: its label, the effect asked for, and whether it is a site of the person's own
 * Chrome. Null for any other scope, and while the targets are unread or the binding is gone, so
 * the approval then keeps its generic wording. Only a computer action reads the targets.
 */
export function useComputerActTarget(scope: GrantScope): ComputerActTarget | null {
  const act = scope.tool === 'computer' ? scope : null;
  const { status } = useComputerStatus({ enabled: Boolean(act) });
  if (!act) return null;
  const binding = status?.bindings.find((entry) => entry.bindingId === act.bindingId);
  if (!binding) return null;
  return { label: binding.label, effect: act.effect, chrome: isChromeBinding(binding) };
}
