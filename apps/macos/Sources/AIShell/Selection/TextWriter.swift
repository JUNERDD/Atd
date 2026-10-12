import AICore
import AppKit
import ApplicationServices
import Carbon.HIToolbox

/// Performs `text.write` (contract: `text-calls.ts`): checks the refusals of ``TextWritePlan``
/// before changing anything, then hides the panel, brings the target app forward, restores its
/// field and selection (``FieldRestore``) and types the text in through the clipboard as the
/// user's typing setting says (``ClipboardPaste``), resolving once the field shows the last of it in. One
/// write runs at a time; a second one while it runs fails.
enum TextWriter {
  private static var writing = false
  /// How long the target app gets to come forward.
  private static let activationLimit: Duration = .seconds(1)
  /// A net over the restore's AX messages, each bounded by the messaging timeout.
  private static let restoreLimit: Duration = .seconds(1)
  /// Lets the window server route the keyboard to the target app before keys are posted.
  private static let settle: Duration = .milliseconds(60)

  static func write(_ params: TextWriteParams, to target: WriteTarget?, hidePanel: () -> Void)
    async -> TextWriteResult
  {
    guard !writing else { return refuse(.failed) }
    writing = true
    defer { writing = false }
    let app = target.flatMap { NSRunningApplication(processIdentifier: $0.pid) }
    let facts = TextWriteFacts(
      trusted: AXIsProcessTrusted(), targetAvailable: app.map { !$0.isTerminated } ?? false,
      secureInput: IsSecureEventInputEnabled(), hasSelection: hasSelection(target))
    if let reason = TextWritePlan.refusal(params.mode, facts) { return refuse(reason) }
    guard let target, let app else { return refuse(.targetGone) }

    hidePanel()
    guard await bringForward(app) else { return refuse(.targetChanged) }
    let restore = FieldRestore(target: target, mode: params.mode)
    let outcome = await Deadline.value(
      within: restoreLimit, fallback: .refused(.failed), { restore.run() })
    switch outcome {
    case .refused(let reason):
      return refuse(reason)
    case .ready(let collapseWithArrow):
      if collapseWithArrow { KeyPress.post(CGKeyCode(kVK_RightArrow), flags: []) }
    }
    let insertion = TextWritePlan.insertion(
      of: params.text, mode: params.mode, selectedText: target.selectedText)
    if let reason = await ClipboardPaste.type(
      insertion, into: target, mode: params.mode, typing: params.typing,
      animation: params.animation)
    {
      return .notOk(.init(reason: reason))
    }
    return .ok(.init())
  }

  private static func refuse(_ reason: TextWriteResult.NotOk.Reason) -> TextWriteResult {
    .notOk(.init(reason: reason))
  }

  private static func hasSelection(_ target: WriteTarget?) -> Bool {
    guard let target else { return false }
    switch target.selection {
    // A copy is recorded only when it copied text.
    case .copied: return true
    case .field(let range):
      if let range, range.length > 0 { return true }
      return !(target.selectedText ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
  }

  /// Activates the target app unless it already has the keyboard, and waits until it is
  /// frontmost. Atd yields activation first when it holds it, as the settings window can after
  /// the panel hid. `reassert` activates it even while it is frontmost, which gives it back the
  /// keyboard a non-activating Atd window took (the command island's options card).
  static func bringForward(_ app: NSRunningApplication, reassert: Bool = false) async -> Bool {
    let pid = app.processIdentifier
    if reassert || NSApp.isActive
      || NSWorkspace.shared.frontmostApplication?.processIdentifier != pid
    {
      if NSApp.isActive { NSApp.yieldActivation(to: app) }
      app.activate(options: [])
    }
    let deadline = ContinuousClock.now + activationLimit
    while NSWorkspace.shared.frontmostApplication?.processIdentifier != pid {
      guard ContinuousClock.now < deadline else { return false }
      try? await Task.sleep(for: .milliseconds(20))
    }
    try? await Task.sleep(for: settle)
    return true
  }
}

/// Puts the recorded field back as it was: focused, with the recorded selection, collapsed past
/// it for `afterSelection`. A copied selection (``WriteTarget/Selection/copied``) has no range to
/// put back: the app keeps it while the field is focused again, and a Right Arrow press collapses
/// it to its end for `afterSelection`, as editors do with a selection. Blocking; ``TextWriter``
/// runs it off the main thread under a deadline.
nonisolated struct FieldRestore: Sendable {
  enum Outcome: Sendable {
    /// Ready to paste. Without a settable range the selection is collapsed by a Right Arrow
    /// press, which the caller posts.
    case ready(collapseWithArrow: Bool)
    case refused(TextWriteResult.NotOk.Reason)
  }

  let target: WriteTarget
  let mode: TextWriteParams.Mode

  func run() -> Outcome {
    do throws(AXFieldError) {
      return try restore()
    } catch .invalidElement {
      return .refused(.targetChanged)
    } catch {
      return .refused(.failed)
    }
  }

  private func restore() throws(AXFieldError) -> Outcome {
    let element = target.element
    let app = AXUIElementCreateApplication(target.pid)
    AXUIElementSetMessagingTimeout(element, SelectionReader.messagingTimeout)
    AXUIElementSetMessagingTimeout(app, SelectionReader.messagingTimeout)
    // Also the liveness check: a vanished field throws `invalidElement`.
    if try AXField.isSecure(element) { return .refused(.secureInput) }
    try AXField.focus(element, in: app)
    guard case .field(let recorded) = target.selection else {
      return .ready(collapseWithArrow: mode == .afterSelection)
    }
    if let recorded {
      let restored = try AXField.setSelectedRange(recorded, of: element)
      // A selection that cannot be put back must still be the recorded one; one that cannot be
      // read either (web content) is normally still in place.
      if mode != .cursor, !restored, let current = try AXField.selectedRange(of: element),
        !current.matches(recorded)
      {
        return .refused(.targetChanged)
      }
    }
    guard mode == .afterSelection else { return .ready(collapseWithArrow: false) }
    if let recorded {
      let end = CFRange(location: recorded.location + recorded.length, length: 0)
      if try AXField.setSelectedRange(end, of: element) { return .ready(collapseWithArrow: false) }
    }
    return .ready(collapseWithArrow: true)
  }
}
