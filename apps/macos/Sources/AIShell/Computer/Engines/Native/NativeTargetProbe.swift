import AICore
import CoreGraphics
import Darwin
import Foundation

/// What the shell reads about native targets itself rather than through the driver: a process's
/// start identity and where a frame lies on the displays. Reads that can block on a busy app
/// (accessibility, code signatures) run off the main actor through ``detached(_:)``.
nonisolated enum NativeTargetProbe {
  /// Runs `work` off the main actor.
  static func detached<T: Sendable>(_ work: @escaping @Sendable () -> T) async -> T {
    await Task.detached(priority: .userInitiated) { work() }.value
  }

  /// The process's start time in microseconds since 1970, so a reused pid never matches an older
  /// ref; nil when no such process runs.
  static func processStart(pid: pid_t) -> UInt64? {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var name: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
    guard sysctl(&name, u_int(name.count), &info, &size, nil, 0) == 0, size > 0,
      info.kp_proc.p_pid == pid
    else { return nil }
    let start = info.kp_proc.p_un.__p_starttime
    return UInt64(start.tv_sec) * 1_000_000 + UInt64(start.tv_usec)
  }

  /// `rect` as screen geometry for progress: Quartz points on the display holding most of it.
  static func screenGeometry(_ rect: CGRect?) -> ComputerGeometryWire? {
    guard let rect, !rect.isEmpty else { return nil }
    var displays = [CGDirectDisplayID](repeating: 0, count: 8)
    var count: UInt32 = 0
    guard CGGetDisplaysWithRect(rect, UInt32(displays.count), &displays, &count) == .success,
      count > 0
    else { return nil }
    let bounds = displays.prefix(Int(count)).map { CGDisplayBounds($0) }
    guard let index = PointerGeometry.display(for: rect, in: bounds) else { return nil }
    return .screen(displayId: Int(displays[index]), rect: ComputerRectWire(rect))
  }
}
