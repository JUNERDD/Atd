import AppKit

/// The browser half of computer use (D15): the `playwright` engine and the preparer of browser
/// targets, sharing one set of managed profiles and browsers under this shell's data directory,
/// which is also the service's: uploads come from its task resource store (`resources`), and
/// each run's downloads are staged under `computer/downloads` for the service to import.
/// Registering the engine and composing the preparer belong to the computer wiring.
extension ShellController {
  func makeBrowserComputer() -> (
    engine: PlaywrightBrowserEngine, preparer: BrowserTargetPreparer, access: ComputerAccessPreparer
  ) {
    let computerData = services.dataDirectory.appending(
      path: "computer", directoryHint: .isDirectory)
    let profiles = ManagedBrowserProfiles(dataDirectory: services.dataDirectory)
    let chromes = ManagedChromes(profiles: profiles)
    let resources = services.dataDirectory.appending(path: "resources", directoryHint: .isDirectory)
    let workers = BrowserWorkerPool(
      binaries: .current(),
      logDirectory: computerData.appending(path: "browser-workers", directoryHint: .isDirectory),
      uploadRoot: resources)
    let engine = PlaywrightBrowserEngine(
      chromes: chromes, workers: workers, binaries: .current(),
      downloadsRoot: computerData.appending(path: "downloads", directoryHint: .isDirectory),
      uploadRoot: resources)
    let preparer = BrowserTargetPreparer(
      chromes: chromes, profiles: profiles, services: services, confirmations: confirmations,
      systemPanels: systemPanels)
    return (engine, preparer, ComputerAccessPreparer(profiles: profiles, chromes: chromes))
  }
}
