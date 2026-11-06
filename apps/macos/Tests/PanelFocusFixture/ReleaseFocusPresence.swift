import AppKit

/// Fixture-only copy of v0.10.6 AppPresence's Dock-policy methods. Its Settings-close caller
/// supplied restoreFocus:false, unlike the already-existing HEAD fix in 145500a3. Login items
/// and user preferences outside this isolated fixture suite are deliberately excluded.
@MainActor
final class ReleaseFocusPresence {
  private let defaults: UserDefaults
  private static let showInDockKey = "app.showInDock"

  init(defaults: UserDefaults) { self.defaults = defaults }
  var showInDock: Bool { defaults.bool(forKey: Self.showInDockKey) }

  func setShowInDock(_ show: Bool, windowOpen: Bool) {
    defaults.set(show, forKey: Self.showInDockKey)
    applyDockVisibility(windowOpen: windowOpen)
  }

  func applyDockVisibility(windowOpen: Bool, restoreFocus: Bool = true) {
    Self.applyShowInDock(showInDock || windowOpen, restoreFocus: restoreFocus)
  }

  private static func applyShowInDock(_ show: Bool, restoreFocus: Bool) {
    let policy: NSApplication.ActivationPolicy = show ? .regular : .accessory
    guard NSApp.activationPolicy() != policy else { return }
    let focused = NSApp.keyWindow
    NSApp.setActivationPolicy(policy)
    if !show, restoreFocus, let focused, focused.isVisible {
      NSApp.activate()
      focused.makeKeyAndOrderFront(nil)
    }
  }
}
