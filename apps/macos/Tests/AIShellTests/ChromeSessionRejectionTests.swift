import AIChromeChannelKit
import AICore
import Darwin
import Foundation
import Testing

@testable import AIShell

@MainActor
@Suite("ChromeSession socket flush, rejection diagnostics, and manifest refresh guards")
struct ChromeSessionRejectionTests {
  private static let identity = ChromeChannelIdentity(
    hostName: "com.junerdd.atd.chrome.dev",
    extensionId: "eolengaocpdgjapbjdfpfcokjpgjaedi")!

  private struct WireErrorFrame: Decodable {
    let v: Int
    let t: String
    let ref: String?
    let code: String
    let message: String
  }

  private static func makeSocketPair() throws -> (server: Int32, peer: Int32) {
    var fds: [Int32] = [-1, -1]
    guard socketpair(AF_UNIX, SOCK_STREAM, 0, &fds) == 0 else {
      throw CocoaError(.fileReadUnknown)
    }
    var one: Int32 = 1
    _ = setsockopt(fds[0], SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
    _ = setsockopt(fds[1], SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
    return (fds[0], fds[1])
  }

  private static func writeFramed(_ body: Data, to fd: Int32) throws {
    let framed = ChromeChannelFraming.frame(body)
    let ok = framed.withUnsafeBytes { raw -> Bool in
      guard let base = raw.baseAddress else { return true }
      var offset = 0
      while offset < raw.count {
        let n = Darwin.write(fd, base + offset, raw.count - offset)
        if n > 0 { offset += n } else if n < 0, errno == EINTR { continue } else { return false }
      }
      return true
    }
    guard ok else { throw CocoaError(.fileWriteUnknown) }
  }

  /// Reads all length-prefixed frames from `fd` until clean EOF (`read == 0`), timing out after
  /// `timeoutMs` so a missing `SHUT_WR` fails instead of hanging.
  private static func readAllFramesUntilEOF(from fd: Int32, timeoutMs: Int32 = 3000) async throws
    -> (frames: [Data], sawEOF: Bool)
  {
    try await Task.detached {
      var reader = ChromeChannelFraming.Reader(limit: ChromeChannelFraming.maxToChrome)
      var frames: [Data] = []
      var buffer = [UInt8](repeating: 0, count: 16 * 1024)
      let deadline = ContinuousClock.now + .milliseconds(Int(timeoutMs))
      while true {
        let remaining = ContinuousClock.now.duration(to: deadline)
        let waitMs = max(
          1,
          Int32(remaining.components.seconds * 1000)
            + Int32(remaining.components.attoseconds / 1_000_000_000_000_000))
        guard remaining > .zero else { return (frames, false) }
        var pfd = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
        let ready = poll(&pfd, 1, waitMs)
        if ready < 0, errno == EINTR { continue }
        guard ready > 0 else { return (frames, false) }
        let count = buffer.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
        if count < 0, errno == EINTR { continue }
        if count == 0 { return (frames, true) }
        guard count > 0 else { return (frames, false) }
        frames.append(contentsOf: try reader.append(Data(buffer[..<count])))
      }
    }.value
  }

  private static func makeChannel(onStateChange: @escaping () -> Void = {}) -> ChromeChannel {
    let env = ChromeChannelEnvironment(
      client: { throw CocoaError(.featureUnsupported) },
      hostState: { .ready },
      prefs: { ChromePrefs(language: .english, glowEffects: false) },
      appVersion: "0.0.0-test",
      openTask: { _ in },
      openComputerSettings: {},
      stopRun: { _, _ in },
      onStateChange: onStateChange,
      chromeBinding: { _ in nil })
    return ChromeChannel(
      identity: Self.identity, environment: env,
      pairing: ChromePairingPrompt(confirmations: ConfirmationPrompter(), screenBusy: { true }))
  }

  @Test("reject flushes framed error before SHUT_WR EOF even when session drops on onClose")
  func rejectFlushesBeforeDropAndEOF() async throws {
    let pair = try Self.makeSocketPair()
    defer { Darwin.close(pair.peer) }

    var retained: ChromeSession? = ChromeSession(
      connection: ChromeHostConnection(
        socket: ChromeHostSocket(descriptor: pair.server), peerPid: getpid()),
      identity: Self.identity)
    retained?.onClose = { _ in retained = nil }

    retained?.reject(
      code: ChromeChannelErrorCode.browserNotVerified, message: "Signature check failed.")
    #expect(retained == nil)

    let (frames, sawEOF) = try await Self.readAllFramesUntilEOF(from: pair.peer)
    #expect(sawEOF)
    #expect(frames.count == 1)
    let error = try JSONDecoder().decode(WireErrorFrame.self, from: try #require(frames.first))
    #expect(error.v == 1)
    #expect(error.t == "error")
    #expect(error.ref == nil)
    #expect(error.code == ChromeChannelErrorCode.browserNotVerified)
    #expect(error.message == "Signature check failed.")
  }

  @Test("originMismatch sends framed originMismatch error before EOF")
  func originMismatchRejection() async throws {
    let pair = try Self.makeSocketPair()
    defer { Darwin.close(pair.peer) }

    var retained: ChromeSession? = ChromeSession(
      connection: ChromeHostConnection(
        socket: ChromeHostSocket(descriptor: pair.server), peerPid: getpid()),
      identity: Self.identity)
    retained?.onClose = { _ in retained = nil }

    let hello = ChromeHostHello(
      origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
      pid: getpid(), ppid: getppid(), browserPath: "")
    try Self.writeFramed(ChromeChannelCoding.encode(hello), to: pair.peer)

    let (frames, sawEOF) = try await Self.readAllFramesUntilEOF(from: pair.peer)
    #expect(sawEOF)
    #expect(retained == nil)
    let error = try JSONDecoder().decode(WireErrorFrame.self, from: try #require(frames.first))
    #expect(error.code == ChromeChannelErrorCode.originMismatch)
  }

  @Test("browserNotVerified runs real signature check on non-browser parent and flushes error")
  func browserNotVerifiedRejection() async throws {
    let pair = try Self.makeSocketPair()
    defer { Darwin.close(pair.peer) }

    var retained: ChromeSession? = ChromeSession(
      connection: ChromeHostConnection(
        socket: ChromeHostSocket(descriptor: pair.server), peerPid: getpid()),
      identity: Self.identity)
    retained?.onClose = { _ in retained = nil }

    let parentPath = try #require(ChromeSession.executablePath(of: getppid()))
    let hello = ChromeHostHello(
      origin: Self.identity.origin, pid: getpid(), ppid: getppid(), browserPath: parentPath)
    try Self.writeFramed(ChromeChannelCoding.encode(hello), to: pair.peer)

    let (frames, sawEOF) = try await Self.readAllFramesUntilEOF(from: pair.peer)
    #expect(sawEOF)
    #expect(retained == nil)
    let error = try JSONDecoder().decode(WireErrorFrame.self, from: try #require(frames.first))
    #expect(error.code == ChromeChannelErrorCode.browserNotVerified)
  }

  @Test("Empty or mismatched browserPath in host.hello closes immediately")
  func mismatchedBrowserPathRejected() async throws {
    for bogusPath in ["", "/nonexistent/FakeBrowser.app/Contents/MacOS/FakeBrowser"] {
      let pair = try Self.makeSocketPair()
      defer { Darwin.close(pair.peer) }

      var retained: ChromeSession? = ChromeSession(
        connection: ChromeHostConnection(
          socket: ChromeHostSocket(descriptor: pair.server), peerPid: getpid()),
        identity: Self.identity)
      retained?.onClose = { _ in retained = nil }

      let hello = ChromeHostHello(
        origin: Self.identity.origin, pid: getpid(), ppid: getppid(), browserPath: bogusPath)
      try Self.writeFramed(ChromeChannelCoding.encode(hello), to: pair.peer)

      let (frames, sawEOF) = try await Self.readAllFramesUntilEOF(from: pair.peer)
      #expect(sawEOF)
      #expect(frames.isEmpty)
      #expect(retained == nil)
    }
  }

  @Test("TOFU browserMismatch rejects with error frame without deleting stored pairing")
  func browserMismatchRejectionPreservesPairing() async throws {
    let dir = FileManager.default.temporaryDirectory
      .appending(path: "atd-chrome-mismatch-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    let parentPath = try #require(ChromeSession.executablePath(of: getppid()))
    let parentContainer = URL(filePath: parentPath).deletingLastPathComponent()
      .path(percentEncoded: false)

    let aside = ChromeBrowserIdentity(
      signingIdentifier: "at.studio.AsideBrowser", teamId: "8CPD4K4TBB",
      developerName: "At Inc.", bundlePath: "/Applications/Aside.app")
    let chrome = ChromeBrowserIdentity(
      signingIdentifier: "com.google.Chrome", teamId: "EQHXZ8M8AV",
      developerName: "Google LLC", bundlePath: parentContainer)

    let store = ChromePairingStore(url: dir.appending(path: "pairings.json"))
    let secret = try store.pair(
      "inst-tofu", label: "Work", email: nil, browser: "Aside", browserIdentity: aside)
    let channel = Self.makeChannel()
    channel.store = store

    let pair = try Self.makeSocketPair()
    defer { Darwin.close(pair.peer) }

    var retained: ChromeSession? = ChromeSession(
      connection: ChromeHostConnection(
        socket: ChromeHostSocket(descriptor: pair.server), peerPid: getpid()),
      identity: Self.identity,
      verifyBrowser: { _ in chrome })
    retained?.onFrame = { session, frame in channel.handleUnpaired(frame, from: session) }
    retained?.onClose = { _ in retained = nil }

    let hostHello = ChromeHostHello(
      origin: Self.identity.origin, pid: getpid(), ppid: getppid(), browserPath: parentPath)
    try Self.writeFramed(ChromeChannelCoding.encode(hostHello), to: pair.peer)

    let extHello: [String: Any] = [
      "v": 1, "t": "hello", "installationId": "inst-tofu", "extensionVersion": "1.0.0",
      "flavor": "dev", "chromeVersion": "135.0", "fileAccess": false, "secret": secret,
      "profile": ["label": "Work"],
    ]
    try Self.writeFramed(JSONSerialization.data(withJSONObject: extHello), to: pair.peer)

    let (frames, sawEOF) = try await Self.readAllFramesUntilEOF(from: pair.peer)
    #expect(sawEOF)
    #expect(retained == nil)
    let error = try JSONDecoder().decode(WireErrorFrame.self, from: try #require(frames.first))
    #expect(error.code == ChromeChannelErrorCode.browserMismatch)
    // Pairing must remain intact in the store.
    #expect(store.verify("inst-tofu", secret: secret, browserIdentity: aside) == .valid)
  }

  @Test("ChromeChannel.refreshHostManifests guards listener != nil and browserName falls back")
  func refreshGuardAndBrowserNameFallbacks() async {
    var stateChanges = 0
    let channel = Self.makeChannel { stateChanges += 1 }
    #expect(channel.hostManifest == .failed)
    #expect(channel.installedBrowsers.isEmpty)

    await channel.refreshHostManifests(force: true)
    await channel.refreshHostManifests(force: false)

    #expect(channel.hostManifest == .failed)
    #expect(channel.installedBrowsers.isEmpty)
    #expect(stateChanges == 0)

    #expect(
      ChromeSession.browserName(
        executable: "/Applications/Aside.app/Contents/MacOS/Aside",
        bundlePath: "/nonexistent/MyCustomBrowser.app", pid: 0) == "MyCustomBrowser")
    #expect(
      ChromeSession.browserName(
        executable: "/usr/local/bin/chromium", bundlePath: "/usr/local/bin", pid: 0) == "Chromium")
  }
}
