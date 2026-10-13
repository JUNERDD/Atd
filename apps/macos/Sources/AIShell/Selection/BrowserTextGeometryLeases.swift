import AICore
import AppKit
import ApplicationServices

/// Arms Chromium browsers for the typing trace (``BrowserTextGeometry``): a command summoned from
/// one turns the browser's complete accessibility on (`AXEnhancedUserInterface`) so that its
/// fields answer character bounds by the time the answer is typed, and a write, the lease running
/// out or the shell quitting turns it off again. The Accessibility messages run off the main
/// thread, each bounded by the messaging timeout; a browser that does not answer stays as it is.
final class BrowserTextGeometryLeases {
  private nonisolated static let attribute = "AXEnhancedUserInterface"

  private var leases = BrowserTextGeometry.Leases<ContinuousClock.Instant>()
  private var sweep: Task<Void, Never>?
  private var quitObserver: NSObjectProtocol?

  init() {
    quitObserver = NotificationCenter.default.addObserver(
      forName: NSApplication.willTerminateNotification, object: nil, queue: .main
    ) { [weak self] _ in MainActor.assumeIsolated { self?.releaseAll() } }
  }

  /// A command was summoned from `app`: arms it until the lease runs out, or keeps it armed that
  /// long; nothing for an app ``BrowserTextGeometry/arms(_:)`` leaves alone.
  func arm(_ app: NSRunningApplication) {
    guard BrowserTextGeometry.arms(app.bundleIdentifier) else { return }
    let pid = app.processIdentifier
    if leases.request(pid, until: .now + BrowserTextGeometry.lease) {
      Task {
        let turnedOn = await Task.detached(priority: .utility) { Self.turnOn(pid) }.value
        if turnedOn, !leases.confirm(pid) { Self.turnOffDetached(pid) }
        scheduleSweep()
      }
    }
    scheduleSweep()
  }

  /// A write into `pid`'s field ended: its lease ends shortly, after the trace's last reads.
  func wrote(_ pid: pid_t) {
    leases.shorten(pid, to: .now + BrowserTextGeometry.linger)
    scheduleSweep()
  }

  private func scheduleSweep() {
    sweep?.cancel()
    guard let next = leases.nextExpiry else { return }
    sweep = Task {
      try? await Task.sleep(until: next)
      guard !Task.isCancelled else { return }
      for pid in leases.expire(at: .now) { Self.turnOffDetached(pid) }
      scheduleSweep()
    }
  }

  /// Turns every armed browser back, waiting for each, as the shell quits.
  private func releaseAll() {
    sweep?.cancel()
    for pid in leases.expireAll() { Self.set(pid, on: false) }
  }

  /// Turns `pid`'s complete accessibility on unless it was on already (VoiceOver, another
  /// assistive app): true only when this call turned it on. Blocking.
  private nonisolated static func turnOn(_ pid: pid_t) -> Bool {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, SelectionReader.messagingTimeout)
    var value: CFTypeRef?
    let read = AXUIElementCopyAttributeValue(app, attribute as CFString, &value)
    if read == .success, (value as? Bool) == true { return false }
    return set(pid, on: true)
  }

  private nonisolated static func turnOffDetached(_ pid: pid_t) {
    Task.detached(priority: .utility) { _ = set(pid, on: false) }
  }

  /// Sets `pid`'s complete accessibility. Chromium answers the set with "not implemented" yet
  /// takes it, so only a vanished app or a timeout counts as not set. Blocking.
  @discardableResult
  private nonisolated static func set(_ pid: pid_t, on: Bool) -> Bool {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, SelectionReader.messagingTimeout)
    let error = AXUIElementSetAttributeValue(
      app, attribute as CFString, (on ? kCFBooleanTrue : kCFBooleanFalse) as CFTypeRef)
    return error != .invalidUIElement && error != .cannotComplete
  }
}
