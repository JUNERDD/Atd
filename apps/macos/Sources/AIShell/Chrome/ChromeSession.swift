import AIChromeChannelKit
import AICore
import AppKit
import Darwin
import OSLog

/// One native host connection, from its `host.hello` to its close (K2). It owns the frames' order
/// and their validation: the first frame must be the host's `host.hello` from the peer the
/// listener admitted, naming this build's extension as the caller and a Developer ID–signed
/// browser as its parent; the second the extension's `hello`; nothing else is accepted before
/// them, and every frame after them goes to the channel.
///
/// Residual OS boundary: unprivileged macOS user space has `LOCAL_PEERTOKEN` (`audit_token_t`) for
/// the connecting `atd-chrome-host` peer, whereas the browser parent is bound across the async
/// signature check via `atd-chrome-host`'s initial `getppid()` + `proc_pidpath`, `proc_bsdinfo`
/// `(uid, start_tvsec, start_tvusec)` snapshots on both host and parent, canonical `browserPath`
/// equality, and containment inside the verified `browserIdentity.bundlePath`.
final class ChromeSession {
  enum Phase: Equatable {
    case awaitingHost
    /// The host spoke; its parent's code signature is being checked off the main actor, and the
    /// frames that arrive meanwhile wait.
    case checkingBrowser
    case awaitingHello
    /// The extension spoke, but presented no valid pairing secret.
    case unpaired
    case paired
    case closed
  }

  private struct ProcessSnapshot: Equatable {
    let pid: pid_t
    let ppid: pid_t
    let uid: uid_t
    let startSec: UInt64
    let startUsec: UInt64

    var startTuple: (UInt64, UInt64) { (startSec, startUsec) }
  }

  private static let log = Logger(subsystem: "com.junerdd.ai", category: "chrome")

  private let connection: ChromeHostConnection
  private let identity: ChromeChannelIdentity
  private let verifyBrowser: @Sendable (pid_t) -> ChromeBrowserIdentity?
  private(set) var phase = Phase.awaitingHost
  private(set) var hello: ChromeHello?
  /// The browser process: the native host's parent, as the host reported and the shell checked.
  private(set) var browserPid: pid_t = 0
  /// Cryptographic identity of the verified browser once `checkingBrowser` succeeds.
  private(set) var browserIdentity: ChromeBrowserIdentity?
  /// The browser's name as Settings and the pairing alert show it (`Google Chrome`, `Aside`, …).
  private(set) var browser = "Chromium"
  /// The link once paired; nil before and after.
  var link: ChromeLink?
  /// The code of the pairing request being asked about, if any.
  var pairingCode: String?
  private var chunks = 0
  /// Frames that arrived while the browser was being checked, in order.
  private var waiting: [Data] = []
  private static let maxWaiting = 16

  /// Every frame after `hello`, and the `hello` itself.
  var onFrame: ((ChromeSession, ChromeInboundFrame) -> Void)?
  var onClose: ((ChromeSession) -> Void)?

  init(
    connection: ChromeHostConnection, identity: ChromeChannelIdentity,
    verifyBrowser: @escaping @Sendable (pid_t) -> ChromeBrowserIdentity? =
      ChromeBrowserSignature.verify
  ) {
    self.connection = connection
    self.identity = identity
    self.verifyBrowser = verifyBrowser
    connection.onFrame = { [weak self] body in self?.receive(body) }
    connection.onClose = { [weak self] in self?.ended() }
  }

  var installationId: String? { hello?.installationId }

  func send(_ frame: ChromeOutboundFrame) {
    guard phase != .closed, phase != .awaitingHost, phase != .checkingBrowser else { return }
    writeFrame(frame)
  }

  /// Sends a structured `error` frame even during pre-hello phases (`awaitingHost`,
  /// `checkingBrowser`) and closes the session so the extension receives the diagnostic before EOF.
  func reject(code: String, message: String) {
    guard phase != .closed else { return }
    writeFrame(.error(ref: nil, code: code, message: message))
    close()
  }

