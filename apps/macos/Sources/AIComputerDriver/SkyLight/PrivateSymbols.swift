import AIComputerDriverKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

// Private-symbol declarations, event-field recipe and the focus/key-window records below are
// re-implemented in Swift from the MIT-licensed open-computer-use (iFurySt/open-computer-use),
// Cua Driver (trycua/cua) and yabai (asmvik/yabai) projects. No upstream code is vendored.

/// Resolves the undocumented SkyLight / CoreGraphics / Carbon symbols the event and capture
/// routes need, and gates each capability on symbol presence plus a runtime latch: when a call
/// later misbehaves the engine latches the capability off for the life of the process, so a
/// private-ABI drift fails closed instead of corrupting state (plan §2.2, R1-D6). All
/// undocumented ABI lives in this one file so a macOS compatibility change has a single review
/// boundary. The driver runs as an isolated child, so a crash here cannot take the shell down.
final class PrivateSymbols: @unchecked Sendable {
  static let shared = PrivateSymbols()

  typealias PostToPidFn = @convention(c) (pid_t, UnsafeMutableRawPointer?) -> Void
  typealias SetIntegerFieldFn = @convention(c) (UnsafeMutableRawPointer?, UInt32, Int64) -> Void
  typealias SetWindowLocationFn = @convention(c) (UnsafeMutableRawPointer?, Double, Double) -> Void
  typealias PostEventRecordFn = @convention(c) (UnsafeRawPointer?, UnsafePointer<UInt8>?) -> Int32
  typealias GetFrontProcessFn = @convention(c) (UnsafeMutableRawPointer?) -> Int32
  typealias GetProcessForPIDFn = @convention(c) (pid_t, UnsafeMutableRawPointer?) -> Int32
  typealias GetProcessPIDFn =
    @convention(c) (UnsafeRawPointer?, UnsafeMutablePointer<pid_t>?) -> Int32
  typealias MainConnectionFn = @convention(c) () -> UInt32
  typealias GetWindowOwnerFn =
    @convention(c) (UInt32, UInt32, UnsafeMutablePointer<UInt32>?) -> Int32
  typealias GetConnectionPSNFn = @convention(c) (UInt32, UnsafeMutableRawPointer?) -> Int32
  typealias EnableOcclusionFn =
    @convention(c) (UInt32, CGWindowID, UInt8, UnsafeMutablePointer<UInt8>?) -> Int32
  typealias GetActiveSpaceFn = @convention(c) (UInt32) -> UInt64
  typealias CopySpacesForWindowsFn = @convention(c) (UInt32, Int32, CFArray) -> Unmanaged<CFArray>?
  typealias HWCaptureFn =
    @convention(c) (UInt32, UnsafePointer<CGWindowID>, Int32, UInt32) -> Unmanaged<CFArray>?
  typealias AXGetWindowFn =
    @convention(c) (AXUIElement, UnsafeMutablePointer<CGWindowID>) -> AXError

  let postToPid: PostToPidFn?
  let setIntegerField: SetIntegerFieldFn?
  let setWindowLocation: SetWindowLocationFn?
  let postEventRecord: PostEventRecordFn?
  let getFrontProcess: GetFrontProcessFn?
  let getProcessForPID: GetProcessForPIDFn?
  let getProcessPID: GetProcessPIDFn?
  let mainConnection: MainConnectionFn?
  let getWindowOwner: GetWindowOwnerFn?
  let getConnectionPSN: GetConnectionPSNFn?
  let enableOcclusion: EnableOcclusionFn?
  let getActiveSpace: GetActiveSpaceFn?
  let copySpacesForWindows: CopySpacesForWindowsFn?
  let hwCapture: HWCaptureFn?
  let axGetWindow: AXGetWindowFn?

  private let latch = NSLock()
  private var disabled: Set<String> = []

