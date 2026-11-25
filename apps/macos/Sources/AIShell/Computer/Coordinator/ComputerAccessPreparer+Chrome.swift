import AICore
import Foundation

/// A website on the person's own Chrome (Atd for Chrome, D5–D7): the candidate is a `chrome`
/// binding on the paired Chrome the run is on, whose installation id is its `profileId`, and
/// opening it puts its start page in a background tab of that Chrome's `Atd` group. Nothing here
/// touches a managed browser.
extension ComputerAccessPreparer {
  /// How long the extension has to report the tab it opened.
  static let chromeOpenTimeout: Duration = .seconds(15)

  static let chromeDisconnected = ComputerFailure(
    .targetUnavailable,
    "No Chrome is connected to Atd through Atd for Chrome. Ask the person to open Chrome with Atd "
      + "for Chrome turned on and connected, then request access again.",
    reason: .chromeDisconnected)

  /// The paired Chrome a run's website opens in: the one whose tabs the run owns (the tab it was
  /// started from), else the only one connected. With several connected and none owned by the
  /// run, the person says which.
  func chromeLink(for runId: String) throws(ComputerFailure) -> ChromeLink {
    if let owning = links.link(owning: runId) { return owning }
    let connected = Array(links.links.values)
    guard let only = connected.first else { throw Self.chromeDisconnected }
    guard connected.count == 1 else {
      throw ComputerFailure(
        .ambiguous,
        "Several Chrome profiles are connected through Atd for Chrome and this task uses none of "
          + "them yet. Ask the person which Chrome profile to use, or to ask Atd from a tab of "
          + "that profile.")
    }
    return only
  }

  /// The `chrome` candidate for `url` on the paired Chrome of `runId`.
  func chromeCandidate(url: String, origin: String, prefix: String, runId: String)
    throws(ComputerFailure) -> SaveComputerBindingRequestWire.Content
  {
    let link = try chromeLink(for: runId)
    return .browser(
      label: String((URL(string: url)?.host ?? origin).prefix(120)),
      profileId: link.installationId, allowedOrigins: [origin], startUrl: url, urlPrefix: prefix,
      channel: .chrome)
  }

  /// Opens an approved `chrome` binding's start page for `runId` in a background tab of the
  /// `Atd` group (`tab.open`), unless a tab the run already owns is on the binding's page rule
  /// (the tab the person asked from), which is then the target as it is.
  func openInChrome(_ browser: TargetBindingWire.Browser, runId: String)
    async throws(ComputerFailure)
  {
    guard let link = links.link(browser.profileId) else { throw Self.chromeDisconnected }
    let onRule = link.tabs(of: runId).contains {
      BrowserOrigins.isTarget(
        url: $0.url, urlPrefix: browser.urlPrefix, origins: browser.allowedOrigins)
    }
    guard !onRule else { return }
    do throws(ChromeTabOpenError) {
      _ = try await link.openTab(
        url: browser.startUrl, runId: runId, timeout: Self.chromeOpenTimeout)
    } catch {
      switch error {
      case .disconnected: throw Self.chromeDisconnected
      case .timedOut:
        throw ComputerFailure(
          .timeout,
          "Atd for Chrome did not open \(browser.label) in time; request access to it again.")
      case .refused:
        throw ComputerFailure(
          .targetUnavailable,
          "Atd for Chrome could not open \(browser.label); request access to it again.")
      }
    }
  }
}
