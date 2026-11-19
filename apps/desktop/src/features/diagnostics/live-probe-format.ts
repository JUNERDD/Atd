import type { LiveProbeEvent } from '../../client/diagnostics-contract';

export function formatLiveProbeSummary(event: LiveProbeEvent): string {
  switch (event.kind) {
    case 'selection':
      return [
        `axTrusted=${event.axTrusted}`,
        `excluded=${event.excludedByAppRule}`,
        `len=${event.selectedLength}`,
        event.axRole ? `role=${event.axRole}` : null,
        event.frontmostBundleId ? `app=${event.frontmostBundleId}` : null,
        `gate=${event.gateOutcome}`,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'hotkey':
      return [
        `secureInput=${event.secureInputEnabled}`,
        `postEvent=${event.postEventTrusted}`,
        `monitor=${event.globalMonitorActive}`,
        event.matchedShortcutId ? `shortcut=${event.matchedShortcutId}` : null,
        `mods=0x${event.modifierFlagsMask.toString(16)}`,
        `handoff=${event.handoffOutcome}`,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'capture':
      return [
        `screenRecording=${event.screenRecordingTrusted}`,
        `displays=${event.displayCount}`,
        `freezeReady=${event.sdrFreezeReady}`,
        `arbiterHeld=${event.arbiterInteractiveHeld}`,
        event.heldOwnerSummary ? `owner=${event.heldOwnerSummary}` : null,
        `gate=${event.gateOutcome}`,
      ]
        .filter(Boolean)
        .join(' · ');
  }
}
