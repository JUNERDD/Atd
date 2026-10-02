import AICore
import AppKit

/// Runs the summon flow of `SummonPolicy` for the hot keys, the status item and the selection
/// toolbar, and owns the selection stash it fills: the selection is read before the panel can
/// take focus, and `capture('selection')` answers from the stash, never from a live read.
final class Summoner {
  private let panel: PanelWindowController
  private let panelHost: WebViewHost
  private let systemPanels: SystemPanels
  private let trust: AccessibilityTrust
  /// A summon during a capture session would show the panel against the overlays.
  private let isCapturing: () -> Bool

  /// A summon's steps are running; the panel may still be moving.
  private(set) var isSummoning = false
  private var selectionWanted = false
  private var stash: CapturedText?

  init(
    panel: PanelWindowController, panelHost: WebViewHost, systemPanels: SystemPanels,
    trust: AccessibilityTrust, isCapturing: @escaping () -> Bool
  ) {
    self.panel = panel
    self.panelHost = panelHost
    self.systemPanels = systemPanels
    self.trust = trust
    self.isCapturing = isCapturing
  }

  func summon(_ trigger: SummonTrigger) {
    guard !isSummoning, !isCapturing() else { return }
    let steps = SummonPolicy.steps(
      for: trigger,
      in: SummonContext(
        panelIsKey: panel.isKey, filePanelOpen: systemPanels.isOpen,
        selectionWanted: selectionWanted))
    guard !steps.isEmpty else { return }
    isSummoning = true
    Task {
      defer { isSummoning = false }
      for step in steps {
        switch step {
        case .hidePanel: panel.hide()
        case .captureSelection: stash = TextCapture.stash(await readSelection(), at: .now)
        case .clearSelection: stash = nil
        case .showPanel:
          panel.dockAtCursor()
          panel.show()
        case .deliverCommand(let id): panelHost.send(.shortcutCommand(.init(id: id)))
        case .deliverScreenshot: panelHost.send(.shortcutScreenshot(.init()))
        case .deliverAsk: panelHost.send(.selectionAsk(.init()))
        }
      }
    }
  }

  /// Some enabled command fills its input from the selection (`shortcuts.set`); without one
  /// the stash goes at once.
  func setSelectionWanted(_ wanted: Bool) {
    selectionWanted = wanted
    if !wanted { stash = nil }
  }

  /// `capture('selection')`: the stash of the last summon.
  func captureResult() -> CaptureResult {
    TextCapture.captureResult(stash: stash, trusted: SelectionReader.isTrusted)
  }

  /// The frontmost app's selection, asking for Accessibility once per launch when needed.
  private func readSelection() async -> String? {
    guard SelectionReader.isTrusted else {
      trust.promptOncePerLaunch()
      return nil
    }
    let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier
    return await SelectionReader.readBounded(frontmostPID: pid)
  }
}
