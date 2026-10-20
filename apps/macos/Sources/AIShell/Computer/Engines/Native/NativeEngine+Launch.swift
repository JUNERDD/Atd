import AICore
import AppKit

/// Starting an application target that is not running (spec §11), for attended and unattended
/// runs alike: the bound copy opens without activation and without a prompt of its own. The
/// host never activates anything to hand focus back (plan I2); an app that brings itself
/// forward as it starts is logged, and like any target in front of the person it is in use only
/// while they type, click or scroll (`targetInUse`).
/// Resolving then waits for the app's first window.
extension NativeEngine {
  /// How long a started app may take to show its first window, within the request's deadline;
  /// resolving finds no window when it does not show one in time.
  static let launchWindowWait: Duration = .seconds(8)
  static let launchWindowPoll: Duration = .milliseconds(200)

  /// Starts the bound app in the background and returns its one running instance, checked
  /// against the binding (path, bundle id, team) like a running one.
  func launchInBackground(
    _ native: TargetBindingWire.Native, _ identity: NativeAppIdentity,
    until deadline: ContinuousClock.Instant
  ) async throws(ComputerFailure) -> NSRunningApplication {
    guard ContinuousClock.now < deadline else {
      throw ComputerFailure(.timeout, "\(native.appName) is not running and no time is left.")
    }
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = false
    configuration.addsToRecentItems = false
    configuration.promptsUserIfNeeded = false
    let launched: NSRunningApplication
    do {
      launched = try await NSWorkspace.shared.openApplication(
        at: URL(filePath: identity.path, directoryHint: .isDirectory),
        configuration: configuration)
    } catch {
      throw ComputerFailure(
        .targetUnavailable,
        "Needs preparing: \(native.appName) could not be started in the background "
          + "(\(error.localizedDescription)); open it on this Mac, then try again.")
    }
    let pid = launched.processIdentifier
    guard case .success(.running(let app)) = await NativeApplicationTarget.state(native),
      app.processIdentifier == pid
    else {
      throw ComputerFailure(
        .targetUnavailable,
        "\(native.appName) did not start as the copy that was chosen; open it on this Mac, then "
          + "try again.")
    }
    if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid {
      Self.log.notice(
        "\(identity.bundleId, privacy: .public) came forward as it started in the background.")
    }
    return app
  }

  /// Waits, within the request's deadline, until the process shows any window; choosing the
  /// root among them is the root-window rule's job.
  func awaitFirstWindow(pid: pid_t, start: UInt64, context: EngineResolveContext)
    async throws(ComputerFailure)
  {
    let end = min(ContinuousClock.now + Self.launchWindowWait, context.deadline)
    while true {
      try context.check()
      guard NativeTargetProbe.processStart(pid: pid) == start else { throw Self.changed }
      let shown = await NativeTargetProbe.detached {
        !NativeSurfaceProbe.windowIds(of: pid).isEmpty
      }
      try context.check()
      let now = ContinuousClock.now
      if shown || now >= end { return }
      do { try await Task.sleep(for: min(Self.launchWindowPoll, end - now)) } catch {
        throw ComputerFailure(.cancelled, "Waiting for the application's window was cancelled.")
      }
    }
  }
}
