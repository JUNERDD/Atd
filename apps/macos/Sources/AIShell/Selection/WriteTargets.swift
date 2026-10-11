import AICore
import AppKit
import ApplicationServices

/// The text field a command was summoned from, kept so `text.write` can put the run's answer
/// back into it. AX elements are immutable handles the AX API accepts from any thread, hence
/// `@unchecked Sendable`.
nonisolated struct WriteTarget: @unchecked Sendable {
  /// Where the recorded selection came from, which decides how `text.write` puts it back.
  nonisolated enum Selection {
    /// The field's own selection: `range` is its selected range when recorded, in UTF-16 units;
    /// nil where the field exposes none. ``FieldRestore`` puts it back and ``ClipboardPaste``
    /// follows the caret from it.
    case field(range: CFRange?)
    /// The summon read the selection by copying (``CopySelection``), because Accessibility
    /// showed none: the field's range does not describe it (the app draws its selection
    /// itself), so the write pastes over the selection as the app still has it, in one paste.
    case copied
  }

  let pid: pid_t
  let element: AXUIElement
  var selection: Selection
  /// The selected text: the summon's stash when the summon read the selection, else the field's
  /// own `AXSelectedText`.
  var selectedText: String?
}

/// The selection a summon's selection step read, which the write target recorded after it
/// keeps (``WriteTargets/capture(after:)``).
enum SummonSelection {
  /// The summon did not read the selection: the target reads its field's own selected text.
  case unread
  /// Read through Accessibility, or given with the summon; nil when there was none.
  case field(String?)
  /// Copied by a simulated ⌘C where Accessibility showed none (``CopySelection``).
  case copied(String)

  var text: String? {
    switch self {
    case .unread: nil
    case .field(let text): text
    case .copied(let text): text
    }
  }
}

/// Records write targets at summon time (``SummonStep/captureTarget``) and hands them to
/// `text.write` by the opaque id the page received with `shortcut.command`. At most
/// ``capacity`` targets are kept, each for ``lifetime``; the oldest goes first.
final class WriteTargets {
  static let capacity = 16
  static let lifetime: Duration = .seconds(15 * 60)

  private struct Entry {
    let id: String
    let target: WriteTarget
    let recordedAt: ContinuousClock.Instant
  }

  private var entries: [Entry] = []

  /// Reads and records the frontmost app's focused field. Nothing is recorded without
  /// Accessibility (no prompt: the selection step asks), while Atd itself is frontmost, for a
  /// password field, or when the read times out. The target keeps what this summon's selection
  /// step read (`selection`); when the summon read none, the field's selected text is read here.
  /// The page learns whether the field can take text (``AXWritability``).
  func capture(after selection: SummonSelection) async -> ShortcutCommandEvent.Target? {
    let ownPID = ProcessInfo.processInfo.processIdentifier
    guard SelectionReader.isTrusted,
      let frontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier,
      frontmost != ownPID
    else { return nil }
    let readsText = if case .unread = selection { true } else { false }
    let reader = WriteTargetReader(frontmostPID: frontmost, readsText: readsText)
    guard
      let read = await Deadline.value(
        within: .milliseconds(750), fallback: nil, { reader.read() }),
      read.target.pid != ownPID,
      let app = NSRunningApplication(processIdentifier: read.target.pid),
      let name = Self.displayName(app)
    else { return nil }
    var target = read.target
    switch selection {
    case .unread: break
    case .field(let text): target.selectedText = text
    case .copied(let text):
      target.selectedText = text
      target.selection = .copied
    }
    let id = UUID().uuidString
    purge()
    entries.append(Entry(id: id, target: target, recordedAt: .now))
    if entries.count > Self.capacity { entries.removeFirst(entries.count - Self.capacity) }
    return ShortcutCommandEvent.Target(id: id, app: name, writable: read.writable)
  }

  /// The target recorded under `id`, unless it expired.
  func target(_ id: String) -> WriteTarget? {
    purge()
    return entries.first { $0.id == id }?.target
  }

  private func purge() {
    let oldest = ContinuousClock.now - Self.lifetime
    entries.removeAll { $0.recordedAt < oldest }
  }

  /// The app's name for labels, within the contract's 255 UTF-16 units.
  private static func displayName(_ app: NSRunningApplication) -> String? {
    guard var name = app.localizedName ?? app.bundleIdentifier else { return nil }
    while name.utf16.count > 255 { name.removeLast() }
    return name.isEmpty ? nil : name
  }
}

/// Reads the focused field the way ``SelectionReader`` finds it: the system-wide focused element,
/// else the frontmost app's (Electron apps answer only there), each message bounded by the same
/// 250 ms timeout. A timeout while finding or reading the field records nothing; one while
/// asking whether it can take text only leaves that undecided (``AXWritability``). Blocking;
/// call it off the main thread.
nonisolated struct WriteTargetReader: Sendable {
  /// The field, and whether it can take text.
  struct Read: Sendable {
    var target: WriteTarget
    let writable: Bool
  }

  let frontmostPID: pid_t
  /// Read `AXSelectedText` too, when the summon did not read the selection itself.
  let readsText: Bool

  func read() -> Read? {
    do throws(AXFieldError) {
      let timeout = SelectionReader.messagingTimeout
      let systemWide = AXUIElementCreateSystemWide()
      AXUIElementSetMessagingTimeout(systemWide, timeout)
      var focused: AXUIElement? = try? AXField.copy(systemWide, kAXFocusedUIElementAttribute)
      if focused == nil {
        let app = AXUIElementCreateApplication(frontmostPID)
        AXUIElementSetMessagingTimeout(app, timeout)
        focused = try AXField.copy(app, kAXFocusedUIElementAttribute)
      }
      var pid: pid_t = 0
      guard let focused, AXUIElementGetPid(focused, &pid) == .success else { return nil }
      AXUIElementSetMessagingTimeout(focused, timeout)
      guard try !AXField.isSecure(focused) else { return nil }
      let range = try AXField.selectedRange(of: focused)
      let text: String? = readsText ? try AXField.copy(focused, kAXSelectedTextAttribute) : nil
      let target = WriteTarget(
        pid: pid, element: focused, selection: .field(range: range), selectedText: text)
      return Read(target: target, writable: AXWritability.writable(focused))
    } catch {
      return nil
    }
  }
}
