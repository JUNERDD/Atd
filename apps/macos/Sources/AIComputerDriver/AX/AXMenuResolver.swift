import AIComputerDriverKit
import ApplicationServices
import Foundation

/// Resolves a menu-bar path (for example `["File", "Save"]`) and presses the leaf item WITHOUT
/// opening any menu level. Opening a menu steals key focus and orders the menu window to front;
/// pressing the resolved leaf delivers the command the user's click would have, with no visible
/// menu (plan §2.1). Follows the open-computer-use / Cua `invoke_menu` recipe (MIT).
enum AXMenuResolver {
  /// Walk `path` down the app's `AXMenuBar` and press the leaf. Throws `menuUnavailable` when any
  /// level is missing or the leaf is disabled in the background.
  static func press(appElement: AXUIElement, path: [String]) throws {
    guard !path.isEmpty else {
      throw DriverFailure(code: .menuUnavailable, message: "empty menu path")
    }
    guard let menuBar = AXBindings.copyElement(appElement, kAXMenuBarAttribute as String) else {
      throw DriverFailure(code: .menuUnavailable, message: "app exposes no AXMenuBar")
    }
    var container = menuBar
    for (depth, title) in path.enumerated() {
      guard let match = child(of: container, title: title) else {
        throw DriverFailure(
          code: .menuUnavailable, message: "menu item '\(title)' not found at depth \(depth)")
      }
      if depth == path.count - 1 {
        try pressLeaf(match)
        return
      }
      // Descend into the item's submenu (a single AXMenu child) without opening it.
      guard let submenu = AXBindings.copyElements(match, kAXChildrenAttribute as String).first
      else {
        throw DriverFailure(
          code: .menuUnavailable, message: "menu item '\(title)' has no submenu to descend")
      }
      container = submenu
    }
  }

  private static func child(of container: AXUIElement, title: String) -> AXUIElement? {
    for item in AXBindings.copyElements(container, kAXChildrenAttribute as String) {
      if AXBindings.copyString(item, kAXTitleAttribute as String) == title { return item }
      // Menu items nest an AXMenu whose own children are the next level; the title lives on the
      // item, so a direct title match above is the common path. Also check one level of AXMenu.
      if AXBindings.copyString(item, kAXRoleAttribute as String) == (kAXMenuRole as String),
        let nested = child(of: item, title: title)
      {
        return nested
      }
    }
    return nil
  }

  private static func pressLeaf(_ item: AXUIElement) throws {
    if AXBindings.copyBool(item, kAXEnabledAttribute as String) == false {
      throw DriverFailure(
        code: .menuUnavailable, message: "menu leaf is disabled in the background")
    }
    // As with element presses, a menu leaf can return `kAXErrorFailure` for a press that fired, so
    // `dispatched` accepts it; a truly unusable leaf still throws `menuUnavailable`.
    let error = AXUIElementPerformAction(item, kAXPressAction as CFString)
    guard AXActions.dispatched(error) else {
      throw DriverFailure(
        code: .menuUnavailable, message: "menu leaf press failed (AXError \(error.rawValue))")
    }
  }
}
