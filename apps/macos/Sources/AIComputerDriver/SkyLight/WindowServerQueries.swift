import AIComputerDriverKit
import ApplicationServices
import CoreGraphics
import Foundation

/// Read-only WindowServer facts the route planner and disturbance checks need, built on the
/// private symbols plus the public `CGWindowList`. None of these activate, raise, move, or
/// capture anything. PSN resolution and the Space queries follow the open-computer-use and Cua
/// (MIT) recipes; see PrivateSymbols.swift for the attribution boundary.
enum WindowServerQueries {
  private static var spi: PrivateSymbols { .shared }

  /// The 8-byte process serial number that owns `windowId`, via the SkyLight owner path with a
  /// `GetProcessForPID` fallback. Needed to address focus/key records to the target.
  static func processSerialNumber(windowId: CGWindowID, pid: pid_t) -> [UInt8]? {
    var psn = [UInt8](repeating: 0, count: 8)
    if let owner = spi.getWindowOwner, let connPSN = spi.getConnectionPSN,
      let main = spi.mainConnection
    {
      var ownerCID: UInt32 = 0
      if owner(main(), windowId, &ownerCID) == 0, ownerCID != 0 {
        let ok = psn.withUnsafeMutableBytes { connPSN(ownerCID, $0.baseAddress) == 0 }
        if ok { return psn }
      }
    }
    if let byPID = spi.getProcessForPID {
      let ok = psn.withUnsafeMutableBytes { byPID(pid, $0.baseAddress) == 0 }
      if ok { return psn }
    }
    return nil
  }

  /// The pid WindowServer has frontmost right now, without waiting on an AppKit run loop.
  static func frontProcessPID() -> pid_t? {
    guard let getFront = spi.getFrontProcess, let toPID = spi.getProcessPID else { return nil }
    var psn = [UInt8](repeating: 0, count: 8)
    let gotFront = psn.withUnsafeMutableBytes { getFront($0.baseAddress) == 0 }
    guard gotFront, psn.contains(where: { $0 != 0 }) else { return nil }
    var pid: pid_t = 0
    let ok = psn.withUnsafeBytes { toPID($0.baseAddress, &pid) == 0 }
    return ok && pid > 0 ? pid : nil
  }

  /// The active Space id of the main connection, or nil when the symbol is absent.
  static func activeSpace() -> UInt64? {
    guard let main = spi.mainConnection, let active = spi.getActiveSpace else { return nil }
    let id = active(main())
    return id != 0 ? id : nil
  }

  /// Every Space id that contains `windowId`; nil when unknown. Space membership must be queried
  /// one window at a time: the SPI returns the union for its input list, not a per-window result.
  static func spaces(forWindow windowId: CGWindowID) -> [UInt64]? {
    guard let main = spi.mainConnection, let copy = spi.copySpacesForWindows else { return nil }
    let windows = [NSNumber(value: windowId)] as CFArray
    guard let result = copy(main(), 0x7, windows)?.takeRetainedValue() as? [NSNumber] else {
      return nil
    }
    return result.map(\.uint64Value)
  }

  /// Enable or disable WindowServer occlusion notifications for one window of another process;
  /// returns the previous state. Disabling pins the target's `occlusionState` at its current
  /// value. nil when the symbol is absent or the call failed.
  static func setOcclusionNotificationsEnabled(_ enabled: Bool, windowId: CGWindowID) -> Bool? {
    guard let main = spi.mainConnection, let enable = spi.enableOcclusion else { return nil }
    var previous: UInt8 = 0
    let status = enable(main(), windowId, enabled ? 1 : 0, &previous)
    guard status == 0 else {
      spi.latchUnavailable(DriverCapabilityName.occlusionKeepAlive)
      return nil
    }
    return previous != 0
  }

  /// One window's backing-store image (retina), valid even when covered or on another Space.
  /// Ignores the global clip shape and asks for best resolution; nil when unavailable.
  static func hardwareCaptureImage(windowId: CGWindowID) -> CGImage? {
    guard let main = spi.mainConnection, let capture = spi.hwCapture else { return nil }
    var id = windowId
    let options: UInt32 = (1 << 11) | (1 << 8)  // ignore global clip shape | best resolution
    guard let array = capture(main(), &id, 1, options)?.takeRetainedValue(),
      CFArrayGetCount(array) > 0
    else { return nil }
    let image = unsafeBitCast(CFArrayGetValueAtIndex(array, 0), to: CGImage.self)
    return image.width > 0 && image.height > 0 ? image : nil
  }

  /// The CGWindowID behind an AX window element, via `_AXUIElementGetWindow`.
  static func windowId(for element: AXUIElement) -> CGWindowID? {
    guard let getWindow = spi.axGetWindow else { return nil }
    var windowId: CGWindowID = 0
    guard getWindow(element, &windowId) == .success, windowId != 0 else { return nil }
    return windowId
  }
}
