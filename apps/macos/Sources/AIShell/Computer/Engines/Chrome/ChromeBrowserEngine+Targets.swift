import AICore
import AppKit

/// Resolving a `chrome` binding to a tab the run owns, finding the browser a ref's tab is in, and
/// whether the person is using it, all from what Atd for Chrome reported (``ChromeLink``).
/// Resolution only reads: an approved website's tab is opened by the access operation.
extension ChromeBrowserEngine {
  /// The paired Chrome of a binding or ref is not connected.
  static func disconnected(_ label: String) -> ComputerFailure {
    ComputerFailure(
      .targetUnavailable,
      "The person's Chrome for \(label) is not connected to Atd through Atd for Chrome. Ask them "
        + "to open Chrome with Atd for Chrome turned on and connected, then list targets again.",
      reason: .chromeDisconnected)
  }

  /// A tab of this run on the binding's page rule that the extension reported with its CDP
  /// target, preferring the active one; never a tab of another run or one Atd does not own.
  func resolve(
    _ binding: TargetBindingWire, generation host: Int, context: EngineResolveContext
  ) async throws(ComputerFailure) -> TargetRefWire {
    guard case .browser(let browser) = binding, browser.channel == .chrome else {
      throw ComputerFailure(
        .unsupported, "The chrome engine serves targets in the person's own Chrome only.")
    }
    guard let engineGeneration = generation else {
      throw ComputerFailure(.engineFailed, "The chrome engine is not running.")
    }
    guard let link = links.link(browser.profileId) else { throw Self.disconnected(browser.label) }
    let onRule = link.tabs(of: context.runId).filter { tab in
      tab.targetId.map(Self.isPageId) == true
        && BrowserOrigins.isTarget(
          url: tab.url, urlPrefix: browser.urlPrefix, origins: browser.allowedOrigins)
    }
    guard let tab = onRule.first(where: \.active) ?? onRule.first, let pageId = tab.targetId
    else {
      throw ComputerFailure(
        .targetUnavailable,
        "No tab of this task in the person's Chrome is on \(browser.label) at "
          + "\(browser.urlPrefix); request access to the website to open it in a background tab "
          + "of the Atd group.")
    }
    let ref = TargetRefWire(
      id: "cr." + UUID().uuidString.lowercased(), bindingId: browser.bindingId,
      bindingRevision: browser.revision, hostGeneration: host, engine: .chrome,
      engineGeneration: engineGeneration,
      browser: .init(
        profileId: link.installationId, contextId: link.contextId, pageId: pageId,
        navigationGeneration: 0),
      capabilities: Self.targetCapabilities(fileAccess: link.fileAccess))
    // Another run's ref of the same site binding names a tab of that run, which stays its own.
    driver.track(ref, binding: browser, boundPageId: pageId) { [runs] in
      runs[$0] == context.runId
    }
    runs = runs.filter { driver.bindings[$0.key] != nil }
    runs[ref.id] = context.runId
    return ref
  }

  /// The relay of the ref's Chrome while the connection the ref was resolved on lasts and its tab
  /// is still the run's.
  func endpoint(of page: TargetRefWire.Browser, refId: String) async throws(ComputerFailure)
    -> any BrowserWorkerEndpoint
  {
    guard let link = links.link(page.profileId), let relay = relays[link.installationId] else {
      throw Self.disconnected(driver.bindings[refId]?.label ?? "this target")
    }
    guard link.contextId == page.contextId else {
      throw ComputerFailure(
        .targetChanged,
        "Atd for Chrome reconnected since the target was resolved; list targets again.")
    }
    guard let tab = link.tab(targetId: page.pageId), tab.runId != nil, tab.runId == runs[refId]
    else {
      throw ComputerFailure(
        .targetChanged,
        "The task's tab was closed, taken out of the Atd group or released; request access to "
          + "the website again.")
    }
    let url = try await relay.webSocketURL()
    return ChromeWorkerEndpoint(
      profileId: link.installationId, contextId: link.contextId, webSocketURL: url,
      pid: link.browserPid,
      processStart: ProcessIdentity.start(of: link.browserPid).map(String.init) ?? link.contextId)
  }

  // MARK: Occupancy (D10)

  /// The ref's tab and its popups in front of the person: one of them is the active, focused tab
  /// of its window, and Chrome is the frontmost app.
  func isInFront(_ ref: TargetRefWire) async -> Bool {
    guard let link = link(of: ref),
      NSWorkspace.shared.frontmostApplication?.processIdentifier == link.browserPid
    else { return false }
    return tabs(of: ref, in: link).contains { $0.active && $0.focused }
  }

  /// The person took over one of the ref's tabs in Atd for Chrome (`run.hold`) and has not handed
  /// it back.
  func isHeld(_ ref: TargetRefWire) -> Bool {
    guard let link = link(of: ref) else { return false }
    return tabs(of: ref, in: link).contains(where: \.held)
  }

  /// The person's latest input in one of the ref's tabs, as the extension reported it.
  func lastInput(on ref: TargetRefWire) -> ContinuousClock.Instant? {
    guard let link = link(of: ref),
      let latest = tabs(of: ref, in: link).compactMap(\.lastInputAt).max()
    else { return nil }
    return .now - .seconds(max(0, Date().timeIntervalSince(latest)))
  }

  /// The ref's bound tab and the popups admitted as its surfaces, as the extension reports them.
  private func tabs(of ref: TargetRefWire, in link: ChromeLink) -> [ChromeOwnedTab] {
    guard let page = ref.browser else { return [] }
    let popups = driver.surfaces[ref.id]?.popups.map(\.pageId) ?? []
    return ([page.pageId] + popups).compactMap(link.tab(targetId:))
  }

  // MARK: Profile

  /// What each target supports: the worker's steps in the background, none verified through
  /// Atd for Chrome yet, and `upload` only where Chrome lets the extension read files.
  static func targetCapabilities(fileAccess: Bool) -> [TargetCapabilityWire] {
    BrowserWorkerCapabilities.target(
      BrowserWorkerCapabilities.actions.filter { fileAccess || $0 != .upload }, verified: [])
  }

  /// What `computer.hello` publishes: never qualified, so no unattended run is admitted (the
  /// person's own Chrome serves attended runs only, D5).
  static func makeProfile(workerReady: Bool) -> CapabilityProfileWire {
    let evidence =
      workerReady
      ? "playwright-core \(BrowserWorkerCapabilities.playwrightVersion) over CDP in the person's "
        + "own Chrome through Atd for Chrome, for attended runs only, in the tabs handed to a run "
        + "(the tab the person asked from, tabs the run opened in the Atd tab group, and their "
        + "popups), in the background: every step unverified through the extension; upload only "
        + "where the person let Atd for Chrome access file URLs. Downloads stay in Chrome and "
        + "are not reported. A website opens in a background tab of the Atd group."
      : "The browser worker is not installed."
    return BrowserWorkerCapabilities.profile(
      engine: .chrome, qualification: .unqualified, evidence: evidence)
  }

  /// Whether the extension's target id can name a page in a ref (`ComputerRefIdSchema`).
  static func isPageId(_ id: String) -> Bool {
    !id.isEmpty && id.utf8.count <= 256
      && id.unicodeScalars.allSatisfy {
        CharacterSet.alphanumerics.contains($0) && $0.isASCII || "_.:-".unicodeScalars.contains($0)
      }
  }
}
