import AICore
import Foundation

/// Resolving a browser binding to the page that is its target. Resolution only reads: it never
/// starts the browser or opens a page, which is the approved access operation's job
/// (``ManagedChromes/openInBackground(_:)``).
extension PlaywrightBrowserEngine {
  /// The first page of the profile on the binding's page rule, preferring one no other page
  /// opened, so a popup is never taken for the target itself.
  func resolve(
    _ binding: TargetBindingWire, generation host: Int, context _: EngineResolveContext
  ) async throws(ComputerFailure) -> TargetRefWire {
    guard case .browser(let browser) = binding else {
      throw ComputerFailure(.unsupported, "The browser engine serves browser targets only.")
    }
    guard let engineGeneration = generation else {
      throw ComputerFailure(.engineFailed, "The browser engine is not running.")
    }
    guard chromes.applicationURL != nil else {
      throw ComputerFailure(
        .targetUnavailable, "Google Chrome is not installed; install it and prepare the target.")
    }
    guard let instance = await chromes.running(browser.profileId) else {
      throw ComputerFailure(
        .targetUnavailable,
        "The managed browser of \(browser.label) is not running; request access to the website "
          + "to start it in the background.")
    }
    let pages = try await listPages(instance)
    let onRule = pages.filter {
      BrowserOrigins.isTarget(
        url: $0.url, urlPrefix: browser.urlPrefix, origins: browser.allowedOrigins)
    }
    guard let page = onRule.first(where: { $0.openerId == nil }) ?? onRule.first else {
      throw ComputerFailure(
        .targetUnavailable,
        "No page of \(browser.label) at \(browser.urlPrefix) is open in its managed browser; "
          + "request access to the website again to open it in the background.")
    }
    let ref = TargetRefWire(
      id: "pw." + UUID().uuidString.lowercased(), bindingId: browser.bindingId,
      bindingRevision: browser.revision, hostGeneration: host, engine: .playwright,
      engineGeneration: engineGeneration,
      browser: .init(
        profileId: browser.profileId, contextId: instance.contextId, pageId: page.pageId,
        navigationGeneration: 0),
      capabilities: Self.targetCapabilities)
    bindings = bindings.filter { $0.value.bindingId != browser.bindingId }
    surfaces = surfaces.filter { bindings[$0.key] != nil }
    bindings[ref.id] = browser
    var set = BrowserSurfaceSet(targetRefId: ref.id, boundPageId: page.pageId)
    set.reconcile(pages, origins: browser.allowedOrigins)
    surfaces[ref.id] = set
    return ref
  }
}
