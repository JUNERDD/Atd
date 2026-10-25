import AICore
import AppKit
import MCP

/// Whether a browser target is in front of the person (plan §7), which with their own recent
/// input makes it in use: the coordinator then yields (`targetInUse`) instead of acting under
/// their hands. Both must hold: the target's managed Chrome is the frontmost app, and one of the
/// target's pages is the tab its window shows (the worker's `page_focus`, which also reports
/// `document.hasFocus()`). A browser that is not frontmost is never in front, so the worker is not
/// asked. A page in a background tab of the frontmost browser is not either: the agent works there
/// without the person seeing it.
extension PlaywrightBrowserEngine {
  /// How long the worker has to read the pages' state.
  static let occupancyTimeout: Duration = .seconds(3)

  func isInFront(_ ref: TargetRefWire) async -> Bool {
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
      return try checked(raw, "page_focus").focus?.contains(where: \.isInFront) ?? false
    } catch {
      // The person has this browser in front of them and its pages cannot be read: count the
      // target as in front.
      return true
    }
  }
}
