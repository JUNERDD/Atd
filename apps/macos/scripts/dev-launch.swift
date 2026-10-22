import AppKit
import Darwin
import Foundation

/// LaunchServices owns the launch; this helper retains only the new application it returned.
/// Keeping that object avoids adopting another app after an exit or a reused process identifier.
@MainActor
final class DevAppLaunch {
  private var input: DispatchSourceRead?
  private var stopping = false

  func run() async {
    signal(SIGPIPE, SIG_IGN)
    watchSupervisor()
    // A supervisor cancelled while Swift was loading closes stdin before the launch begins.
    await Task.yield()
    guard !stopping else {
      emit(["kind": "notStarted"])
      return
    }
    guard CommandLine.arguments.count == 4 else {
      emit(["kind": "error", "message": "Invalid development launch arguments."])
      return
    }
    let arguments = CommandLine.arguments
    guard NSRunningApplication.runningApplications(withBundleIdentifier: arguments[2]).isEmpty
    else {
      emit(["kind": "error", "message": "Another Debug app is already running."])
      return
    }
    let configuration = NSWorkspace.OpenConfiguration()
    do {
      configuration.environment = try JSONDecoder().decode(
        [String: String].self, from: Data(arguments[3].utf8))
    } catch {
      emit(["kind": "error", "message": "Invalid development launch environment."])
      return
    }
    // Never receive an existing instance if another app starts after the check above.
    configuration.createsNewApplicationInstance = true
    let application: NSRunningApplication
    do {
      application = try await NSWorkspace.shared.openApplication(
        at: URL(fileURLWithPath: arguments[1]), configuration: configuration)
    } catch {
      emit(["kind": "error", "message": error.localizedDescription])
      return
    }
    let pid = application.processIdentifier
    let launchDate = application.launchDate
    // Report ownership even when cancellation arrived while LaunchServices was starting the app.
    emit(["kind": "started", "pid": pid])
    var stopAttempted = false
    while !application.isTerminated {
      if stopping, !stopAttempted {
        stopAttempted = true
        stop(application, pid: pid, launchDate: launchDate)
      }
      try? await Task.sleep(for: .milliseconds(100))
    }
    emit(["kind": "exited"])
    input?.cancel()
  }

  /// QuitGuard handles SIGTERM as an unattended quit and runs normal cleanup. A Quit Apple event
  /// would ask about active work; never replace that with a forced exit after a cancelled prompt.
  private func stop(_ application: NSRunningApplication, pid: pid_t, launchDate: Date?) {
    guard !application.isTerminated else { return }
    guard pid > 0, application.processIdentifier == pid, let launchDate,
      let current = NSRunningApplication(processIdentifier: pid),
      current.isEqual(application), current.launchDate == launchDate
    else {
      emit([
        "kind": "error", "message": "Cannot confirm the owned Debug app identity; not signalling.",
      ])
      return
    }
    if kill(pid, SIGTERM) != 0, errno != ESRCH {
      emit(["kind": "error", "message": "Could not send SIGTERM to the owned Debug app."])
    }
    // Only isTerminated settles ownership. Failed or delayed cleanup keeps the helper and lock;
    // there is no force-kill or lookup of a replacement application.
  }

  /// EOF means an explicit stop or the supervisor died. A cancelled launch still waits for its
  /// LaunchServices answer, then terminates the exact returned app before this helper exits.
  private func watchSupervisor() {
    let source = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .global())
    source.setEventHandler { [weak self] in
      var byte: UInt8 = 0
      if read(STDIN_FILENO, &byte, 1) <= 0 {
        Task { @MainActor [weak self] in
          self?.stopping = true
          self?.input?.cancel()
        }
      }
    }
    input = source
    source.resume()
  }

  private func emit(_ value: [String: Any]) {
    guard var data = try? JSONSerialization.data(withJSONObject: value) else { return }
    data.append(0x0A)
    try? FileHandle.standardOutput.write(contentsOf: data)
  }
}

Task { @MainActor in
  await DevAppLaunch().run()
  exit(0)
}
// NSRunningApplication refreshes isTerminated only when the main run loop advances.
RunLoop.main.run()
