import AppKit
import ServiceManagement

/// The saved Dock preference and its temporary override while the welcome guide or the settings
/// window is open, plus Open at Login.
final class AppPresence {
  private let defaults: UserDefaults
  private static let showInDockKey = "app.showInDock"

  init(defaults: UserDefaults) { self.defaults = defaults }

  /// The user's preference, even while an open guide or settings window keeps the Dock icon.
  var showInDock: Bool { defaults.bool(forKey: Self.showInDockKey) }

  func setShowInDock(_ show: Bool, windowOpen: Bool) {
    defaults.set(show, forKey: Self.showInDockKey)
    applyDockVisibility(windowOpen: windowOpen)
  }

  /// Recomputes from the latest preference when the guide or the settings window opens or
  /// closes; the override is never saved. A closing window disables focus restoration because it
  /// can still be key.
  func applyDockVisibility(windowOpen: Bool, restoreFocus: Bool = true) {
    Self.applyShowInDock(showInDock || windowOpen, restoreFocus: restoreFocus)
  }

  /// Info.plist starts the app as an agent (`LSUIElement`), so a hidden Dock icon never
  /// flashes at launch; showing it turns the app into a regular one at runtime. Becoming an
  /// agent again deactivates the app, so the window the user was in comes back to the front.
  private static func applyShowInDock(_ show: Bool, restoreFocus: Bool) {
    let policy: NSApplication.ActivationPolicy = show ? .regular : .accessory
    guard NSApp.activationPolicy() != policy else { return }
    let focused = NSApp.keyWindow
    FocusDiagnostics.shared.record("presence.policy.before", details: ["regular": .bool(show)])
    NSApp.setActivationPolicy(policy)
    FocusDiagnostics.shared.record("presence.policy.after", details: ["regular": .bool(show)])
    if !show, restoreFocus, let focused, focused.isVisible {
      NSApp.activate()
      focused.makeKeyAndOrderFront(nil)
    }
  }

  /// Opening at login registers the app bundle with `SMAppService.mainApp`. The system's
  /// login item is the only record, so a change in System Settings is what the next read
  /// shows. Debug builds do not offer it: they would register a DerivedData bundle.
  static var loginItemSupported: Bool {
    #if DEBUG
      false
    #else
      true
    #endif
  }

  /// The state to show: on only when the system will actually open the app at login.
  static var opensAtLogin: Bool? {
    loginItemSupported ? SMAppService.mainApp.status == .enabled : nil
  }

  /// Registers or removes the login item and returns the applied state. An item waiting for
  /// the user's approval reads as off and opens Login Items in System Settings.
  static func setOpensAtLogin(_ enabled: Bool) throws -> Bool {
    guard loginItemSupported else {
      throw LoginItemError("Opening at login needs the installed app.")
    }
    let service = SMAppService.mainApp
    do {
      if enabled {
        if service.status != .enabled { try service.register() }
      } else if service.status != .notRegistered {
        try service.unregister()
      }
    } catch {
      if service.status != .requiresApproval {
        throw LoginItemError("The system did not update the login items.")
      }
    }
    if enabled, service.status == .requiresApproval {
      SMAppService.openSystemSettingsLoginItems()
    }
    return service.status == .enabled
  }

  /// True when the system opened this launch as a login item; the panel then stays hidden.
  static func launchedAtLogin() -> Bool {
    guard let event = NSAppleEventManager.shared().currentAppleEvent else { return false }
    return event.eventID == kAEOpenApplication
      && event.paramDescriptor(forKeyword: keyAEPropData)?.enumCodeValue == keyAELaunchedAsLogInItem
  }

  struct LoginItemError: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
  }
}

/// One running copy per bundle id. A second launch (a double-click while the app runs, or the
/// binary started by hand) asks the first to show its panel and exits before it touches
/// anything, so two shells never race for hot keys or the service.
enum SingleInstance {
  private static var notification: Notification.Name {
    Notification.Name("\(Bundle.main.bundleIdentifier ?? "com.junerdd.ai").showPanel")
  }

  /// Exits when another instance with this bundle id runs.
  static func ensureOnlyInstance() {
    guard let bundleID = Bundle.main.bundleIdentifier else { return }
    let current = ProcessInfo.processInfo.processIdentifier
    let others = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
      .filter { $0.processIdentifier != current && !$0.isTerminated }
    guard let running = others.first else { return }
    DistributedNotificationCenter.default().postNotificationName(
      notification, object: nil, userInfo: nil, deliverImmediately: true)
    running.activate()
    exit(0)
  }

  /// Runs `showPanel` when a later launch asks for it.
  static func observeLaterLaunches(_ showPanel: @escaping @MainActor () -> Void) {
    DistributedNotificationCenter.default().addObserver(
      forName: notification, object: nil, queue: .main
    ) { _ in
      MainActor.assumeIsolated { showPanel() }
    }
  }
}
