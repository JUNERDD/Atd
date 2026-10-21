import AICore
import AppKit
import ApplicationServices

/// Bringing an app and one of its windows to the front for a foreground step, and the person's back
/// afterwards (R4.4, R4.6), with the checks that say it worked.
///
/// Activation is cooperative on current macOS: an app that is not active itself may have its
/// request to activate another declined (`NSRunningApplication.activate`). So Atd yields its own
/// activation when it has it and asks through the public API; when that does not bring the app to
/// the front in a moment, it asks through accessibility (`AXFrontmost`), the way an assistive app
/// switches apps. Either way it checks the frontmost app rather than trusting the call, and a step
/// whose target never comes to the front is refused, never retried another way. Every
/// accessibility message here is bounded by a short timeout, so a hung app cannot hold its window
/// in front of the person.
enum ForegroundActivation {
  /// How long an app gets to come to the front, or to show or hide.
  static let limit: Duration = .seconds(1)
  /// How long the public request gets before accessibility is asked as well.
  private static let publicTry: Duration = .milliseconds(300)
  private static let poll: Duration = .milliseconds(20)

  /// Makes `app` the active app; true once it is frontmost, within ``limit`` and before `deadline`.
  static func activate(_ app: NSRunningApplication, before deadline: ContinuousClock.Instant) async
    -> Bool
  {
    let pid = app.processIdentifier
    if isFront(pid) { return true }
    guard !app.isTerminated else { return false }
    let end = min(.now + limit, deadline)
    if pid == ProcessInfo.processInfo.processIdentifier {
      NSApp.activate()
    } else if NSApp.isActive {
      NSApp.yieldActivation(to: app)
      _ = app.activate(from: .current, options: [])
    } else {
      _ = app.activate(options: [])
    }
    if await becomesFront(pid, before: min(end, .now + publicTry)) { return true }
    _ = await NativeTargetProbe.detached { ForegroundAX.setFrontmost(pid: pid) }
    return await becomesFront(pid, before: end)
  }

  /// Shows `app`, which the person hid (⌘H), for a step on its window `windowId`; true once that
  /// window is on screen, within ``limit`` and before `deadline`.
  static func show(
    _ app: NSRunningApplication, windowId: Int, before deadline: ContinuousClock.Instant
  )
    async -> Bool
  {
    guard app.unhide() else { return false }
    let end = min(.now + limit, deadline)
    while app.isHidden || !isOnScreen(windowId) {
      guard ContinuousClock.now < end else { return false }
      try? await Task.sleep(for: poll)
    }
    return true
  }

  /// Makes window `windowId` of `pid` its app's main window and raises it, through accessibility;
  /// false when the window is not found or refuses.
  static func raise(pid: pid_t, windowId: Int) async -> Bool {
    await NativeTargetProbe.detached { ForegroundAX.raise(pid: pid, windowId: windowId) }
  }

  /// Whether `pid`'s focused window (`AXFocusedWindow`), where its keys go while it is the active
  /// app, is window `windowId`.
  static func hasKeyFocus(pid: pid_t, windowId: Int) async -> Bool {
    await NativeTargetProbe.detached { NativeSurfaceProbe.focusedWindowId(pid: pid) } == windowId
  }

  /// Where input at `point` for window `windowId` of `pid` lands now (``ForegroundHitTest``),
  /// with Atd's own windows that let clicks through set aside.
  static func hit(_ point: CGPoint, windowId: Int, pid: pid_t) -> ForegroundHitTest.Verdict {
    let passThrough = Set(
      NSApp.windows.filter { $0.isVisible && $0.ignoresMouseEvents }.map(\.windowNumber))
    return ForegroundHitTest.verdict(
      point, target: windowId, pid: pid, windows: onScreenWindows(), passThrough: passThrough)
  }

  /// Whether window `windowId` is on screen, so on a Space one of the displays shows.
  static func isOnScreen(_ windowId: Int) -> Bool {
    onScreenWindows().contains { $0.number == windowId }
  }

  /// Asks the target app to take in what was sent before the person's app comes back, or before
  /// keys follow a click: an accessibility read answers only once the app's main thread, which
  /// handles its events, gets to it.
  static func drain(pid: pid_t) async {
    _ = await NativeTargetProbe.detached { ForegroundAX.ping(pid: pid) }
  }

  /// The app's front window and main window now, for the evidence of what a step changed in its
  /// own window order.
  static func order(of pid: pid_t) async -> ForegroundWindowOrder {
    let list =
      CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
      as? [[String: Any]] ?? []
    let front = list.first {
      ($0[kCGWindowOwnerPID as String] as? pid_t) == pid
        && ($0[kCGWindowLayer as String] as? Int) == 0
    }.flatMap { $0[kCGWindowNumber as String] as? Int }
    let main = await NativeTargetProbe.detached { NativeSurfaceProbe.mainWindowId(pid: pid) }
    return ForegroundWindowOrder(front: front, main: main)
  }

  private static func isFront(_ pid: pid_t) -> Bool {
    NSWorkspace.shared.frontmostApplication?.processIdentifier == pid
  }

  private static func becomesFront(_ pid: pid_t, before end: ContinuousClock.Instant) async
    -> Bool
  {
    while !isFront(pid) {
      guard ContinuousClock.now < end else { return false }
      try? await Task.sleep(for: poll)
    }
    return true
  }

  /// The windows on screen front to back, every layer, as the window server lists them.
  private static func onScreenWindows() -> [ForegroundHitTest.Window] {
    let list =
      CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
      as? [[String: Any]] ?? []
    return list.compactMap { info in
      guard let number = info[kCGWindowNumber as String] as? Int,
        let pid = info[kCGWindowOwnerPID as String] as? pid_t,
        let frame = info[kCGWindowBounds as String] as? NSDictionary,
        let bounds = CGRect(dictionaryRepresentation: frame as CFDictionary)
      else { return nil }
      let alpha = info[kCGWindowAlpha as String] as? Double ?? 1
      return ForegroundHitTest.Window(number: number, pid: pid, bounds: bounds, visible: alpha > 0)
    }
  }
}

/// An app's front window and main window, by window number, before and after a foreground step.
struct ForegroundWindowOrder: Equatable {
  let front: Int?
  let main: Int?

  /// Whether the step left `window` as the app's front or main window, which it was not before.
  func moved(_ window: Int, to after: ForegroundWindowOrder) -> Bool {
    (front != window && after.front == window) || (main != window && after.main == window)
  }
}

/// The accessibility messages of a foreground step, each bounded by a short messaging timeout set
/// on every element it reads or acts on. Blocking: run them off the main actor
/// (``NativeTargetProbe/detached(_:)``).
nonisolated enum ForegroundAX {
  static let timeout: Float = 0.25

  /// Asks app `pid` to become the active app (`AXFrontmost`).
  static func setFrontmost(pid: pid_t) -> Bool {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, timeout)
    return AXUIElementSetAttributeValue(app, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
      == .success
  }

  /// Makes window `windowId` of `pid` the app's main window and raises it.
  static func raise(pid: pid_t, windowId: Int) -> Bool {
    guard let window = NativeSurfaceProbe.axWindow(pid: pid, windowId: windowId, timeout: timeout)
    else { return false }
    _ = AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
    return AXUIElementPerformAction(window, kAXRaiseAction as CFString) == .success
  }

  /// A read of app `pid` that returns once its main thread answered, or the timeout passed.
  static func ping(pid: pid_t) -> Bool {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, timeout)
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &value)
      == .success
  }
}
