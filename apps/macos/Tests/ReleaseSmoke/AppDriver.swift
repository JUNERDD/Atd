import AppKit
import Foundation

/// A test-only LaunchServices driver. It neither automates other apps nor changes TCC settings.
@main
enum AppDriver {
  struct DriverError: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
  }

  @MainActor
  static func main() async {
    do {
      let arguments = Array(CommandLine.arguments.dropFirst())
      guard arguments.count >= 3 else {
        throw DriverError("Expected launch|inspect|quit <app> <data-directory> [owned-pid]")
      }
      let appURL = URL(fileURLWithPath: arguments[1]).resolvingSymlinksInPath()
      guard let bundle = Bundle(url: appURL),
        bundle.bundleIdentifier == "com.junerdd.ai"
      else { throw DriverError("The target must be a Release Atd.app") }
      let application: NSRunningApplication
      if arguments[0] == "launch" {
        guard
          NSRunningApplication.runningApplications(withBundleIdentifier: "com.junerdd.ai")
            .isEmpty
        else { throw DriverError("An Atd instance already exists; refusing to inspect or stop it") }
        guard !NSScreen.screens.isEmpty else {
          throw DriverError("No desktop display is available")
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        // Volatile UserDefaults arguments keep Sparkle from replacing the package under test.
        configuration.arguments = [
          "-SUEnableAutomaticChecks", "NO", "-SUAutomaticallyUpdate", "NO",
        ]
        configuration.environment = [
          "AI_AGENT_DATA_DIR": arguments[2],
          "AI_ATD_HOME": URL(fileURLWithPath: arguments[2]).appending(path: "atd").path,
          "PI_OFFLINE": "1",
        ]
        application = try await NSWorkspace.shared.openApplication(
          at: appURL, configuration: configuration)
        // Persist ownership before any subsequent check can fail or time out.
        try String(application.processIdentifier).write(
          to: URL(fileURLWithPath: arguments[2]).appending(path: "smoke-app.pid"),
          atomically: true, encoding: .utf8)
      } else {
        guard arguments.count == 4, let pid = Int32(arguments[3]), pid > 1 else {
          throw DriverError("An owned application PID is required")
        }
        guard let running = NSRunningApplication(processIdentifier: pid), !running.isTerminated
        else {
          try emit(["running": false])
          return
        }
        application = running
      }
      guard application.bundleURL?.resolvingSymlinksInPath() == appURL else {
        throw DriverError("The PID belongs to a different application")
      }
      switch arguments[0] {
      case "launch", "inspect":
        try emit([
          "running": !application.isTerminated,
          "pid": application.processIdentifier,
          "x86_64": application.executableArchitecture == NSBundleExecutableArchitectureX86_64,
          "finishedLaunching": application.isFinishedLaunching,
          "visibleWindows": visibleWindowCount(pid: application.processIdentifier),
          "displays": NSScreen.screens.count,
          "captureAuthorized": CGPreflightScreenCaptureAccess(),
        ])
      case "quit":
        guard application.terminate() else {
          throw DriverError("The app refused normal termination")
        }
        try emit(["quitRequested": true])
      default:
        throw DriverError("Unknown driver action")
      }
    } catch {
      FileHandle.standardError.write(Data("AppDriver: \(error)\n".utf8))
      exit(1)
    }
  }

  private static func emit(_ value: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data + Data("\n".utf8))
  }

  /// Window presence is not a renderer-ready assertion. No titles or other apps' details leave here.
  private static func visibleWindowCount(pid: Int32) -> Int {
    guard
      let windows = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
    else { return 0 }
    return windows.filter { window in
      guard let owner = window[kCGWindowOwnerPID as String] as? Int32,
        owner == pid,
        let bounds = window[kCGWindowBounds as String] as? NSDictionary,
        let rectangle = CGRect(dictionaryRepresentation: bounds)
      else { return false }
      return rectangle.width >= 100 && rectangle.height >= 50
    }.count
  }
}
