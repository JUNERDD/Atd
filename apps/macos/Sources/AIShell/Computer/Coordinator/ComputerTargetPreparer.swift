import AICore

/// Prepares targets a person registers from Settings (D7): a managed browser profile opened for
/// sign-in, an installed application, or a profile opened again to sign in anew. Implemented by the
/// engine adapters, which then register the prepared target with the service (`POST
/// /v1/computer/bindings`); the coordinator only routes the bridge calls here. Until an
/// implementation is set, preparing answers `unavailable`.
protocol ComputerTargetPreparer: AnyObject {
  /// `computer.prepareBrowser`: create a managed profile, open `startUrl` in it for the person to
  /// sign in, and register the binding once they are done.
  func prepareBrowser(_ params: ComputerPrepareBrowserParams) async
    -> ComputerPrepareBrowserResult
  /// `computer.prepareApplication`: register the installed app `bundleId` and probe it read-only.
  func prepareApplication(_ params: ComputerPrepareApplicationParams) async
    -> ComputerPrepareApplicationResult
  /// `computer.openProfile`: open a browser binding's managed profile for the person to sign in
  /// again. Throws a message the page shows.
  func openProfile(bindingId: String) async throws(BridgeError)
}

/// The preparer the shell sets (D15): browser targets and profiles go to the browser engine's
/// preparer, applications to the native engine's. Each keeps its own one-at-a-time guard; the
/// system panels and confirmations they share refuse a second dialog with `busy`.
final class CompositeTargetPreparer: ComputerTargetPreparer {
  private let browser: BrowserTargetPreparer
  private let application: ApplicationTargetPreparer

  init(browser: BrowserTargetPreparer, application: ApplicationTargetPreparer) {
    self.browser = browser
    self.application = application
  }

  func prepareApplication(_ params: ComputerPrepareApplicationParams) async
    -> ComputerPrepareApplicationResult
  {
    await application.prepareApplication(params)
  }

  func prepareBrowser(_ params: ComputerPrepareBrowserParams) async
    -> ComputerPrepareBrowserResult
  {
    await browser.prepareBrowser(params)
  }

  func openProfile(bindingId: String) async throws(BridgeError) {
    try await browser.openProfile(bindingId: bindingId)
  }
}
