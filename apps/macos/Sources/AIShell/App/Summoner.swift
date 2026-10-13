import AICore
import AppKit

/// Runs the summon flow of `SummonPolicy` for the hot keys, the status item, the selection
/// toolbar and the mini panel, and owns the selection stash it fills: the selection is read
/// before the panel can take focus, through Accessibility or, where that shows none, by a
/// simulated ⌘C (``CopySelection``), and `capture('selection')` answers from the stash, never
/// from a live read. A command's summon also records the field it came from in ``writeTargets``.
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
  /// The fields commands were summoned from, for `text.write`.
  let writeTargets = WriteTargets()

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

  /// `selectedText` is the selection when it is already known: the welcome guide's practice
  /// selection when its toolbar asked (the frontmost app is Atd itself then), or text dropped on
  /// the mini panel. A capture step stashes it in place of reading the frontmost app.
  ///
  /// A command shortcut's hold (`held`) decides the launch's intent: the capture steps run at
  /// once, and the command is delivered once the hold has decided (``ShortcutHolds``). Returns
  /// whether the summon started; one already running, a capture session or an open file panel
  /// leave it out.
  @discardableResult
  func summon(_ trigger: SummonTrigger, selectedText: String? = nil, held: HeldIntent? = nil)
    -> Bool
  {
    guard !isSummoning, !isCapturing() else { return false }
    let steps = SummonPolicy.steps(
      for: trigger,
      in: SummonContext(
        panelIsKey: panel.isKey, filePanelOpen: systemPanels.isOpen,
        selectionWanted: selectionWanted))
    guard !steps.isEmpty else { return false }
    isSummoning = true
    if steps.contains(where: { if case .captureTarget = $0 { true } else { false } }),
      let frontmost = NSWorkspace.shared.frontmostApplication,
      frontmost != NSRunningApplication.current
    {
      SelectionPresence.wake(pid: frontmost.processIdentifier)
    }
    Task {
      defer { isSummoning = false }
      var selection = SummonSelection.unread
      var target: ShortcutCommandEvent.Target?
      for step in steps {
        switch step {
        case .hidePanel: panel.hide()
        case .captureSelection:
          var read = SummonSelection.field(selectedText)
          if selectedText == nil { read = await readSelection() }
          stash = TextCapture.stash(read.text, at: .now)
          selection = stash == nil ? .field(nil) : read
        case .clearSelection: stash = nil
        case .captureTarget:
          target = await writeTargets.capture(after: selection)
        case .showPanel:
          panel.placeForSummon()
          panel.show()
        case .deliverCommand(var launch):
          if let held {
            launch = CommandLaunch(
              id: launch.id, arguments: launch.arguments, intent: await held.intent())
          }
          panelHost.send(.shortcutCommand(launch.event(target: target)))
          held?.delivered()
        case .deliverScreenshot: panelHost.send(.shortcutScreenshot(.init()))
        case .deliverAsk: panelHost.send(.selectionAsk(.init()))
        }
      }
    }
    return true
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

  /// The frontmost app's selection, asking for Accessibility once per launch when needed: read
  /// through Accessibility, else copied where ``CopyFallback`` allows it.
  private func readSelection() async -> SummonSelection {
    guard SelectionReader.isTrusted else {
      trust.promptForSummon()
      return .field(nil)
    }
    let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier
    switch await SelectionReader.readBounded(frontmostPID: pid) {
    case .text(let text): return .field(text)
    case .none(let focus):
      guard let pid, let text = await CopySelection.copy(from: pid, after: focus) else {
        return .field(nil)
      }
      return .copied(text)
    }
  }
}
