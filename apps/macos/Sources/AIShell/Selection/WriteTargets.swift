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
    /// Copy returned text, but neither AX nor its clipboard representation identifies the
    /// selection as characters. Replacement is a paste; "after" needs a chosen destination.
    case untyped
    /// A grid selection; nil when only the copied HTML exposes its tabular nature. There is
    /// no text caret to follow, and inserting "after" cells has no portable meaning.
    case cells(CellSelection?)
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
  case copied(CopySelection.Content)

  var text: String? {
    switch self {
    case .unread: nil
    case .field(let text): text
    case .copied(let content): content.text
    }
  }
}

/// Records write targets at summon time (``SummonStep/captureTarget``) and hands them to
/// `text.write` by the opaque id the page received with `shortcut.command`. At most
/// ``capacity`` targets are kept, each for ``lifetime``; the oldest goes first. While the typing
/// animation is on (``animatesTyping``), a writable target in a Chromium browser also arms the
/// browser for the typing trace (``geometry``) from the summon on, since its character bounds come
/// about two seconds after it is asked for them.
final class WriteTargets {
  static let capacity = 16
  static let lifetime: Duration = .seconds(15 * 60)

  private struct Entry {
    let id: String
    let target: WriteTarget
    let recordedAt: ContinuousClock.Instant
  }

  private var entries: [Entry] = []
  private let geometry = BrowserTextGeometryLeases()
  /// Whether answers are typed with their animation, as the page's last `typing.set` said; off
  /// until it says, so no browser is armed for a trace the settings may not want.
  var animatesTyping = false
  /// Whether answers are typed rather than pasted at once, as the page's last `typing.set`
  /// said; the shell's own writes (the answer card's Insert and Replace) follow it.
  var typesAnswers = false

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
    case .copied(let content):
      target.selectedText = content.text
      if case .cells = target.selection { break }
      if content.containsCells {
        target.selection = .cells(nil)
      } else {
        let textSurface = SelectionSurface(target.element)
        target.selection = content.hasHTML || textSurface.nativeText ? .copied : .untyped
      }
    }
    let id = UUID().uuidString
    purge()
    entries.append(Entry(id: id, target: target, recordedAt: .now))
    if entries.count > Self.capacity { entries.removeFirst(entries.count - Self.capacity) }
    if read.writable, animatesTyping { geometry.arm(app) }
    let kind: ShortcutCommandEvent.Target.SelectionKind =
      switch target.selection {
      case .cells: .cells
      case .untyped: .unknown
      case .field, .copied: .text
      }
    return ShortcutCommandEvent.Target(
      id: id, app: name, writable: read.writable, selectionKind: kind)
  }

  /// The target recorded under `id`, unless it expired.
  func target(_ id: String) -> WriteTarget? {
    purge()
    return entries.first { $0.id == id }?.target
  }

  /// A write with the typing animation into `target` starts: its browser is armed again if its
  /// lease ran out (late, but the trace takes what arrives) and stays armed through the write.
  func writing(_ target: WriteTarget) {
    if let app = NSRunningApplication(processIdentifier: target.pid) { geometry.arm(app) }
  }

  /// The write into `target` ended: its browser is let go after the trace's last reads.
  func wrote(_ target: WriteTarget) {
    geometry.wrote(target.pid)
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

  /// How long the capture waits for a browser woken now to build the tree its focus is in.
  static let webContentWait: Duration = .milliseconds(450)

  /// The app's focused element. Chromium and Electron report none until an assistive tool asked
  /// them something, then build their tree asynchronously: an app with no focus to report is
  /// woken (``SelectionPresence/wakeWebContent(_:)``, usually already done when the shortcut
  /// fired) and asked again until the tree answers or ``webContentWait`` passes.
  private static func focusedElement(of app: AXUIElement) throws(AXFieldError) -> AXUIElement? {
    if let focused: AXUIElement = try AXField.copy(app, kAXFocusedUIElementAttribute) {
      return focused
    }
    SelectionPresence.wakeWebContent(app)
    let deadline = ContinuousClock.now + webContentWait
    while ContinuousClock.now < deadline {
      Thread.sleep(forTimeInterval: 0.03)
      if let focused: AXUIElement = try AXField.copy(app, kAXFocusedUIElementAttribute) {
        return focused
      }
    }
    return nil
  }

  func read() -> Read? {
    do throws(AXFieldError) {
      let timeout = SelectionReader.messagingTimeout
      let systemWide = AXUIElementCreateSystemWide()
      AXUIElementSetMessagingTimeout(systemWide, timeout)
      var focused: AXUIElement? = try? AXField.copy(systemWide, kAXFocusedUIElementAttribute)
      if focused == nil {
        let app = AXUIElementCreateApplication(frontmostPID)
        AXUIElementSetMessagingTimeout(app, timeout)
        focused = try Self.focusedElement(of: app)
      }
      var pid: pid_t = 0
      guard let focused, AXUIElementGetPid(focused, &pid) == .success else { return nil }
      AXUIElementSetMessagingTimeout(focused, timeout)
      guard try !AXField.isSecure(focused) else { return nil }
      let surface = SelectionSurface(focused)
      // An unadvertised range is not a caret contract. Opaque editors keep their own selection.
      let range = surface.advertisesTextRange ? try AXField.selectedRange(of: focused) : nil
      let text: String? = readsText ? try AXField.copy(focused, kAXSelectedTextAttribute) : nil
      let table = surface.selectedCellContainer()
      let cells = table.flatMap(CellSelection.init)
      let target = WriteTarget(
        pid: pid, element: focused,
        selection: table == nil ? .field(range: range) : .cells(cells), selectedText: text)
      return Read(
        target: target, writable: (table == nil || cells != nil) && AXWritability.writable(focused))
    } catch {
      return nil
    }
  }
}
