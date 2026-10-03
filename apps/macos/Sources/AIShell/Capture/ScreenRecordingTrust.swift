import AppKit
import CoreGraphics

/// Whether this running app may capture the screen (Screen Recording), which screenshots need,
/// and the one place that asks for it: ``prompt()`` is the system prompt (at most once per launch,
/// since macOS shows it once per app and asking again would only reopen System Settings
/// uninvited), and ``openSystemSettings()`` is what the welcome guide's step offers.
///
/// macOS applies a new grant only to a relaunched app, so after the user allows the app in System
/// Settings ``isTrusted`` can stay false until the next launch. The state is re-read when the app
/// becomes active again, which is when the user comes back from System Settings, and ``onChange``
/// reports every change. Nothing polls: there is no system notification for this grant, and a
/// timer would only spend wakeups for a state that usually changes at a relaunch.
final class ScreenRecordingTrust {
  private(set) var isTrusted: Bool
  var onChange: ((Bool) -> Void)?

  private var promptedThisLaunch = false
  private var activation: NSObjectProtocol?

  private static let settingsURL = URL(
    string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")

  init() {
    isTrusted = CGPreflightScreenCaptureAccess()
  }

  func start() {
    activation = NotificationCenter.default.addObserver(
      forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.refresh() }
    }
    refresh()
  }

  /// The system prompt, at most once per launch, and none while the app already may capture.
  func prompt() {
    guard !isTrusted, !promptedThisLaunch else { return }
    promptedThisLaunch = true
    CGRequestScreenCaptureAccess()
  }

  /// `screenRecording.request`: the prompt under the same once-per-launch rule (it also lists the
  /// app in System Settings), then Privacy & Security › Screen & System Audio Recording.
  func openSystemSettings() {
    prompt()
    if let url = Self.settingsURL { NSWorkspace.shared.open(url) }
  }

  private func refresh() {
    let trusted = CGPreflightScreenCaptureAccess()
    guard trusted != isTrusted else { return }
    isTrusted = trusted
    onChange?(trusted)
  }
}
