import AppKit
import ApplicationServices
import Synchronization

/// Standard editing commands, located by their shortcuts rather than app names or translated
/// labels. Availability is only a hint for an opaque editor: callers must first rule out a
/// native empty text selection and non-editor controls. Discovery reads no text or clipboard;
/// only an explicit selection capture may invoke the Copy command.
nonisolated struct SelectionEditMenu {
  struct CopyCommand: @unchecked Sendable {
    fileprivate let item: AXUIElement

    /// Invoke the command without keyboard events, so held shortcut modifiers cannot alter it.
    /// A timeout may still have dispatched the action; do not post a second copy in that case.
    func perform() -> Bool {
      let result = AXUIElementPerformAction(item, kAXPressAction as CFString)
      return result == .success || result == .cannotComplete
    }
  }

  private struct Menu: @unchecked Sendable {
    let pid: pid_t
    // AX handles are immutable and support reads from any thread. Only handles are cached;
    // enabled state must be read again for each selection or write target.
    let items: [String: AXUIElement]
    let expires: ContinuousClock.Instant
  }

  private static let menu = Mutex<Menu?>(nil)
  private let pid: pid_t
  private let app: AXUIElement
  private let deadline: ContinuousClock.Instant

  init?(_ focused: AXUIElement, limit: Duration = .milliseconds(200)) {
    var pid: pid_t = 0
    guard AXUIElementGetPid(focused, &pid) == .success
    else { return nil }
    self.init(pid: pid, limit: limit)
  }

  private init(pid: pid_t, limit: Duration) {
    deadline = .now + limit
    self.pid = pid
    app = AXUIElementCreateApplication(pid)
  }

  var hasSelection: Bool { enabled("c") == true }

  /// A disabled Paste can mean an incompatible clipboard, rather than a read-only field.
  /// Only a positively enabled Cut or Paste supplies writability evidence.
  var writable: Bool {
    enabled("x") == true || enabled("v") == true
  }

  private func item(_ key: String) -> AXUIElement? {
    let cached = Self.menu.withLock { $0 }
    let items =
      if let cached, cached.pid == pid, .now < cached.expires { cached.items } else { findItems() }
    return items?[key]
  }

  private func enabled(_ key: String) -> Bool? {
    guard let item = item(key) else { return nil }
    let enabled = attribute(item, kAXEnabledAttribute) as? Bool
    if enabled == nil { Self.menu.withLock { if $0?.pid == pid { $0 = nil } } }
    return enabled
  }

  /// Resolve off the main thread before claiming input. The caller must recheck the foreground
  /// app before invoking it, and own the clipboard snapshot for the entire copy transaction.
  static func copyCommand(pid: pid_t) -> CopyCommand? {
    let menu = SelectionEditMenu(pid: pid, limit: .milliseconds(200))
    guard let item = menu.item("c"), menu.attribute(item, kAXEnabledAttribute) as? Bool == true
    else { return nil }
    var actions: CFArray?
    guard AXUIElementCopyActionNames(item, &actions) == .success,
      (actions as? [String])?.contains(kAXPressAction) == true
    else { return nil }
    return CopyCommand(item: item)
  }

  /// Locates the three standard Edit commands once. A selection check then costs a single
  /// enabled-state read instead of walking the menu while the toolbar waits.
  private func findItems() -> [String: AXUIElement]? {
    guard let menu = attribute(app, kAXMenuBarAttribute) else { return nil }
    guard CFGetTypeID(menu) == AXUIElementGetTypeID() else { return nil }
    var items: [String: AXUIElement] = [:]
    // Only the app's immediate commands; skip the Apple menu and do not inspect submenus
    // (recent documents, services, etc.). Match the shortcut, independent of UI language.
    for heading in children(menu as! AXUIElement).dropFirst() {
      for container in children(heading) {
        for item in children(container) {
          guard ContinuousClock.now < deadline else { return nil }
          AXUIElementSetMessagingTimeout(item, SelectionPresence.messagingTimeout)
          var values: CFArray?
          let names = [kAXMenuItemCmdCharAttribute, kAXMenuItemCmdModifiersAttribute]
          guard
            AXUIElementCopyMultipleAttributeValues(
              item, names as CFArray, AXCopyMultipleAttributeOptions(rawValue: 0), &values)
              == .success,
            let values = values as? [Any], values.count == names.count,
            let key = (values[0] as? String)?.lowercased(), ["c", "x", "v"].contains(key),
            values[1] as? Int == 0
          else { continue }
          // Ambiguous shortcuts are not evidence; do not pick whichever item came first.
          guard items[key] == nil else { return nil }
          items[key] = item
        }
      }
    }
    guard items["c"] != nil else { return nil }
    Self.menu.withLock {
      $0 = Menu(pid: pid, items: items, expires: .now + .seconds(30))
    }
    return items
  }

  /// Called off the main thread when the app comes forward, before a selection gesture.
  static func prepare(pid: pid_t) {
    let menu = SelectionEditMenu(pid: pid, limit: .milliseconds(750))
    _ = menu.enabled("c")
  }

  private func children(_ element: AXUIElement) -> [AXUIElement] {
    attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
  }

  private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    guard ContinuousClock.now < deadline else { return nil }
    AXUIElementSetMessagingTimeout(element, SelectionPresence.messagingTimeout)
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
      return nil
    }
    return value
  }
}
