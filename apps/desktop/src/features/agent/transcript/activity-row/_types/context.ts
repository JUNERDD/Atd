/** Shared context contract for the ActivityRow product component. */

export interface ActivityRowState {
  /** Whether the expandable body region is visible. */
  open: boolean;
  /** Row status, reflected as `data-status` when provided. */
  status?: string;
}

export interface ActivityRowActions {
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
}

export interface ActivityRowMeta {
  /** Id of the body region, owned by Content and referenced by Trigger. */
  contentId: string;
  /** Id of the trigger control, referenced by Content for labelling. */
  triggerId: string;
}

export interface ActivityRowContextValue {
  state: ActivityRowState;
  actions: ActivityRowActions;
  meta: ActivityRowMeta;
}
