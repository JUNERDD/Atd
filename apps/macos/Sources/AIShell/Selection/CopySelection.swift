import AICore
import AppKit
import Carbon.HIToolbox

/// Reads the selection by Copy where the summon's Accessibility read
/// (``SelectionReader``) found none it could tell from: apps that draw their own selection, such
/// as VS Code's editor outside its screen-reader mode, show none to Accessibility but copy it.
/// ``CopyFallback`` holds the rules.
///
/// Prefer the standard Copy menu action: it works while a command shortcut is still held, so
/// the hold can open its options with the selection intact. Without an actionable menu item,
/// wait for the shortcut's modifiers to come up before posting ⌘C (``KeyPress``), so an app that
/// reads physical key state does not receive, say, ⌘⌥⇧C. The general pasteboard is
/// snapshotted first and put back exactly as it was right after the copy; only a copy that
/// changed the pasteboard counts, so the user's own clipboard is never taken for the selection.
/// A copy that lands after ``CopyFallback/copyLimit`` still gets the pasteboard put back.
///
/// The copy holds global input (``DeviceArbiter``) until ⌘C landed or timed out, and the
/// clipboard until the pasteboard is back, its late restore included, so no other write lands
/// in between to be overwritten. Either held by someone else rules the copy out.
///
/// What the user can notice: a clipboard manager may record the copied text (the app writes it,
/// unmarked), and an app that copies something when nothing is selected hands that over as the
/// selection (VS Code copies the current line, `editor.emptySelectionClipboard`).
enum CopySelection {
  struct Content {
    let text: String
    /// The public HTML clipboard representation describes a table. This identifies even a
    /// single cell from an opaque spreadsheet canvas, independently of vendor clipboard types.
    let containsCells: Bool
    /// Plain text alone cannot distinguish a character selection from a single grid cell.
    let hasHTML: Bool
  }
  private static let pollInterval: Duration = .milliseconds(10)

  /// The text Copy in `pid`, the app the read just found `focus` in, copies; nil when
  /// ``CopyFallback`` rules the copy out or it copied no text.
  static func copy(from pid: pid_t, after focus: SelectionFocus, arbiter: DeviceArbiter) async
    -> Content?
  {
    guard allowed(into: pid, focus: focus) else { return nil }
    let command = await Task.detached { SelectionEditMenu.copyCommand(pid: pid) }.value
    if command == nil {
      guard await modifiersReleased(within: CopyFallback.releaseLimit) else { return nil }
    }
    // The user may have switched apps, or Atd taken the keyboard, during menu lookup or release.
    guard allowed(into: pid, focus: focus),
      let input = try? arbiter.tryClaim([.globalInput], owner: .user(.copySelection))
    else { return nil }
    defer { input.release() }
    guard let clipboard = try? arbiter.tryClaim([.clipboard], owner: .user(.copySelection))
    else { return nil }
    let pasteboard = NSPasteboard.general
    let saved = PasteboardSnapshot(of: pasteboard)
    let before = pasteboard.changeCount
    if command?.perform() != true {
      guard await modifiersReleased(within: CopyFallback.releaseLimit),
        allowed(into: pid, focus: focus)
      else {
        clipboard.release()
        return nil
      }
      KeyPress.post(KeyPress.copyKeyCode(), flags: .maskCommand)
    }
    guard await copyLanded(on: pasteboard, since: before, within: CopyFallback.copyLimit) else {
      Task {
        await restoreLateCopy(saved, to: pasteboard, since: before)
        clipboard.release()
      }
      return nil
    }
    defer { clipboard.release() }
    let text = CopyFallback.copiedText(
      string: pasteboard.string(forType: .string),
      hasFiles: pasteboard.types?.contains(.fileURL) ?? false)
    let html = text == nil ? nil : pasteboard.string(forType: .html)
    let containsCells =
      html?.range(of: "<table\\b", options: [.regularExpression, .caseInsensitive])
      != nil
    saved.restore(to: pasteboard)
    return text.map { Content(text: $0, containsCells: containsCells, hasHTML: html != nil) }
  }

  private static func allowed(into pid: pid_t, focus: SelectionFocus) -> Bool {
    // The keys go to the frontmost app, which must still be the one the read looked at.
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { return false }
    let shellHasKeyboard =
      pid == ProcessInfo.processInfo.processIdentifier || NSApp.keyWindow != nil
    return CopyFallback.applies(
      CopyFallbackFacts(
        focus: focus, shellHasKeyboard: shellHasKeyboard,
        secureInput: IsSecureEventInputEnabled()))
  }

  /// Waits until the keyboard holds no shortcut modifier: true once it does, false when `limit`
  /// passed first.
  private static func modifiersReleased(within limit: Duration) async -> Bool {
    let deadline = ContinuousClock.now + limit
    while CopyFallback.shortcutModifiersHeld(CGEventSource.flagsState(.hidSystemState).rawValue) {
      guard ContinuousClock.now < deadline else { return false }
      try? await Task.sleep(for: pollInterval)
    }
    return true
  }

  /// Polls until the copy is in: the change count moved from `before` and the pasteboard has a
  /// string, since an app may clear it a moment before it writes. True once the copy is in, or
  /// when `limit` passed after the change count moved without a string (a copy of no text);
  /// false when it never moved.
  private static func copyLanded(
    on pasteboard: NSPasteboard, since before: Int, within limit: Duration
  ) async -> Bool {
    let deadline = ContinuousClock.now + limit
    while pasteboard.changeCount == before || pasteboard.string(forType: .string) == nil {
      guard ContinuousClock.now < deadline else { return pasteboard.changeCount != before }
      try? await Task.sleep(for: pollInterval)
    }
    return true
  }

  /// Polls the change count until it moves from `before`: true once it did, false when `limit`
  /// passed first.
  private static func changed(
    _ pasteboard: NSPasteboard, since before: Int, within limit: Duration
  ) async -> Bool {
    let deadline = ContinuousClock.now + limit
    while pasteboard.changeCount == before {
      guard ContinuousClock.now < deadline else { return false }
      try? await Task.sleep(for: pollInterval)
    }
    return true
  }

  /// Puts the snapshot back should the app's copy still land within
  /// ``CopyFallback/lateCopyLimit``; such a copy no longer counts as the selection.
  private static func restoreLateCopy(
    _ saved: PasteboardSnapshot, to pasteboard: NSPasteboard, since before: Int
  ) async {
    if await changed(pasteboard, since: before, within: CopyFallback.lateCopyLimit) {
      saved.restore(to: pasteboard)
    }
  }
}
