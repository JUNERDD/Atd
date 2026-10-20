import AIComputerDriverKit
import ApplicationServices
import CoreGraphics
import Foundation

/// Gives the target window the app's key status for the duration of one keyboard/click primitive
/// WITHOUT activating the app or raising a window, then hands key back to the window that held
/// key focus and verifies it (plan I2). The focus and make-key records are the yabai/Cua recipe
/// (MIT); `SLPSSetFrontProcess` is deliberately never called, which is what keeps the user's
/// front app and Chromium's user-activation gate intact. The records change only the target
/// app's own key window, never WindowServer's key focus.
///
/// Who holds key is read from WindowServer's key-focus process, not the front process: a
/// non-activating panel (Atd's own task panel among them) takes key focus while the app behind
/// it stays frontmost and keeps its window in `AXFocusedWindow`, though that window is not key.
enum WindowKeyScope {
  private static let settle: TimeInterval = 0.08

  /// Open a key scope around `body`. Returns a report of what happened (confirmed, returned,
  /// user window restored). Throws `capabilityUnavailable` when the PSN cannot be resolved, and
  /// `noRoute` when the target could not be confirmed as key (so no key ever left the scope).
  /// A target window that already holds key focus needs no scope: `body` runs as it is, since
  /// opening one would take key from that window and give it back.
  static func run(
    targetPid: pid_t, targetWindowId: CGWindowID, _ body: () throws -> Void
  ) throws -> DriverKeyScopeReport {
    let frontPid = WindowServerQueries.frontProcessPID()
    // Without the key-focus symbol the front process stands in, blind to a panel's key focus.
    let keyFocusPid = WindowServerQueries.keyFocusProcessPID() ?? frontPid
    if keyFocusPid == targetPid, focusedWindowId(targetPid) == targetWindowId {
      try body()
      return DriverKeyScopeReport(used: false)
    }
    let spi = PrivateSymbols.shared
    guard let post = spi.postEventRecord,
      let targetPSN = WindowServerQueries.processSerialNumber(
        windowId: targetWindowId, pid: targetPid)
    else {
      throw DriverFailure(code: .capabilityUnavailable, message: "key scope PSN unavailable")
    }

    // A target in front whose key focus another process holds stays active, and AppKit then
    // makes none of its windows key on a mouse-down: the scope deactivates it first and, when it
    // closes, activates it again without a key window, the state it was found in.
    let reactivate = frontPid == targetPid && keyFocusPid != targetPid
    // The person's key window is the focused window of the process holding key focus.
    let previousKeyWindow = keyFocusPid.flatMap(focusedWindowId)

    if reactivate {
      postRecord(post, psn: targetPSN, record: focusRecord(targetWindowId, focused: false))
      Thread.sleep(forTimeInterval: settle)
    }
    postRecord(post, psn: targetPSN, record: focusRecord(targetWindowId, focused: true))
    Thread.sleep(forTimeInterval: settle)
    for kind in [UInt8(0x01), UInt8(0x02)] {
      postRecord(post, psn: targetPSN, record: makeKeyRecord(targetWindowId, eventKind: kind))
    }
    Thread.sleep(forTimeInterval: settle)

    // Only the app's own account can show the records took: WindowServer's key focus does not
    // move, and Chromium windows report `AXFocused` false even while key. When the app already
    // named the target here (it had lost key focus to another process, not its focused window),
    // this proves the records addressed the right window, not that it became key.
    let confirmed = focusedWindowId(targetPid) == targetWindowId
    guard confirmed else {
      // Release the half-open scope before refusing so the target is not left key.
      close(
        post, targetPSN: targetPSN, targetWindowId: targetWindowId, reactivate: reactivate,
        previousPid: keyFocusPid, previousKeyWindow: previousKeyWindow)
      throw DriverFailure(
        code: .noRoute, message: "target window could not be confirmed as the app's key window")
    }

    // The scope is always closed, even when the primitive throws, and closed BEFORE the person's
    // window is re-read: restoration can only be checked after the reverse records are posted.
    let outcome = Result(catching: body)
    let handedBack = close(
      post, targetPSN: targetPSN, targetWindowId: targetWindowId, reactivate: reactivate,
      previousPid: keyFocusPid, previousKeyWindow: previousKeyWindow)
    if case .failure(let error) = outcome { throw error }

    guard let previousKeyWindow else {
      // The person had no key window: there is nothing to hand back, so the scope counts as
      // returned, and there is no window whose restoration could be checked.
      return DriverKeyScopeReport(
        used: true, confirmed: true, returned: true, userWindowRestored: nil)
    }
    Thread.sleep(forTimeInterval: settle)
    let restored = keyFocusPid.flatMap(focusedWindowId) == previousKeyWindow
    return DriverKeyScopeReport(
      used: true, confirmed: true, returned: handedBack, userWindowRestored: restored)
  }

