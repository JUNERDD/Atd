/**
 * Reading of an `automation` call from its arguments. The one tool lists, reads and previews the
 * person's automations, reads the time and folders a new one is written against, and creates,
 * changes, switches, runs and deletes them (agent-service `automations/tool.ts`), so its row label
 * comes from the call's `op` rather than the tool name.
 */

export type AutomationStepKey =
  | 'activity.step.automation'
  | 'activity.step.automationList'
  | 'activity.step.automationGet'
  | 'activity.step.automationContext'
  | 'activity.step.automationPreview'
  | 'activity.step.automationCreate'
  | 'activity.step.automationUpdate'
  | 'activity.step.automationDelete'
  | 'activity.step.automationEnable'
  | 'activity.step.automationDisable'
  | 'activity.step.automationRun';

/** The row label of a call; a shape the tool does not take reads as the generic manage label. */
export function automationStepKey(args: Record<string, unknown>): AutomationStepKey {
  switch (args.op) {
    case 'list':
      return 'activity.step.automationList';
    case 'get':
      return 'activity.step.automationGet';
    case 'context':
      return 'activity.step.automationContext';
    case 'preview':
      return 'activity.step.automationPreview';
    case 'create':
      return 'activity.step.automationCreate';
    case 'update':
      return 'activity.step.automationUpdate';
    case 'delete':
      return 'activity.step.automationDelete';
    case 'enable':
      return 'activity.step.automationEnable';
    case 'disable':
      return 'activity.step.automationDisable';
    case 'run':
      return 'activity.step.automationRun';
    default:
      return 'activity.step.automation';
  }
}

/**
 * What a call names: the automation a create or update saves, by its name, else the automation it
 * acts on, by id. Listing, the time and folders, and a new trigger's preview name none.
 */
export function automationTarget(args: Record<string, unknown>): string | null {
  const draft = args.automation;
  if (draft && typeof draft === 'object' && !Array.isArray(draft)) {
    const name = (draft as Record<string, unknown>).name;
    if (typeof name === 'string' && name) return name;
  }
  const id = args.automationId;
  return typeof id === 'string' && id ? id : null;
}
