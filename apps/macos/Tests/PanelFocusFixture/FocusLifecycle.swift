import AppKit

@testable import AIShell

/// Exercises reachable settings-window and pin transitions after the one-time panel setup.
/// The settings document is irrelevant: AppPresence sees a genuine key NSWindow closing while
/// the task panel survives. Preferences live in an isolated fixture suite and are removed.
@MainActor
enum FocusLifecycle {
  static func changePresence(release: Bool = false) async throws {
    let suite = "AtdPanelFocus.\(UUID().uuidString)"
    guard let defaults = UserDefaults(suiteName: suite) else {
      throw FocusError.failed("Cannot create fixture preference suite")
    }
    defer { defaults.removePersistentDomain(forName: suite) }
    let presence = AppPresence(defaults: defaults)
    let released = ReleaseFocusPresence(defaults: defaults)
    let frame = NSScreen.main?.visibleFrame ?? CGRect(x: 0, y: 0, width: 1200, height: 800)
    let settings = NSWindow(
      contentRect: CGRect(x: frame.maxX - 270, y: frame.maxY - 190, width: 240, height: 160),
      styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
    settings.isReleasedWhenClosed = false
    settings.title = "Atd fixture settings lifecycle"
    defer { settings.close() }
    let closeAction = FocusSettingsCloseAction {
      if release {
        released.applyDockVisibility(windowOpen: false, restoreFocus: false)
      } else {
        presence.applyDockVisibility(windowOpen: false, closingWindow: settings)
      }
    }
    settings.delegate = closeAction
    if release {
      released.setShowInDock(false, windowOpen: true)
    } else {
      presence.setShowInDock(false, windowOpen: true)
    }
    // Exact SettingsWindowController.open ordering: activate before taking the key window.
    NSApp.activate()
    settings.makeKeyAndOrderFront(nil)
    guard
      try await FocusEvents.wait(until: {
        NSApp.activationPolicy() == .regular && settings.isKeyWindow && NSApp.isActive
      })
    else {
      throw FocusError.failed(
        "Fixture settings did not open: policy=\(NSApp.activationPolicy().rawValue), "
          + "active=\(NSApp.isActive), key=\(settings.isKeyWindow), visible=\(settings.isVisible), "
          + "frontmost=\(NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid())")
    }
    // Matches ShellController.settingsOpenChanged during the real windowWillClose callback.
    withExtendedLifetime(closeAction) { settings.close() }
    guard NSApp.activationPolicy() == .accessory else {
      throw FocusError.failed("AppPresence did not return to accessory policy")
    }
  }

  static func changeGlassVariant(_ panel: NSPanel, cycle: Int) throws {
    guard #available(macOS 26, *), let glass = panel.contentView as? NSGlassEffectView else {
      throw FocusError.failed("Clear variant requires native NSGlassEffectView")
    }
    // Exact GlassSurface.applyVariant operation, without writing shared PanelBackground defaults.
    let style: NSGlassEffectView.Style = cycle % 3 == 1 ? .clear : .regular
    if glass.style != style { glass.style = style }
  }

  static func glassVariant(_ panel: NSPanel) -> String {
    guard #available(macOS 26, *), let glass = panel.contentView as? NSGlassEffectView else {
      return "unavailable"
    }
    return glass.style == .clear ? "clear" : "regular"
  }

  static func changePin(_ panel: NSPanel, cycle: Int) {
    // Exact PanelWindowController.setPinned operations, after click activation is configured.
    let pinned = cycle.isMultiple(of: 2)
    panel.isFloatingPanel = pinned
    panel.level = pinned ? .floating : .normal
  }
}

/// Both released and HEAD controllers invoke presence while their departing window may be key.
@MainActor
private final class FocusSettingsCloseAction: NSObject, NSWindowDelegate {
  private let action: () -> Void
  init(_ action: @escaping () -> Void) { self.action = action }
  func windowWillClose(_ notification: Notification) {
    (notification.object as? NSWindow)?.delegate = nil
    action()
  }
}

struct FocusPresenceClosure: Codable {
  let cycle: Int
  let version: String
  let immediate: FocusPresenceState
  let settled: FocusPresenceState
}

struct FocusPresenceState: Codable {
  let appActive: Bool
  let panelKey: Bool
  let peerFrontmost: Bool
  let fixtureFrontmost: Bool
  let responder: String
  let page: FocusPageState
}
