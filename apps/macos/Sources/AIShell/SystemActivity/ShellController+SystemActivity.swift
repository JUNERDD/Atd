import AICore
import AIRelay
import AppKit
import OSLog

/// Idle reporting: while the shell is connected to the service it says how long the Mac has been
/// idle, which is what the service's idle automations wait for.
extension ShellController {
  private static let activityLog = Logger(subsystem: "com.junerdd.ai", category: "system-activity")

  /// Reports the idle time of the system, through the service link as it is for each report.
  static func makeSystemActivity(services: ShellServices) -> SystemActivityReporter {
    SystemActivityReporter(
      connect: { await services.link.systemActivityService() },
      idleSeconds: { SystemIdleTime.seconds() },
      report: { error in
        Self.activityLog.debug(
          "System activity was not reported: \(String(describing: error), privacy: .public)")
      })
  }

  /// A report right after the Mac wakes: the service's last one is minutes or hours old by then.
  func startSystemActivity() {
    NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
    ) { [weak self] _ in MainActor.assumeIsolated { self?.systemActivity.reportNow() } }
  }

  /// The control stream's state decides when to report: from every connection until it drops.
  func systemActivityConnectionChanged(_ state: ControlStreamClient.ConnectionState) {
    if state == .connected { systemActivity.start() } else { systemActivity.stop() }
  }
}
