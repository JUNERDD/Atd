import AICore
import AppKit

/// The menu bar status item: the second way to the panel
/// beside the shortcut, and the one that stays reachable while the Dock icon is hidden. A click
/// toggles the panel; a right-click or Control/Option-click opens the app menu. The image and
/// tooltip follow the service's reachability and its root-task counts.
///
/// The images are the App target's `<state>Template` image sets, exported at 1x and 2x from the
/// Figma component set `1562:59933`; re-export them from Figma instead of editing them. The
/// `Template` suffix makes macOS tint them for the menu bar appearance.
/// Debug uses wider `<state>DevTemplate` exports that include the DEV label.
final class StatusItemController: NSObject {
  #if DEBUG
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  #else
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
  #endif
  private let toggle: () -> Void
  private let menu: () -> NSMenu
  private var shown: MenuBarState?
  private var status = MenuBarStatus(availability: .connecting, running: 0, attention: 0)

  /// `menu` builds the item's menu on every open, so it reflects the current state.
  init(toggle: @escaping () -> Void, menu: @escaping () -> NSMenu) {
    self.toggle = toggle
    self.menu = menu
    super.init()
    item.button?.target = self
    item.button?.action = #selector(clicked)
    item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
    update(status)
    NotificationCenter.default.addObserver(
      self, selector: #selector(languageChanged), name: ShellStrings.didChange, object: nil)
  }

  func update(_ status: MenuBarStatus) {
    self.status = status
    #if DEBUG
      let imageName = "\(status.state.rawValue)DevTemplate"
    #else
      let imageName = "\(status.state.rawValue)Template"
    #endif
    if status.state != shown, let image = NSImage(named: imageName) {
      // The asset catalog renders these as template images, tinted for the menu bar.
      image.isTemplate = true
      item.button?.image = image
      shown = status.state
    }
    item.button?.toolTip = Self.tooltip(status)
    item.button?.setAccessibilityLabel(Self.tooltip(status))
  }

  /// `Atd · 2 running · 1 waiting for you`, or the service problem.
  static func tooltip(_ status: MenuBarStatus) -> String {
    let strings = ShellStrings.shared
    var parts = [strings.text(.appName)]
    #if DEBUG
      parts[0] += " DEV"
    #endif
    if status.state == .unavailable {
      parts.append(
        strings.text(status.developmentHint ? .statusDevelopmentHint : .statusUnavailable))
    } else {
      if status.running > 0 { parts.append(strings.text(.statusRunning, count: status.running)) }
      if status.attention > 0 {
        parts.append(strings.text(.statusAttention, count: status.attention))
      }
    }
    return parts.joined(separator: " · ")
  }

  @objc private func clicked() {
    guard let event = NSApp.currentEvent else { return toggle() }
    let wantsMenu =
      event.type == .rightMouseUp || !event.modifierFlags.intersection([.control, .option]).isEmpty
    guard wantsMenu else { return toggle() }
    // Attaching the menu for one click keeps left clicks free for the toggle.
    item.menu = menu()
    item.button?.performClick(nil)
    item.menu = nil
  }

  @objc private func languageChanged() { update(status) }
}
