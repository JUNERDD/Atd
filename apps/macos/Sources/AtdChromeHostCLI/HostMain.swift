import AIChromeChannelKit
import Darwin
import Foundation
import os

/// The host's run, from its arguments to its exit. The exit status says how it ended (sysexits):
///
/// - `0`: Chrome or the shell closed its side;
/// - `EX_USAGE` (64): no caller origin argument;
/// - `EX_DATAERR` (65): a frame longer than its leg allows, or a zero length (the stream is out
///   of sync);
/// - `EX_UNAVAILABLE` (69): no shell is listening on the socket (Atd is not running);
/// - `EX_IOERR` (74): reading, writing or connecting failed otherwise;
/// - `EX_NOPERM` (77): the socket's listener is not this host's own app (another user, a process
///   that is not validly signed, or other code than the app's main executable), or that app's
///   signature cannot be read (``HostListenerCheck``); nothing was sent;
/// - `EX_CONFIG` (78): the host does not sit in an app bundle naming its `AtdHostBundleIdentifier`,
///   or the socket path does not fit a unix socket address.
///
/// Every failure writes one stderr line. `scripts/verify-app/chrome-host-check.mjs` relies on the
/// `EX_UNAVAILABLE` exit and its line, so a missing listener must end the run before the listener
/// check, which needs a connected socket.
nonisolated enum HostMain {
  static func run(_ arguments: [String]) -> Never {
    signal(SIGPIPE, SIG_IGN)
    guard arguments.count >= 2, !arguments[1].isEmpty else {
      HostExit.finish(EX_USAGE, "expected the caller origin as the first argument")
    }
    let socket: Int32
    do throws(HostFailure) {
      let app = try HostLocation.appBundle()
      let path = try HostLocation.socketPath(bundleId: try HostLocation.bundleIdentifier(of: app))
      socket = try HostSocket.connect(path: path)
      try HostListenerCheck.verify(socket, app: app)
    } catch {
      HostExit.finish(error.status, error.message)
    }
    let parent = getppid()
    let hello = ChromeHostHello(
      origin: arguments[1], pid: getpid(), ppid: parent,
      browserPath: HostLocation.executablePath(of: parent) ?? "")
    guard let body = try? ChromeChannelCoding.encode(hello) else {
      HostExit.finish(EX_SOFTWARE, "could not encode host.hello")
    }
    // Written before either pump starts, so the hello is the socket's first frame.
    guard HostPipe.writeAll(socket, ChromeChannelFraming.frame(body)) else {
      HostExit.finish(EX_IOERR, "could not send host.hello to Atd (\(HostExit.reason()))")
    }
    Thread.detachNewThread {
      HostExit.finish(
        HostPipe.pump(
          from: socket, to: STDOUT_FILENO, limit: ChromeChannelFraming.maxToChrome, peer: "Atd"))
    }
    HostExit.finish(
      HostPipe.pump(
        from: STDIN_FILENO, to: socket, limit: ChromeChannelFraming.maxFromChrome, peer: "Chrome"))
  }
}

/// Why the host stopped before piping: the exit status and the one stderr line.
nonisolated struct HostFailure: Error {
  let status: Int32
  let message: String
}

/// Ends the process once: the first of the two pump threads to finish decides the status.
nonisolated enum HostExit {
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "chrome-host")
  /// Never unlocked: a second caller waits here until the first one's `exit` ends the process,
  /// since calling `exit` twice concurrently is undefined.
  private static let once = NSLock()

  static func finish(_ failure: HostFailure) -> Never {
    finish(failure.status, failure.status == 0 ? nil : failure.message)
  }

  static func finish(_ status: Int32, _ message: String?) -> Never {
    once.lock()
    if status != 0 {
      let detail = message ?? "exit"
      log.error(
        "atd-chrome-host exited with status \(status, privacy: .public): \(detail, privacy: .private)"
      )
    }
    if let message {
      FileHandle.standardError.write(Data("atd-chrome-host: \(message)\n".utf8))
    }
    exit(status)
  }

  /// `errno` as text, for a log line.
  static func reason(_ code: Int32 = errno) -> String { String(cString: strerror(code)) }
}
