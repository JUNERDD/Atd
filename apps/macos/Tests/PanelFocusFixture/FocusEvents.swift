import AppKit
import ApplicationServices

@MainActor
enum FocusEvents {
  /// HID posting enters WindowServer's normal targeting/activation path. Posting to a pid or
  /// NSApplication's event queue would bypass the very behavior this fixture measures.
  static func click(_ point: CGPoint) async throws {
    for type in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
      guard
        let event = CGEvent(
          mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left)
      else { throw FocusError.failed("Cannot create mouse event") }
      event.setIntegerValueField(.mouseEventClickState, value: 1)
      event.post(tap: .cghidEventTap)
      try await Task.sleep(for: .milliseconds(25))
    }
  }

  static func typeCharacter() throws {
    for down in [true, false] {
      guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 7, keyDown: down)
      else { throw FocusError.failed("Cannot create key event") }
      event.keyboardSetUnicodeString(stringLength: 1, unicodeString: [0x78])
      event.post(tap: .cghidEventTap)
    }
  }

  static func screenPoint(view: NSView, point: CGPoint) throws -> CGPoint {
    guard let window = view.window, let screen = NSScreen.screens.first else {
      throw FocusError.failed("No window or screen")
    }
    let native = window.convertPoint(toScreen: view.convert(point, to: nil))
    return CGPoint(x: native.x, y: screen.frame.maxY - native.y)
  }

  static func describe(_ window: NSWindow) -> String {
    let windows =
      CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID)
      as? [[String: Any]] ?? []
    let owned = windows.filter { ($0[kCGWindowOwnerPID as String] as? Int32) == getpid() }
      .map { item in
        "number=\(item[kCGWindowNumber as String] ?? "?"),"
          + "bounds=\(item[kCGWindowBounds as String] ?? "?")"
      }
    return "pid=\(getpid()), frame=\(window.frame), visible=\(window.isVisible), "
      + "onActiveSpace=\(window.isOnActiveSpace), ownedCG=\(owned)"
  }

  static func isOnScreen(_ window: NSWindow) -> Bool {
    let windows =
      CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID)
      as? [[String: Any]] ?? []
    return windows.contains {
      ($0[kCGWindowOwnerPID as String] as? Int32) == getpid()
        && ($0[kCGWindowNumber as String] as? Int) == window.windowNumber
    }
  }

  static func recordCoveringWindow(_ window: NSWindow, at point: CGPoint) {
    let windows =
      CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], 0)
      as? [[String: Any]] ?? []
    for item in windows {
      guard (item[kCGWindowAlpha as String] as? Double ?? 1) > 0,
        let bounds = item[kCGWindowBounds as String] as? [String: Double],
        let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), rect.contains(point)
      else { continue }
      // Unrelated titles and content are never read; only routing metadata is retained.
      let owned =
        (item[kCGWindowOwnerPID as String] as? Int32) == getpid()
        && (item[kCGWindowNumber as String] as? Int) == window.windowNumber
      if !owned {
        let metadata = [kCGWindowOwnerPID, kCGWindowNumber, kCGWindowLayer, kCGWindowBounds]
          .map { "\($0)=\(item[$0 as String] ?? "?")" }.joined(separator: ",")
        FileHandle.standardError.write(Data("obscuring-window \(metadata)\n".utf8))
      }
      return
    }
  }

  static func wait(
    seconds: Double = 3, until condition: @MainActor () async throws -> Bool
  ) async throws -> Bool {
    let deadline = ContinuousClock.now + .seconds(seconds)
    while ContinuousClock.now < deadline {
      if try await condition() { return true }
      try await Task.sleep(for: .milliseconds(20))
    }
    return false
  }
}

/// A separate fixture-only foreground application. It reports counters, never text, so the
/// parent verifies genuine delivery to the peer before asking the panel to take the keyboard.
@MainActor
final class FocusPeer: NSObject, NSTextFieldDelegate {
  private let window: NSWindow
  private let field = NSTextField()
  private let snapshotURL: URL
  private var parentWatch: Timer?
  private var published = false

  init(snapshotURL: URL) {
    self.snapshotURL = snapshotURL
    let work = NSScreen.main?.visibleFrame ?? CGRect(x: 0, y: 0, width: 1200, height: 800)
    window = NSWindow(
      contentRect: CGRect(x: work.minX + 20, y: work.minY + 70, width: 300, height: 200),
      styleMask: [.titled, .closable], backing: .buffered, defer: false)
    super.init()
    window.title = "Atd focus test peer"
    window.isReleasedWhenClosed = false
    field.frame = CGRect(x: 20, y: 80, width: 260, height: 35)
    field.placeholderString = "Fixture keyboard target"
    field.delegate = self
    window.contentView?.addSubview(field)
    window.makeKeyAndOrderFront(nil)
    NSApp.activate()
    FileHandle.standardError.write(Data("peer \(FocusEvents.describe(window))\n".utf8))
    let parent = getppid()
    parentWatch = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
      if getppid() != parent { exit(0) }
      MainActor.assumeIsolated { self?.publish() }
    }
  }

  func controlTextDidChange(_ notification: Notification) { publish() }

  private func publish() {
    guard published || (NSApp.isActive && window.isKeyWindow && FocusEvents.isOnScreen(window))
    else { return }
    published = true
    do {
      let point = try FocusEvents.screenPoint(
        view: field, point: CGPoint(x: field.bounds.midX, y: field.bounds.midY))
      let state = FocusPeerState(
        pid: getpid(), x: point.x, y: point.y, active: NSApp.isActive,
        key: window.isKeyWindow, characters: field.stringValue.count)
      try JSONEncoder().encode(state).write(to: snapshotURL, options: .atomic)
    } catch {
      FileHandle.standardError.write(Data("Focus peer snapshot failed: \(error)\n".utf8))
    }
  }
}