  /// Reverse the scope: defocus the target (and with `reactivate` activate it again, without a
  /// key window), then re-focus the user's previous key window. Returns whether the person's
  /// previous key window was addressed with the re-focus record (false when there was none, or
  /// its process could not be resolved).
  @discardableResult
  private static func close(
    _ post: PrivateSymbols.PostEventRecordFn, targetPSN: [UInt8], targetWindowId: CGWindowID,
    reactivate: Bool, previousPid: pid_t?, previousKeyWindow: CGWindowID?
  ) -> Bool {
    postRecord(post, psn: targetPSN, record: focusRecord(targetWindowId, focused: false))
    if reactivate {
      // Posted at once, the two records cancel out in AppKit and leave the window key.
      Thread.sleep(forTimeInterval: settle)
      postRecord(post, psn: targetPSN, record: focusRecord(targetWindowId, focused: true))
    }
    guard let previousPid, let previousKeyWindow,
      let previousPSN = WindowServerQueries.processSerialNumber(
        windowId: previousKeyWindow, pid: previousPid)
    else { return false }
    postRecord(post, psn: previousPSN, record: focusRecord(previousKeyWindow, focused: true))
    return true
  }

  private static func focusedWindowId(_ pid: pid_t) -> CGWindowID? {
    let app = AXBindings.application(pid: pid)
    guard let window = AXBindings.copyElement(app, kAXFocusedWindowAttribute as String) else {
      return nil
    }
    return WindowServerQueries.windowId(for: window)
  }

  private static func postRecord(
    _ post: PrivateSymbols.PostEventRecordFn, psn: [UInt8], record: [UInt8]
  ) {
    _ = psn.withUnsafeBytes { psnBytes in
      record.withUnsafeBufferPointer { recordBytes in
        post(psnBytes.baseAddress, recordBytes.baseAddress)
      }
    }
  }

  /// The 248-byte focus/defocus record: `[0x04]=0xF8`, `[0x08]=0x0D`, window id little-endian at
  /// `0x3C..0x3F`, direction at `[0x8A]` (1 focus, 2 defocus).
  private static func focusRecord(_ windowId: CGWindowID, focused: Bool) -> [UInt8] {
    var record = [UInt8](repeating: 0, count: 0xF8)
    record[0x04] = 0xF8
    record[0x08] = 0x0D
    writeWindowId(&record, windowId)
    record[0x8A] = focused ? 0x01 : 0x02
    return record
  }

  /// The yabai make-key-window record: `[0x3A]=0x10`, bytes `0x20..0x30` set to 0xFF, event kind
  /// at `[0x08]` (the 0x01/0x02 pair).
  private static func makeKeyRecord(_ windowId: CGWindowID, eventKind: UInt8) -> [UInt8] {
    var record = [UInt8](repeating: 0, count: 0xF8)
    record[0x04] = 0xF8
    record[0x08] = eventKind
    record[0x3A] = 0x10
    writeWindowId(&record, windowId)
    for index in 0x20..<0x30 { record[index] = 0xFF }
    return record
  }

  private static func writeWindowId(_ record: inout [UInt8], _ windowId: CGWindowID) {
    record[0x3C] = UInt8(truncatingIfNeeded: windowId)
    record[0x3D] = UInt8(truncatingIfNeeded: windowId >> 8)
    record[0x3E] = UInt8(truncatingIfNeeded: windowId >> 16)
    record[0x3F] = UInt8(truncatingIfNeeded: windowId >> 24)
  }
}
