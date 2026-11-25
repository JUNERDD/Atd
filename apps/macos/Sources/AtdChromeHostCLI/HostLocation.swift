import Darwin
import Foundation

/// Where the host finds the shell: its own app bundle names the shell's bundle id, and the shell
/// listens at `~/Library/Application Support/<bundle id>/chrome/host.sock`. That layout is the
/// shell's `ChromeHostLocations` (Sources/AIShell/Chrome/Host); both ends resolve Application
/// Support through Foundation, so they agree on the folder (which honours `CFFIXED_USER_HOME`,
/// not `HOME`).
nonisolated enum HostLocation {
  /// The Info.plist key the App target sets to its bundle id (project.yml).
  static let bundleIdentifierKey = "AtdHostBundleIdentifier"

  /// The app bundle around this executable: Chrome runs the host as
  /// `<App>.app/Contents/MacOS/atd-chrome-host`, so the bundle is three levels up. Whether it is
  /// an app at all is for ``bundleIdentifier(of:)`` to find out.
  static func appBundle() throws(HostFailure) -> URL {
    guard let executable = executablePath(of: getpid()) else {
      throw HostFailure(status: EX_CONFIG, message: "cannot read the host's own executable path")
    }
    return URL(filePath: executable).deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent()
  }

  /// The bundle id the app at `app` (``appBundle()``) names in its `Contents/Info.plist`.
  static func bundleIdentifier(of app: URL) throws(HostFailure) -> String {
    let info = app.appending(path: "Contents").appending(path: "Info.plist")
    guard let data = try? Data(contentsOf: info),
      let plist = try? PropertyListSerialization.propertyList(from: data, format: nil)
        as? [String: Any],
      let identifier = plist[bundleIdentifierKey] as? String, isBundleIdentifier(identifier)
    else {
      throw HostFailure(
        status: EX_CONFIG,
        message: "\(info.path(percentEncoded: false)) names no \(bundleIdentifierKey); "
          + "the host runs only from inside Atd.app")
    }
    return identifier
  }

  /// The shell's socket for `bundleId`, checked to fit `sun_path` with its terminator.
  static func socketPath(bundleId: String) throws(HostFailure) -> String {
    let support =
      FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? URL(filePath: NSHomeDirectory()).appending(path: "Library/Application Support")
    let path = support.appending(path: bundleId).appending(path: "chrome")
      .appending(path: "host.sock").path(percentEncoded: false)
    guard path.utf8.count < MemoryLayout.size(ofValue: sockaddr_un().sun_path) else {
      throw HostFailure(
        status: EX_CONFIG, message: "the socket path is too long for a unix socket: \(path)")
    }
    return path
  }

  /// The executable of process `pid` as the kernel resolved it, nil when it cannot be read.
  static func executablePath(of pid: pid_t) -> String? {
    // PROC_PIDPATHINFO_MAXSIZE, which Swift does not import.
    var buffer = [UInt8](repeating: 0, count: 4 * Int(MAXPATHLEN))
    let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
    guard length > 0 else { return nil }
    return String(decoding: buffer[..<Int(length)], as: UTF8.self)
  }

  /// A path component a bundle id can be: letters, digits, `.` and `-`, not `.` or `..`.
  private static func isBundleIdentifier(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 255 && value != "." && value != ".."
      && value.utf8.allSatisfy {
        (0x30...0x39).contains($0) || (0x41...0x5a).contains($0) || (0x61...0x7a).contains($0)
          || $0 == 0x2e || $0 == 0x2d
      }
  }
}

/// The host's connection to the shell.
nonisolated enum HostSocket {
  /// A connected stream socket to `path`. A missing socket or one nobody listens on means Atd is
  /// not running (`EX_UNAVAILABLE`).
  static func connect(path: String) throws(HostFailure) -> Int32 {
    let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
    guard descriptor >= 0 else {
      throw HostFailure(status: EX_IOERR, message: "cannot open a socket (\(HostExit.reason()))")
    }
    var one: Int32 = 1
    _ = setsockopt(
      descriptor, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: path.utf8) }
    let result = withUnsafePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
    guard result == 0 else {
      let code = errno
      close(descriptor)
      if code == ENOENT || code == ECONNREFUSED {
        throw HostFailure(
          status: EX_UNAVAILABLE, message: "Atd is not running (no listener at \(path))")
      }
      throw HostFailure(
        status: EX_IOERR, message: "cannot connect to \(path) (\(HostExit.reason(code)))")
    }
    return descriptor
  }
}
