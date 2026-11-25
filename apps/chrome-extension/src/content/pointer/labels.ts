import type { PointerView } from '../../messages/views.ts';
import type { HudT } from '../i18n.ts';
import type { ScrollDirection } from './geometry.ts';

/**
 * The step's visual feedback, apart from its phase. Mirrors `PointerAction.swift`
 * (`apps/macos/Sources/AICore/Computer/Pointer/`): a dispatch is not always a click, and an input
 * finishing must not become a success animation. The pointer frame names the step kind only, so a
 * scroll's direction is unknown here until the frame carries it.
 */
export type PointerAction =
  | { kind: 'click' }
  | { kind: 'fill' }
  | { kind: 'type' }
  | { kind: 'clear' }
  | { kind: 'scroll'; direction: ScrollDirection | null }
  | { kind: 'other' };

/** The action for a `ComputerStepKind` (the frame's `label`). */
export function pointerAction(stepKind: string): PointerAction {
  switch (stepKind) {
    case 'click':
    case 'press':
      return { kind: 'click' };
    case 'fill':
    case 'setValue':
      return { kind: 'fill' };
    case 'type':
      return { kind: 'type' };
    case 'clear':
      return { kind: 'clear' };
    case 'scroll':
      return { kind: 'scroll', direction: null };
    default:
      return { kind: 'other' };
  }
}

function isTextInput(action: PointerAction): boolean {
  return action.kind === 'fill' || action.kind === 'type' || action.kind === 'clear';
}

/**
 * The shell's pointer phase (`PointerPhase.swift`): a dispatch of text input is `typingField`, as
 * `ComputerProgressReporter.pointerPhase` maps it.
 */
export type MarkPhase =
  | 'locating'
  | 'dispatching'
  | 'typingField'
  | 'waiting'
  | 'verifying'
  | 'done';

/** The mark's phase, or null for a phase that never draws (a failed step goes at once). */
export function markPhase(phase: PointerView['phase'], action: PointerAction): MarkPhase | null {
  switch (phase) {
    case 'dispatching':
      return isTextInput(action) ? 'typingField' : 'dispatching';
    case 'failed':
      return null;
    case 'locating':
    case 'waiting':
    case 'verifying':
    case 'done':
      return phase;
  }
}

/**
 * The label for a phase and action, as `PointerStyle.label` picks the catalog key (copy from
 * `Localizable.xcstrings`, `pointer.phase.*`). A scroll without a known direction reads "Acting".
 */
export function pointerLabel(phase: MarkPhase, action: PointerAction, t: HudT): string {
  switch (phase) {
    case 'locating':
      return t('pointer.locating');
    case 'dispatching':
      if (action.kind === 'click') return t('pointer.clicking');
      if (action.kind === 'scroll' && action.direction) return scrollLabel(action.direction, t);
      return t('pointer.acting');
    case 'typingField':
      if (action.kind === 'type') return t('pointer.typing');
      if (action.kind === 'clear') return t('pointer.clearing');
      return t('pointer.filling');
    case 'waiting':
      return t('pointer.waiting');
    case 'verifying':
      return t('pointer.verifying');
    case 'done':
      return t('pointer.done');
  }
}

function scrollLabel(direction: ScrollDirection, t: HudT): string {
  switch (direction) {
    case 'up':
      return t('pointer.scrollUp');
    case 'down':
      return t('pointer.scrollDown');
    case 'left':
      return t('pointer.scrollLeft');
    case 'right':
      return t('pointer.scrollRight');
  }
}

/** `PointerStyle.isDashed`: dashed while the host looks or waits, solid while it acts or confirms. */
export function isDashed(phase: MarkPhase): boolean {
  return phase === 'locating' || phase === 'waiting' || phase === 'verifying';
}
