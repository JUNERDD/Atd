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
  static func raise(
    pid: pid_t, windowId: Int, diagnostics: ForegroundDiagnostics? = nil, stage: String = "restore",
    restoration: ForegroundRestorationDiagnostics? = nil
  ) async -> Bool {
    let before = diagnostics.map { _ in ForegroundWindowSnapshot.read().summary(target: pid) }
    let result = await NativeTargetProbe.detached {
      ForegroundAX.raise(pid: pid, windowId: windowId)
    }
    restoration?.raise = result
    if let diagnostics, let before {
      diagnostics.raised(
        stage: stage, windowId: windowId, succeeded: result.succeeded, before: before,
        after: ForegroundWindowSnapshot.read().summary(target: pid))
    }
    return result.succeeded
  }

  /// Whether `pid`'s focused window (`AXFocusedWindow`), where its keys go while it is the active
  /// app, is window `windowId`.
  static func hasKeyFocus(pid: pid_t, windowId: Int) async -> Bool {
    await NativeTargetProbe.detached { NativeSurfaceProbe.focusedWindowId(pid: pid) } == windowId
  }

  /// Uses macOS mouse-down hit-testing, including its per-point transparency and mouse-event
  /// handling. No window is excluded by owner or layer; unresolved hits fail closed.
  static func hit(
    _ point: CGPoint, windowId: Int, pid: pid_t, diagnostics: ForegroundDiagnostics
  ) -> ForegroundHitTest.Verdict {
    let hitWindowId = NSScreen.screens.first.map { screen in
      NSWindow.windowNumber(
        at: CaptureCoordinates.flip(point, primaryHeight: screen.frame.height),
        belowWindowWithWindowNumber: 0)
    }
    let scene = ForegroundWindowSnapshot.read()
    let assessment = ForegroundHitTest.assess(
      point, target: windowId, pid: pid, windows: scene.windows.map(\.hitWindow),
      hitWindowId: hitWindowId)
    diagnostics.assessed(
      assessment, point: point, target: windowId, scene: scene, hitWindowId: hitWindowId)
    return assessment.verdict
  }

  /// Whether window `windowId` is on screen, so on a Space one of the displays shows.
  static func isOnScreen(_ windowId: Int) -> Bool {
    ForegroundWindowSnapshot.read().windows.contains { $0.number == windowId }
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

  enum RaiseResult: Encodable, Sendable {
    case windowUnavailable
    case attempted(mainError: Int32, raiseError: Int32)

    var succeeded: Bool {
      if case .attempted(_, let error) = self { return error == AXError.success.rawValue }
      return false
    }
  }

  /// Asks app `pid` to become the active app (`AXFrontmost`).
  static func setFrontmost(pid: pid_t) -> Bool {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, timeout)
    return AXUIElementSetAttributeValue(app, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
      == .success
  }

  /// Makes window `windowId` of `pid` the app's main window and raises it.
  static func raise(pid: pid_t, windowId: Int) -> RaiseResult {
    guard let window = NativeSurfaceProbe.axWindow(pid: pid, windowId: windowId, timeout: timeout)
    else { return .windowUnavailable }
    let main = AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
    let raised = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    return .attempted(mainError: main.rawValue, raiseError: raised.rawValue)
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
