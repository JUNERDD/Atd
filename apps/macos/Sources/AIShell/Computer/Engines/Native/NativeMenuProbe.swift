import AICore
import ApplicationServices
import Foundation

/// Reads the admitted application's menu through AX without opening it, activating the app or
/// dispatching input. Menu labels can expose state even when the window is custom-drawn. Run off
/// the main actor, like NativeSurfaceProbe; neither another process nor the global menu is read.
nonisolated enum NativeMenuProbe {
  static func snapshot(pid: pid_t) -> [ComputerMenuItemWire]? {
    let read = Read(pid: pid)
    guard let menu = read.menu else { return nil }
    var items: [ComputerMenuItemWire] = []
    func walk(_ parent: AXUIElement, path: [String], enabled: Bool) {
      // Discovery shows immediate commands only; do not expand recent files or other submenus.
      guard path.count < 2, !read.expired else { return }
      for child in read.children(parent) {
        guard !read.expired, items.count < ComputerWireLimits.maxElements,
          let title = read.title(child)
        else { continue }
        let next = path + [title]
        let available = enabled && read.attribute(child, kAXEnabledAttribute) as? Bool == true
        if next.count >= 2 { items.append(.init(path: next, enabled: available)) }
        walk(child, path: next, enabled: available)
      }
    }
    walk(menu, path: [], enabled: true)
    return read.expired ? nil : items
  }

  /// A missing item is false; an unreadable or ambiguous menu is never evidence of state.
  static func available(pid: pid_t, path: [String]) -> Result<Bool, ComputerFailure> {
    let read = Read(pid: pid)
    guard var parent = read.menu else {
      return .failure(ComputerFailure(.unsupported, "The application menu is not readable."))
    }
    for title in path {
      let matches = read.children(parent).filter { read.title($0) == title }
      if read.expired {
        return .failure(ComputerFailure(.timeout, "The application menu did not answer in time."))
      }
      guard !matches.isEmpty else { return .success(false) }
      guard matches.count == 1, let item = matches.first else {
        return .failure(ComputerFailure(.ambiguous, "The menu path matches more than one item."))
      }
      guard read.attribute(item, kAXEnabledAttribute) as? Bool == true else {
        return .success(false)
      }
      parent = item
    }
    return .success(true)
  }

  /// The path of the one enabled menu item whose shortcut is `key` with exactly `modifiers`,
  /// read without opening a menu; nil when no item or more than one matches, or the menu did not
  /// answer in time. Submenus are searched three levels below the menu bar.
  static func shortcutPath(pid: pid_t, key: ComputerKeyName, modifiers: [ComputerModifier])
    -> [String]?
  {
    let read = Read(pid: pid)
    guard let menu = read.menu else { return nil }
    var found: [[String]] = []
    func walk(_ items: [AXUIElement], path: [String]) {
      for item in items {
        guard found.count < 2, !read.expired else { return }
        let values = read.attributes(item, itemAttributes)
        guard let title = values[0] as? String, !title.isEmpty, title.utf16.count <= 200,
          values[1] as? Bool == true
        else { continue }
        let next = path + [title]
        if let shortcut = shortcut(char: values[3], virtualKey: values[4], modifiers: values[5]),
          NativeKeyChord.matches(shortcut, key: key, modifiers: modifiers)
        {
          found.append(next)
        }
        guard next.count < 4, let children = values[2] as? [AXUIElement] else { continue }
        walk(
          children.flatMap { child in
            guard read.attribute(child, kAXRoleAttribute) as? String == kAXMenuRole else {
              return [child]
            }
            return read.attribute(child, kAXChildrenAttribute) as? [AXUIElement] ?? []
          }, path: next)
      }
    }
    walk(read.children(menu), path: [])
    return read.expired || found.count != 1 ? nil : found.first
  }

  /// What one request reads of a menu item: title, enabled, children and its shortcut.
  private static let itemAttributes = [
    kAXTitleAttribute, kAXEnabledAttribute, kAXChildrenAttribute, kAXMenuItemCmdCharAttribute,
    kAXMenuItemCmdVirtualKeyAttribute, kAXMenuItemCmdModifiersAttribute,
  ]

  private static func shortcut(char: CFTypeRef?, virtualKey: CFTypeRef?, modifiers: CFTypeRef?)
    -> NativeKeyChord.MenuShortcut?
  {
    let character = (char as? String).flatMap { $0.isEmpty ? nil : $0 }
    let code = (virtualKey as? NSNumber)?.intValue
    guard character != nil || code != nil else { return nil }
    return NativeKeyChord.MenuShortcut(
      character: character, virtualKey: code, modifiers: (modifiers as? NSNumber)?.intValue ?? 0)
  }

  private struct Read {
    let app: AXUIElement
    let deadline = ContinuousClock.now + .seconds(2)

    init(pid: pid_t) {
      app = AXUIElementCreateApplication(pid)
      AXUIElementSetMessagingTimeout(app, 0.1)
    }

    var expired: Bool { ContinuousClock.now >= deadline }

    var menu: AXUIElement? {
      guard let value = attribute(app, kAXMenuBarAttribute),
        CFGetTypeID(value) == AXUIElementGetTypeID()
      else { return nil }
      return (value as! AXUIElement)
    }

    func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
      guard !expired else { return nil }
      var value: CFTypeRef?
      guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
        return nil
      }
      return value
    }

    /// Several attributes of `element` in one request, in order; a missing one is nil.
    func attributes(_ element: AXUIElement, _ names: [String]) -> [CFTypeRef?] {
      let none = [CFTypeRef?](repeating: nil, count: names.count)
      guard !expired else { return none }
      var values: CFArray?
      guard
        AXUIElementCopyMultipleAttributeValues(
          element, names as CFArray, AXCopyMultipleAttributeOptions(rawValue: 0), &values)
          == .success,
        let array = values as [AnyObject]?, array.count == names.count
      else { return none }
      return array.map { value in
        if CFGetTypeID(value) == AXValueGetTypeID(),
          AXValueGetType(value as! AXValue) == .axError
        {
          return nil
        }
        return value
      }
    }

    func title(_ element: AXUIElement) -> String? {
      guard let title = attribute(element, kAXTitleAttribute) as? String,
        !title.isEmpty, title.utf16.count <= 200
      else { return nil }
      return title
    }

    /// AXMenu is a structural container; paths name menu-bar items and menu items only.
    func children(_ parent: AXUIElement) -> [AXUIElement] {
      var children = attribute(parent, kAXChildrenAttribute) as? [AXUIElement] ?? []
      // The first AX menu-bar child is the system Apple menu. It contains machine-wide
      // commands and recent items, so it is outside this application's target scope.
      if attribute(parent, kAXRoleAttribute) as? String == kAXMenuBarRole {
        children = Array(children.dropFirst())
      }
      return children.flatMap { child in
        if attribute(child, kAXRoleAttribute) as? String == kAXMenuRole {
          return attribute(child, kAXChildrenAttribute) as? [AXUIElement] ?? []
        }
        return [child]
      }
    }
  }
}
