import Darwin
import Foundation

/// Kernel-backed process identity and symlink-normalized path checks.
///
/// Promoted to `public` in `AICore` so both `AIRelay` (`ServiceSupervisor` cross-bundle adoption
/// checks) and `AIShell` (`ManagedChrome`, `RemoteModifierRepair`, `ShellEnvironmentChecks`) share
/// one source-compatible implementation.
public nonisolated enum ProcessIdentity {
  /// Process start time in microseconds since 1970 from `proc_bsdinfo`, or `nil` if `pid` is not
  /// alive or unreadable.
  public static func start(of pid: pid_t) -> UInt64? {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard pid > 0, proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else {
      return nil
    }
    return UInt64(info.pbi_start_tvsec) * 1_000_000 + UInt64(info.pbi_start_tvusec)
  }

  /// Parent process ID from `proc_bsdinfo`, or `nil` when `pid` is gone.
  public static func parentPid(of pid: pid_t) -> pid_t? {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard pid > 0, proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size else {
      return nil
    }
    return pid_t(bitPattern: info.pbi_ppid)
  }

  /// Symlink-resolved absolute executable path reported by `proc_pidpath`, or `nil` if `pid` does
  /// not exist or its path cannot be queried.
  public static func executablePath(of pid: pid_t) -> String? {
    guard pid > 0 else { return nil }
    var buffer = [UInt8](repeating: 0, count: 4 * Int(MAXPATHLEN))
    let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
    guard length > 0 else { return nil }
    let rawPath = String(decoding: buffer.prefix(Int(length)), as: UTF8.self)
    return normalizedFilePath(rawPath)
  }

  /// Canonicalizes a filesystem `URL` via `resolvingSymlinksInPath()` (handling `/var` ->
  /// `/private/var` and App Translocation symlinks) and trims any non-root trailing `/`.
  public static func normalizedPath(of url: URL) -> String {
    let resolved = url.resolvingSymlinksInPath().standardizedFileURL.path(percentEncoded: false)
    return resolved.count > 1 && resolved.hasSuffix("/")
      ? String(resolved.dropLast())
      : resolved
  }

  /// Canonicalizes a raw filesystem path string via `resolvingSymlinksInPath()`.
  public static func normalizedFilePath(_ path: String) -> String {
    guard !path.isEmpty else { return "" }
    return normalizedPath(of: URL(filePath: path))
  }

  /// Returns `true` only when `executablePath` (after `resolvingSymlinksInPath()`) equals or lies
  /// strictly beneath `directoryURL` on a `/` path-segment boundary.
  ///
  /// Prevents DMG (`/Volumes/Atd/Atd.app`) or App Translocation cross-path process adoption as
  /// well as sibling-prefix collisions (`/Applications/Atd.app` vs `/Applications/Atd.app-old`).
  public static func isExecutable(_ executablePath: String?, inside directoryURL: URL) -> Bool {
    guard let executablePath, !executablePath.isEmpty else { return false }
    let execNorm = normalizedFilePath(executablePath)
    let rootNorm = normalizedPath(of: directoryURL)
    guard !execNorm.isEmpty, !rootNorm.isEmpty else { return false }
    if rootNorm == "/" { return execNorm.hasPrefix("/") }
    return execNorm == rootNorm || execNorm.hasPrefix(rootNorm + "/")
  }

  /// Returns `true` when live process `pid` runs an executable inside `directoryURL`.
  public static func isProcess(_ pid: pid_t, inside directoryURL: URL) -> Bool {
    isExecutable(executablePath(of: pid), inside: directoryURL)
  }

  /// Walks `parentPid(of:)` up to `maxDepth` hops to check whether `pid` descends from
  /// `ancestorPid`.
  public static func isDescendant(
    _ pid: pid_t, of ancestorPid: pid_t, maxDepth: Int = 16
  ) -> Bool {
    guard pid > 0, ancestorPid > 0, maxDepth > 0 else { return false }
    if pid == ancestorPid { return true }
    var current = pid
    var visited = Set<pid_t>([current])
    for _ in 0..<maxDepth {
      guard let parent = parentPid(of: current), parent > 1 else { return false }
      if parent == ancestorPid { return true }
      if !visited.insert(parent).inserted { return false }
      current = parent
    }
    return false
  }
}
