import AIChromeChannelKit
import AICore
import Foundation
import Synchronization
import Testing

@testable import AIShell

@MainActor
@Suite("ChromeChannel profile naming, welcome browser field, and refresh lifecycle")
struct ChromeChannelBehaviorTests {
  private static let identity = ChromeChannelIdentity(
    hostName: "com.junerdd.atd.chrome.dev",
    extensionId: "eolengaocpdgjapbjdfpfcokjpgjaedi")!

  private static func decodeHello(label: String, email: String? = nil) throws -> ChromeHello {
    var profile: [String: Any] = ["label": label]
    if let email { profile["email"] = email }
    let raw: [String: Any] = [
      "v": 1, "t": "hello", "installationId": "inst-1", "extensionVersion": "1.0.0",
      "flavor": "dev", "chromeVersion": "135.0", "fileAccess": false, "profile": profile,
    ]
    let frame = try JSONDecoder().decode(
      ChromeInboundFrame.self, from: JSONSerialization.data(withJSONObject: raw))
    guard case .hello(let hello) = frame else { throw CocoaError(.coderReadCorrupt) }
    return hello
  }

  private static func makeChannel(onStateChange: @escaping () -> Void = {}) -> ChromeChannel {
    let env = ChromeChannelEnvironment(
      client: { throw CocoaError(.featureUnsupported) },
      hostState: { .ready },
      prefs: { ChromePrefs(language: .english, glowEffects: false) },
      appVersion: "1.2.3",
      openTask: { _ in },
      openComputerSettings: {},
      stopRun: { _, _ in },
      onStateChange: onStateChange,
      chromeBinding: { _ in nil })
    return ChromeChannel(
      identity: Self.identity, environment: env,
      pairing: ChromePairingPrompt(confirmations: ConfirmationPrompter(), screenBusy: { true }))
  }

  @Test(
    "profileName and label filter generic Chromium brands for Aside/Arc/Dia while keeping email")
  func profileNameAndLabelFilterGenericEngineBrands() throws {
    for generic in ["Google Chrome", "Chromium", "Chrome", "Google Chrome Canary", "Aside Browser"]
    {
      let hello = try Self.decodeHello(label: generic)
      #expect(ChromeChannel.profileName(of: hello, browser: "Aside") == nil)
      #expect(ChromeChannel.label(of: hello, browser: "Aside") == "Aside")
    }

    let named = try Self.decodeHello(label: "Work")
    #expect(ChromeChannel.profileName(of: named, browser: "Aside") == "Work")
    #expect(ChromeChannel.label(of: named, browser: "Aside") == "Work")

    // Account email is never filtered even when profile.label is a generic brand.
    let withEmail = try Self.decodeHello(label: "Google Chrome", email: "user@example.com")
    #expect(ChromeChannel.profileName(of: withEmail, browser: "Aside") == "user@example.com")
    #expect(ChromeChannel.label(of: withEmail, browser: "Aside") == "user@example.com")
  }

  @Test("ChromeWelcome encodes verified browser name when present and omits nil")
  func welcomeEncodesBrowserName() throws {
    let welcome = ChromeWelcome(
      paired: false, installationId: "inst-1", label: nil, browser: "Aside",
      appVersion: "1.0.0", prefs: ChromePrefs(language: .english, glowEffects: true),
      sites: [], hostState: .ready)
    let json =
      try JSONSerialization.jsonObject(
        with: ChromeOutboundFrame.welcome(welcome).serialized()) as? [String: Any]
    #expect(json?["browser"] as? String == "Aside")
    #expect(json?["t"] as? String == "welcome")

    let omitted = ChromeWelcome(
      paired: false, installationId: "inst-1", label: nil,
      appVersion: "1.0.0", prefs: ChromePrefs(language: .english, glowEffects: true),
      sites: [], hostState: .ready)
    let omittedJSON =
      try JSONSerialization.jsonObject(
        with: ChromeOutboundFrame.welcome(omitted).serialized()) as? [String: Any]
    #expect(omittedJSON?["browser"] == nil)
  }

  @Test("Failed start() leaves zero NotificationCenter observers and resets manifest status")
  func failedStartDoesNotLeakObservers() throws {
    let root = FileManager.default.temporaryDirectory
      .appending(path: "atd-chrome-obs-\(UUID().uuidString)", directoryHint: .isDirectory)
    // Exceed Unix sockaddr_un sun_path limit (~104 bytes) so listener.start() deterministically fails.
    let tooLong = root.appending(
      path: String(repeating: "very-long-socket-segment-", count: 6), directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: tooLong, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    let channel = Self.makeChannel()
    channel.start(home: root, locationsDirectory: tooLong)
    #expect(channel.hostManifest == .failed)
    #expect(channel.installedBrowsers.isEmpty)
    #expect(channel.observerCount == 0)

    channel.start(home: root, locationsDirectory: tooLong)
    #expect(channel.observerCount == 0)
  }

  @Test("refreshHostManifests(force: true) during in-flight scan runs a fresh post-click scan")
  func forceRefreshDuringInFlightScanRunsSecondPass() async {
    let root = FileManager.default.temporaryDirectory
      .appending(path: "atd-chrome-refresh-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: root) }

    let calls = Mutex(0)
    let firstScanEntered = AsyncStream<Void>.makeStream()
    let releaseFirstScan = DispatchSemaphore(value: 0)

    let channel = Self.makeChannel()
    channel.configureManifestRefreshForTesting(
      bundleURL: URL(filePath: "/Applications/Atd.app"), hostExecutable: nil, home: root
    ) { _, _, _, _ in
      let index = calls.withLock { count -> Int in
        count += 1
        return count
      }
      if index == 1 {
        firstScanEntered.continuation.yield(())
        releaseFirstScan.wait()
        return .init(status: .installed, browsers: ["Google Chrome"])
      }
      return .init(status: .installed, browsers: ["Aside", "Google Chrome"])
    }

    let backgroundTask = Task { await channel.refreshHostManifests(force: false) }
    for await _ in firstScanEntered.stream { break }

    // Trigger manual Refresh while the first scan is still mid-flight.
    let forcedTask = Task { await channel.refreshHostManifests(force: true) }
    try? await Task.sleep(for: .milliseconds(20))
    releaseFirstScan.signal()

    await backgroundTask.value
    await forcedTask.value

    #expect(calls.withLock { $0 } == 2)
    #expect(channel.installedBrowsers == ["Aside", "Google Chrome"])
    channel.stop()
  }
}
