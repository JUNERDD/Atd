import AppKit
import ApplicationServices

/// Opt-in WindowServer integration probe. Its peer is another process, not another window in
/// this app: an in-process NSEvent/postEvent probe cannot establish cross-app activation.
@main
struct PanelFocusFixture {
  @MainActor
  static func main() {
    let app = NSApplication.shared
    let arguments = CommandLine.arguments
    let peer = arguments.count == 3 && arguments[1] == "peer"
    let regular = peer || (arguments.count == 7 && arguments[3] == "regular")
    app.setActivationPolicy(regular ? .regular : .accessory)
    let delegate = FocusAppDelegate(arguments: arguments)
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
  }

  @MainActor
  static func start(_ arguments: [String]) {
    Task {
      do {
        guard arguments.count == 7, let mode = FocusMode(rawValue: arguments[1]),
          let cycles = Int(arguments[6]), (1...100).contains(cycles),
          ["system", "tuned"].contains(arguments[2]),
          ["accessory", "regular"].contains(arguments[3]),
          ["visible", "summon", "presence", "pinned", "release-policy", "head-policy", "clear"]
            .contains(
              arguments[4]),
          ["off", "static", "active"].contains(arguments[5])
        else {
          throw FocusError.failed(
            "Expected mode, tuning, activation policy, scenario, and 1...100 cycles")
        }
        // Never request a TCC grant. A denied run is explicitly inconclusive, not a pass.
        guard CGPreflightPostEventAccess() else {
          try emit(FocusResult(status: "blocked-event-permission", mode: mode.rawValue))
          exit(0)
        }
        let result = try await run(
          mode: mode, tuned: arguments[2] == "tuned", scenario: arguments[4],
          pageGlass: arguments[5],
          cycles: cycles)
        try emit(result)
        exit(0)
      } catch {
        FileHandle.standardError.write(Data("Panel focus fixture: \(error)\n".utf8))
        exit(1)
      }
    }
  }

  @MainActor
  private static func run(
    mode: FocusMode, tuned: Bool, scenario: String, pageGlass: String, cycles: Int
  ) async throws
    -> FocusResult
  {
    let previous = NSWorkspace.shared.frontmostApplication
    let fixture = try FocusPanel(mode: mode, tuned: tuned, pageGlass: pageGlass)
    signal(SIGTERM, SIG_IGN)
    let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    termination.setEventHandler {
      MainActor.assumeIsolated {
        let restore = fixture.ownsFocus
        fixture.close()
        if restore { previous?.activate(options: []) }
      }
      exit(124)
    }
    termination.resume()
    defer {
      termination.cancel()
      let restore = fixture.ownsFocus
      fixture.close()
      if restore { previous?.activate(options: []) }
    }
    return try await fixture.run(cycles: cycles, scenario: scenario)
  }

  private static func emit(_ result: FocusResult) throws {
    FileHandle.standardOutput.write(try JSONEncoder().encode(result))
  }
}

@MainActor
private final class FocusAppDelegate: NSObject, NSApplicationDelegate {
  private let arguments: [String]
  private var peer: FocusPeer?

  init(arguments: [String]) { self.arguments = arguments }

  func applicationDidFinishLaunching(_ notification: Notification) {
    if arguments.count == 3, arguments[1] == "peer" {
      peer = FocusPeer(snapshotURL: URL(fileURLWithPath: arguments[2]))
    } else {
      PanelFocusFixture.start(arguments)
    }
  }
}

enum FocusMode: String { case native, fallback, legacy, regular }

enum FocusError: Error { case failed(String) }

struct FocusResult: Codable {
  var status: String
  var mode: String
  var samples: [FocusSample] = []
  var webContentTerminations = 0
  var bridgeDeliveryFailures = 0
  var presenceClosures: [FocusPresenceClosure] = []
}

struct FocusSample: Codable {
  let cycle: Int
  let field: String
  let phase: String
  let outerGlassStyle: String
  let peerFrontmost: Bool
  let appActive: Bool
  let windowKey: Bool
  let responder: String
  let nativeMouseDowns: Int
  let nativeKeyDowns: Int
  let elapsedMilliseconds: Double
  let beforePage: FocusPageState
  let page: FocusPageState
  var passed: Bool {
    (phase == "summon" ? peerFrontmost : appActive)
      && windowKey && page.focused && page.active == field && page.length == 1
  }
}

struct FocusPageState: Codable {
  let active: String
  let focused: Bool
  let length: Int
  let pointerDowns: Int
  let keyDowns: Int
  let bridgeEvents: Int
  let windowActive: String
  let visualEffect: String
  let supportsGlass: Bool
  let hitIsTarget: Bool
}

struct FocusPeerState: Codable {
  let pid: Int32
  let x: Double
  let y: Double
  let active: Bool
  let key: Bool
  let characters: Int
}
