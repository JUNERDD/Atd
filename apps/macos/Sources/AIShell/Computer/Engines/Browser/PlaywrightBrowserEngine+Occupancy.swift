import AICore
import AppKit
import MCP

/// Whether the person is using a browser target (plan §7). The coordinator asks before every
/// write and yields (`targetInUse`) instead of acting under their hands. Both must hold: the
/// target's managed Chrome is the frontmost app, and one of the target's pages is what the person
/// has in front of them (the worker's `page_focus`: the tab a window shows, which reports
/// `document.hasFocus()`). A browser that is not frontmost is never in use, so the worker is not
/// asked. A page in a background tab of the frontmost browser is not either: the agent works there
/// without the person seeing it.
extension PlaywrightBrowserEngine {
  /// How long the worker has to read the pages' state.
  static let occupancyTimeout: Duration = .seconds(3)

  func isInUse(_ ref: TargetRefWire) async -> Bool {
    guard let page = ref.browser, let instance = chromes.tracked(page.profileId),
      instance.contextId == page.contextId,
      NSWorkspace.shared.frontmostApplication?.processIdentifier == instance.pid,
      let set = surfaces[ref.id]
    else { return false }
    let pageIds = ([set.boundPageId] + set.popups.map(\.pageId))
      .prefix(ComputerWireLimits.maxSurfaces)
    do throws(ComputerFailure) {
      let (raw, _) = try await call(
        instance, "page_focus", ["pageIds": .array(pageIds.map(Value.string))],
        timeout: Self.occupancyTimeout, writes: false)
      return try checked(raw, "page_focus").focus?.contains(where: \.isInUse) ?? false
    } catch {
      // The person has this browser in front of them and its pages cannot be read: yield.
      return true
    }
  }
}