  func close() {
    guard phase != .closed else { return }
    phase = .closed
    connection.close()
    onClose?(self)
  }

  /// The session presented a valid secret, or the person just paired it.
  func paired(_ link: ChromeLink) {
    self.link = link
    phase = .paired
  }

  /// The person disconnected the profile in Settings: the extension learns it and may pair again.
  func unpair() {
    link = nil
    phase = .unpaired
    send(.unpaired)
  }

  private func writeFrame(_ frame: ChromeOutboundFrame) {
    do {
      chunks += 1
      for body in try ChromeChannelFraming.chunks(of: frame.serialized(), id: "k\(chunks)") {
        connection.send(body)
      }
    } catch {
      Self.log.error("A \(frame.type, privacy: .public) frame could not be encoded.")
    }
  }

  private func receive(_ body: Data) {
    switch phase {
    case .closed: return
    case .awaitingHost: acceptHost(body)
    case .checkingBrowser:
      guard waiting.count < Self.maxWaiting else { return close() }
      waiting.append(body)
    case .awaitingHello, .unpaired, .paired:
      let frame: ChromeInboundFrame
      do {
        frame = try JSONDecoder().decode(ChromeInboundFrame.self, from: body)
      } catch {
        Self.log.error("Refused a malformed frame from Atd for Chrome: \(error, privacy: .public)")
        send(
          .error(
            ref: nil, code: ChromeChannelErrorCode.malformed, message: "The frame was refused."))
        // Without a hello nothing can follow: closing lets the extension connect again.
        if phase == .awaitingHello { close() }
        return
      }
      if case .unknown(let type) = frame {
        return Self.log.info("Ignored an unknown \(type, privacy: .public) frame.")
      }
      if phase == .awaitingHello {
        guard case .hello(let hello) = frame else {
          Self.log.error("Atd for Chrome sent \(frame.type, privacy: .public) before hello.")
          return close()
        }
        self.hello = hello
        phase = .unpaired
      } else if case .hello = frame {
        Self.log.error("Atd for Chrome sent a second hello.")
        return close()
      }
      onFrame?(self, frame)
    }
  }

  private func acceptHost(_ body: Data) {
    guard let hello = try? JSONDecoder().decode(ChromeHostHello.self, from: body),
      hello.pid == connection.peerPid
    else {
      Self.log.error("Refused a native host connection without a valid host.hello.")
      return close()
    }
    guard hello.origin == identity.origin else {
      Self.log.error("Refused a native host connection from an unexpected extension origin.")
      return reject(
        code: ChromeChannelErrorCode.originMismatch,
        message: "This extension build does not match this Atd build.")
    }
    guard !hello.browserPath.isEmpty,
      let hostBefore = Self.snapshot(of: hello.pid),
      let parentBefore = Self.snapshot(of: hello.ppid),
      hostBefore.ppid == hello.ppid,
      parentBefore.uid == getuid(),
      parentBefore.startTuple <= hostBefore.startTuple,
      let execBefore = Self.executablePath(of: hello.ppid),
      Self.canonicalPath(hello.browserPath) == Self.canonicalPath(execBefore)
    else {
      Self.log.error("Refused a native host connection whose parent browser could not be verified.")
      return close()
    }
    phase = .checkingBrowser
    let browser = hello.ppid
    let verify = verifyBrowser
    let canonicalExec = Self.canonicalPath(execBefore)
    Task { [weak self] in
      let verified = await Task.detached { verify(browser) }.value
      self?.browserChecked(
        verified, hello: hello, hostBefore: hostBefore, parentBefore: parentBefore,
        canonicalExec: canonicalExec)
    }
  }