  private init() {
    dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY | RTLD_GLOBAL)
    // Carbon/CoreGraphics/AX symbols are re-exports resolvable through the global scope.
    // `bitPattern: -2` is RTLD_DEFAULT: resolve through the global scope so re-exported
    // Carbon/CoreGraphics/AX symbols are found as well as SkyLight's own.
    func sym<T>(_ name: String) -> T? {
      guard let pointer = dlsym(UnsafeMutableRawPointer(bitPattern: -2), name) else { return nil }
      return unsafeBitCast(pointer, to: T.self)
    }
    postToPid = sym("SLEventPostToPid")
    setIntegerField = sym("SLEventSetIntegerValueField")
    setWindowLocation = sym("CGEventSetWindowLocation")
    postEventRecord = sym("SLPSPostEventRecordTo")
    getFrontProcess = sym("_SLPSGetFrontProcess")
    getProcessForPID = sym("GetProcessForPID")
    getProcessPID = sym("GetProcessPID")
    mainConnection = sym("SLSMainConnectionID")
    getWindowOwner = sym("SLSGetWindowOwner")
    getConnectionPSN = sym("SLSGetConnectionPSN")
    enableOcclusion = sym("SLSPackagesEnableWindowOcclusionNotifications")
    getActiveSpace = sym("SLSGetActiveSpace")
    copySpacesForWindows = sym("SLSCopySpacesForWindows")
    hwCapture = sym("SLSHWCaptureWindowList")
    axGetWindow = sym("_AXUIElementGetWindow")
  }

  /// Latch a capability off after a runtime failure; it stays off for the process (fail-closed).
  func latchUnavailable(_ capability: String) {
    latch.lock()
    disabled.insert(capability)
    latch.unlock()
  }

  private func isLatched(_ capability: String) -> Bool {
    latch.lock()
    defer { latch.unlock() }
    return disabled.contains(capability)
  }

  /// A capability is present only when its symbols resolve, a first-use behavioral check passes,
  /// and it has not been latched off by a later failure. The behavioral check here is the minimum
  /// the driver can run without touching another app (a live main WindowServer connection); the
  /// probe worker's S1–S9 experiments exercise the behavioral guarantees end to end.
  private func present(_ capability: String, _ symbolsResolved: Bool, _ behavioral: Bool = true)
    -> DriverCapability
  {
    if isLatched(capability) {
      return DriverCapability(name: capability, available: false, detail: "latched off at runtime")
    }
    if !symbolsResolved {
      return DriverCapability(name: capability, available: false, detail: "missing private symbols")
    }
    if !behavioral {
      return DriverCapability(
        name: capability, available: false, detail: "behavioral self-test failed")
    }
    return DriverCapability(name: capability, available: true)
  }

  /// Whether the main WindowServer connection resolves to a nonzero id: the behavioral floor for
  /// every SkyLight capability. A disclaimed/bare-binary launch returns 0 here (plan §2.3).
  var hasWindowServerConnection: Bool {
    guard let mainConnection else { return false }
    return mainConnection() != 0
  }

  func capability(_ name: String) -> DriverCapability {
    switch name {
    case DriverCapabilityName.windowEvents:
      return present(
        name, postToPid != nil && setIntegerField != nil && setWindowLocation != nil,
        hasWindowServerConnection)
    case DriverCapabilityName.keyScope:
      let psnPath = (getWindowOwner != nil && getConnectionPSN != nil) || getProcessForPID != nil
      return present(
        name, postEventRecord != nil && getFrontProcess != nil && psnPath, hasWindowServerConnection
      )
    case DriverCapabilityName.occlusionKeepAlive:
      return present(
        name, enableOcclusion != nil && mainConnection != nil, hasWindowServerConnection)
    case DriverCapabilityName.offSpaceCapture:
      return present(name, hwCapture != nil && mainConnection != nil, hasWindowServerConnection)
    case DriverCapabilityName.windowServerQueries:
      return present(name, mainConnection != nil, hasWindowServerConnection)
    default:
      return DriverCapability(name: name, available: false, detail: "unknown capability")
    }
  }
}
