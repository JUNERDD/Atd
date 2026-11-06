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
  /// closes; the override is never saved. A closing window can still be key during
  /// `windowWillClose`, so exclude it when preserving focus through a policy change.
  func applyDockVisibility(windowOpen: Bool, closingWindow: NSWindow? = nil) {
    Self.applyShowInDock(showInDock || windowOpen, closingWindow: closingWindow)
  }

  /// Info.plist starts the app as an agent (`LSUIElement`), so a hidden Dock icon never
  /// flashes at launch; showing it turns the app into a regular one at runtime. Becoming an
  /// agent again deactivates the app, so preserve the keyboard target or its surviving successor.
  private static func applyShowInDock(_ show: Bool, closingWindow: NSWindow?) {
    let policy: NSApplication.ActivationPolicy = show ? .regular : .accessory
    guard NSApp.activationPolicy() != policy else { return }
    let focused = focusTarget(excluding: closingWindow)
    guard NSApp.setActivationPolicy(policy) else { return }
    if !show, let focused {
      NSApp.activate()
      focused.makeKeyAndOrderFront(nil)
    }
  }

  private static func focusTarget(excluding closingWindow: NSWindow?) -> NSWindow? {
    // A background close must not activate the app, even when its non-activating task panel
    // currently receives the keyboard while another application owns the menu bar.
    if closingWindow != nil, !NSApp.isActive { return nil }
    func isEligible(_ window: NSWindow) -> Bool {
      window !== closingWindow && window.isVisible && !window.isMiniaturized
        && window.canBecomeKey && window.alphaValue > 0 && !window.ignoresMouseEvents
        && window.isOnActiveSpace
    }
    if let key = NSApp.keyWindow, isEligible(key) { return key }
    // Closing the foreground window transfers focus within the app; the resident task panel's
    // alpha-zero state must stay hidden.
    guard closingWindow != nil else { return nil }
    // `orderedWindows` is a scripting API that excludes panels. Window numbers include the
    // task panel and preserve front-to-back order on the active Space.
    for number in NSWindow.windowNumbers(options: []) ?? [] {
      if let window = NSApp.window(withWindowNumber: number.intValue), isEligible(window) {
        return window
      }
    }
    return nil
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
