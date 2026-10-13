import AICore
import ApplicationServices

/// The write target's caret, which confirms each chunk of a paced paste (``PasteProgress``,
/// ``ClipboardPaste``). Each read is one Accessibility message to the target, bounded by the
/// messaging timeout; the target answers it on its main thread, so a read that arrives during a
/// paste returns once the paste is done. The reads run off the main thread under ``Deadline``.
nonisolated struct FieldCaret: Sendable {
  let target: WriteTarget
  /// How long an unconfirmed chunk waits before the caret is read again.
  private static let pollInterval: Duration = .milliseconds(5)

  /// The paste's starting progress from the field's selection now, or nil when the field exposes
  /// no selected range (web content) or does not answer within `limit`.
  func progress(mode: TextWriteParams.Mode, within limit: Duration) async -> PasteProgress? {
    await Deadline.value(within: limit, fallback: nil) { [self] in
      selection().map { PasteProgress(selection: $0.location, length: $0.length, mode: mode) }
    }
  }

  /// Reads the caret until it reaches `threshold`: its location then, or nil when `limit` passed
  /// first or the field stopped answering.
  func wait(atLeast threshold: Int, within limit: Duration) async -> Int? {
    let deadline = ContinuousClock.now + limit
    return await Deadline.value(within: limit, fallback: nil) { [self] in
      while ContinuousClock.now < deadline {
        if let range = selection(), range.location >= threshold { return range.location }
        try? await Task.sleep(for: Self.pollInterval)
      }
      return nil
    }
  }

  /// The field's selected range; nil when it has none or did not answer. Blocking.
  private func selection() -> CFRange? {
    AXUIElementSetMessagingTimeout(target.element, SelectionReader.messagingTimeout)
    return try? AXField.selectedRange(of: target.element)
  }
}