  private func browserChecked(
    _ verified: ChromeBrowserIdentity?, hello: ChromeHostHello,
    hostBefore: ProcessSnapshot, parentBefore: ProcessSnapshot, canonicalExec: String
  ) {
    guard phase == .checkingBrowser else { return }
    guard let verified else {
      Self.log.error("Refused a native host started by an unverified browser.")
      return reject(
        code: ChromeChannelErrorCode.browserNotVerified,
        message: "This browser's code signature could not be verified.")
    }
    guard let hostAfter = Self.snapshot(of: hello.pid),
      let parentAfter = Self.snapshot(of: hello.ppid),
      hostAfter == hostBefore,
      parentAfter == parentBefore,
      let execAfter = Self.executablePath(of: hello.ppid),
      Self.canonicalPath(execAfter) == canonicalExec,
      Self.isExecutable(canonicalExec, insideBundle: verified.bundlePath)
    else {
      Self.log.error("Refused a native host whose parent browser changed or mismatched its bundle.")
      return close()
    }
    browserPid = hello.ppid
    browserIdentity = verified
    browser = Self.browserName(
      executable: execAfter, bundlePath: verified.bundlePath, pid: hello.ppid)
    phase = .awaitingHello
    let held = waiting
    waiting = []
    for body in held { receive(body) }
  }

  private func ended() {
    guard phase != .closed else { return }
    phase = .closed
    onClose?(self)
  }

  private static func snapshot(of pid: pid_t) -> ProcessSnapshot? {
    guard pid > 0 else { return nil }
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size,
      (info.pbi_flags & UInt32(PROC_FLAG_INEXIT)) == 0
    else { return nil }
    return ProcessSnapshot(
      pid: pid_t(info.pbi_pid), ppid: pid_t(info.pbi_ppid), uid: info.pbi_uid,
      startSec: info.pbi_start_tvsec, startUsec: info.pbi_start_tvusec)
  }

  static func executablePath(of pid: pid_t) -> String? {
    var buffer = [UInt8](repeating: 0, count: Int(MAXPATHLEN) * 4)
    let length = proc_pidpath(pid, &buffer, UInt32(buffer.count))
    guard length > 0 else { return nil }
    return String(decoding: buffer.prefix(Int(length)), as: UTF8.self)
  }

  static func canonicalPath(_ path: String) -> String {
    var resolved = URL(filePath: path).resolvingSymlinksInPath().standardizedFileURL
      .path(percentEncoded: false)
    while resolved.count > 1 && resolved.hasSuffix("/") { resolved.removeLast() }
    return resolved
  }

  static func isExecutable(_ canonicalExecutable: String, insideBundle bundlePath: String) -> Bool {
    let bundleCanon = canonicalPath(bundlePath)
    guard !bundleCanon.isEmpty, bundleCanon != "/" else { return false }
    return canonicalExecutable.lowercased().hasPrefix((bundleCanon + "/").lowercased())
  }

  /// The running browser's name, else its bundle's display/bundle name or `.app` stem, fallback
  /// `"Chromium"`.
  static func browserName(executable: String, bundlePath: String? = nil, pid: pid_t) -> String {
    if pid > 0, let name = NSRunningApplication(processIdentifier: pid)?.localizedName,
      !name.isEmpty
    {
      return name.clipped(toUTF16: 120)
    }
    let bundleURL: URL
    if let bundlePath, !bundlePath.isEmpty {
      bundleURL = URL(filePath: bundlePath)
    } else {
      bundleURL = URL(filePath: executable).deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
    }
    if let bundle = Bundle(url: bundleURL) {
      for key in ["CFBundleDisplayName", "CFBundleName"] {
        if let name = bundle.object(forInfoDictionaryKey: key) as? String, !name.isEmpty {
          return name.clipped(toUTF16: 120)
        }
      }
    }
    if bundleURL.pathExtension.lowercased() == "app" {
      let stem = bundleURL.deletingPathExtension().lastPathComponent
      if !stem.isEmpty { return stem.clipped(toUTF16: 120) }
    }
    return "Chromium"
  }
}
