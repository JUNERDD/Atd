import AICore
import AppKit

/// Runs the summon flow of `SummonPolicy` for the hot keys, the status item, the selection
/// toolbar and the mini panel, and owns the selection stash it fills: the selection is read
/// before the panel can take focus, through Accessibility or, where that shows none, by a
/// simulated ⌘C (``CopySelection``), and `capture('selection')` answers from the stash, never
/// from a live read. Capture shortcuts deliver immediately and read any wanted selection in the
/// background through Accessibility alone. A command's summon also records the field it came from
/// in ``writeTargets``.
final class Summoner {
  private let panel: PanelWindowController
  let panelHost: WebViewHost
  private let systemPanels: SystemPanels
  let trust: AccessibilityTrust
  /// A summon during a capture session would show the panel against the overlays.
  private let isCapturing: () -> Bool
  /// Admits the simulated ⌘C of ``CopySelection``.
  let arbiter: DeviceArbiter

  /// A summon's steps are running; the panel may still be moving.
  var isSummoning = false
  private var selectionWanted = false
  var stash: CapturedText?
  private var selectionRead: Task<Void, Never>?
  /// Pushed by `commandOptions.set`; prunes unneeded command selection and write-target reads.
  var commandOptions = CommandOptionsCatalog()
  /// The fields commands were summoned from, for `text.write`.
  let writeTargets = WriteTargets()

  init(
    panel: PanelWindowController, panelHost: WebViewHost, systemPanels: SystemPanels,
    trust: AccessibilityTrust, isCapturing: @escaping () -> Bool, arbiter: DeviceArbiter
  ) {
    self.panel = panel
    self.panelHost = panelHost
    self.systemPanels = systemPanels
    self.trust = trust
    self.isCapturing = isCapturing
    self.arbiter = arbiter
  }

  isolated deinit { selectionRead?.cancel() }

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
    selectionRead?.cancel()
    selectionRead = nil
    if steps == [.hidePanel] {
      panel.hideFromShortcut()
      return true
    }
    if case .deliverScreenshot(let mode) = steps.last {
      summonScreenshot(mode: mode, steps: steps, selectedText: selectedText)
      return true
    }
    if steps.last == .showPanel, !steps.contains(.deliverAsk) {
      summonShowPanel(steps: steps, selectedText: selectedText)
      return true
    }
    if case .command(let launch) = trigger {
      beginCommandSummon(launch, steps: steps, selectedText: selectedText, held: held)
      return true
    }
    isSummoning = true
    if steps.contains(.captureTarget),
      let frontmost = NSWorkspace.shared.frontmostApplication,
      frontmost != NSRunningApplication.current,
      WriteTargets.awaitsWebFocus(frontmost)
    {
      SelectionPresence.wake(pid: frontmost.processIdentifier)
    }
    Task {
      defer { isSummoning = false }
      var selection = SummonSelection.unread
      var target: ShortcutCommandEvent.Target?
      for step in steps {
        switch step {
        case .hidePanel:
          panel.hideFromShortcut()
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
        case .deliverScreenshot(let mode):
          panelHost.send(.shortcutScreenshot(.init(mode: mode == .record ? .record : .screenshot)))
        case .deliverAsk: panelHost.send(.selectionAsk(.init()))
        }
      }
    }
    return true
  }

  /// Shows the panel immediately on toggle without blocking on Accessibility or posting ⌘C; any
  /// wanted selection is stashed in the background from the app that was frontmost at the press.
  private func summonShowPanel(steps: [SummonStep], selectedText: String?) {
    stashBackgroundSelection(steps: steps, selectedText: selectedText)
    panel.placeForSummon()
    panel.show()
  }

  /// Delivers a screenshot or screen-recording shortcut immediately, without setting
  /// ``isSummoning`` (`screenshot.capture` rejects calls while the panel is moving) or stalling on
  /// ``CopySelection``. Any wanted selection is read concurrently through Accessibility from the
  /// app that was frontmost when the shortcut fired; capture owns its own trust prompt.
  private func summonScreenshot(mode: CaptureMode, steps: [SummonStep], selectedText: String?) {
    stashBackgroundSelection(steps: steps, selectedText: selectedText)
    panelHost.send(.shortcutScreenshot(.init(mode: mode == .record ? .record : .screenshot)))
  }

  private func stashBackgroundSelection(steps: [SummonStep], selectedText: String?) {
    let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let capturedAt = Date.now
    stash = nil
    guard steps.contains(.captureSelection) else { return }
    if let selectedText {
      stash = TextCapture.stash(selectedText, at: capturedAt)
    } else if SelectionReader.isTrusted {
      selectionRead = Task { [weak self] in
        let outcome = await SelectionReader.readBounded(frontmostPID: pid)
        guard !Task.isCancelled, let self else { return }
        self.selectionRead = nil
        if case .text(let text) = outcome {
          self.stash = TextCapture.stash(text, at: capturedAt)
        }
      }
    }
  }

  /// Some enabled command fills its input from the selection (`shortcuts.set`); without one
  /// the stash goes at once.
  func setSelectionWanted(_ wanted: Bool) {
    selectionWanted = wanted
    if !wanted {
      selectionRead?.cancel()
      selectionRead = nil
      stash = nil
    }
  }

  /// `capture('selection')`: the stash of the last summon, awaiting any background AX read.
  func captureResult() async -> CaptureResult {
    _ = await selectionRead?.value
    return TextCapture.captureResult(stash: stash, trusted: SelectionReader.isTrusted)
  }

  /// The frontmost app's selection, asking for Accessibility once per launch when needed: read
  /// through Accessibility, else copied where ``CopyFallback`` allows it.
  func readSelection() async -> SummonSelection {
    guard SelectionReader.isTrusted else {
      trust.promptForSummon()
      return .field(nil)
    }
    let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier
    switch await SelectionReader.readBounded(frontmostPID: pid) {
    case .text(let text): return .field(text)
    case .none(let focus):
      guard let pid, let text = await CopySelection.copy(from: pid, after: focus, arbiter: arbiter)
      else {
        return .field(nil)
      }
      return .copied(text)
    }
  }
}
