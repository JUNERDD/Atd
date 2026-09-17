/** Shared context contract for the ContextBubble product component. */

export interface ContextBubbleFile {
  id: string;
  name: string;
  size: number;
  type: string;
}

export interface ContextBubbleState {
  /** Whether the expandable preview region is visible. */
  open: boolean;
}

export interface ContextBubbleActions {
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
}

export interface ContextBubbleMeta {
  /** Id of the preview region, owned by Preview and referenced by Label. */
  contentId: string;
  /** Id of the label control, referenced by Preview for labelling. */
  labelId: string;
}

export interface ContextBubbleContextValue {
  state: ContextBubbleState;
  actions: ContextBubbleActions;
  meta: ContextBubbleMeta;
}
