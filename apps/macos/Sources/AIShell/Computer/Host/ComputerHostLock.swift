import AICore
import Darwin
import Foundation

/// A host file that needs the lock, or a file the host could not read or write.
enum ComputerHostFileError: Error, Equatable {
  case lockNotHeld
  case io(String)
}

/// The computer host's session lock (D6, plan §6.2): an advisory `flock` on `host.lock` in a
/// directory shared by every Atd build of this login session, independent of the bundle id and
/// of `AI_AGENT_DATA_DIR` (`AI_COMPUTER_HOST_DIR` moves it, for isolated test and development
/// runs). The shell that holds it is the one computer host; another one reports it busy and
/// never takes it over. The descriptor stays open for the process lifetime, so the kernel drops
/// the lock when the process ends however it ends; it is closed on exec, so the service and the
/// workers the shell starts never inherit it.
///
/// The lock file names its holder (pid and bundle id, nothing about any task). Beside it,
/// `unsettled.json` (``UnsettledMarker``) outlives the lock: actions a host left open keep the
/// next host's background writes closed until they are reconciled.
final class ComputerHostLock {
  /// Who holds the lock, as its holder wrote it into the lock file.
  struct Holder: Codable, Equatable {
    let pid: Int32
    let bundleId: String
  }

  enum State: Equatable {
    case unacquired
    case held
    /// Another process holds it; its holder when the lock file could be read.
    case busy(Holder?)
    case failed(String)
  }

  nonisolated static let directoryOverrideKey = "AI_COMPUTER_HOST_DIR"

  let directory: URL
  private(set) var state: State = .unacquired
  private var descriptor: Int32 = -1

  init(directory: URL = ComputerHostLock.defaultDirectory()) {
    self.directory = directory
  }

  /// `~/Library/Application Support/Atd Computer Host`, or `AI_COMPUTER_HOST_DIR` when set.
  nonisolated static func defaultDirectory(
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> URL {
    if let override = environment[directoryOverrideKey], !override.isEmpty {
      return URL(filePath: override, directoryHint: .isDirectory)
    }
    let support =
      FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? URL(filePath: NSHomeDirectory()).appending(path: "Library/Application Support")
    return support.appending(path: "Atd Computer Host", directoryHint: .isDirectory)
  }

  var isHeld: Bool { state == .held }

  /// Who holds the lock while another process does, for the host's busy state; nil otherwise.
  var holderDescription: String? {
    guard case .busy(let holder) = state else { return nil }
    guard let holder else { return "another Atd instance" }
    return "\(holder.bundleId) (pid \(holder.pid))"
  }

  var lockURL: URL { directory.appending(path: "host.lock") }
  var unsettledURL: URL { directory.appending(path: "unsettled.json") }

  /// Takes the lock without waiting; true once held. A busy or failed attempt may be repeated,
  /// for when the other host quits.
  @discardableResult
  func acquire() -> Bool {
    if isHeld { return true }
    do {
      try FileManager.default.createDirectory(
        at: directory, withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700])
    } catch {
      state = .failed("The computer host folder could not be created.")
      return false
    }
    let fd = open(lockURL.path(percentEncoded: false), O_RDWR | O_CREAT | O_CLOEXEC, 0o600)
    guard fd >= 0 else {
      state = .failed(Self.errnoMessage())
      return false
    }
    guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
      let code = errno
      close(fd)
      state = code == EWOULDBLOCK ? .busy(readHolder()) : .failed(Self.errnoMessage(code))
      return false
    }
    descriptor = fd
    writeHolder(to: fd)
    state = .held
    return true
  }

  /// Gives the lock up; the unsettled marker stays as it is.
  func release() {
    guard descriptor >= 0 else { return }
    flock(descriptor, LOCK_UN)
    close(descriptor)
    descriptor = -1
    state = .unacquired
  }

  /// The marker a host left, nil when there is none. Throws when one exists but cannot be read,
  /// which must keep background writes closed just as a readable one does.
  func readUnsettled() throws(ComputerHostFileError) -> UnsettledMarker? {
    let data: Data
    do {
      data = try Data(contentsOf: unsettledURL)
    } catch CocoaError.fileReadNoSuchFile {
      return nil
    } catch {
      throw .io("The unsettled marker could not be read.")
    }
    do {
      return try JSONDecoder().decode(UnsettledMarker.self, from: data)
    } catch {
      throw .io("The unsettled marker is not valid.")
    }
  }

  /// Replaces the marker, or removes it for nil or a marker without actions. Only the holder
  /// writes it.
  func writeUnsettled(_ marker: UnsettledMarker?) throws(ComputerHostFileError) {
    guard isHeld else { throw .lockNotHeld }
    do {
      guard let marker, !marker.actionIds.isEmpty else {
        if FileManager.default.fileExists(atPath: unsettledURL.path(percentEncoded: false)) {
          try FileManager.default.removeItem(at: unsettledURL)
        }
        return
      }
      try JSONEncoder().encode(marker).write(to: unsettledURL, options: .atomic)
    } catch {
      throw .io("The unsettled marker could not be written.")
    }
  }

  private func writeHolder(to fd: Int32) {
    let holder = Holder(
      pid: ProcessInfo.processInfo.processIdentifier,
      bundleId: Bundle.main.bundleIdentifier ?? "unbundled")
    guard let data = try? JSONEncoder().encode(holder) else { return }
    ftruncate(fd, 0)
    _ = data.withUnsafeBytes { pwrite(fd, $0.baseAddress, $0.count, 0) }
  }

  private func readHolder() -> Holder? {
    guard let data = try? Data(contentsOf: lockURL) else { return nil }
    return try? JSONDecoder().decode(Holder.self, from: data)
  }

  private static func errnoMessage(_ code: Int32 = errno) -> String {
    "The computer host lock could not be taken: \(String(cString: strerror(code)))."
  }
}
