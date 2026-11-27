import AppKit

/// The person's own Chrome as a computer-use browser (Atd for Chrome, D8): the `chrome` engine,
/// with a worker pool of its own beside the managed browsers' (its workers log to the same
/// `computer/browser-workers`, by installation id), driving the tabs of each connected paired
/// Chrome in `links` through that Chrome's relay. Uploads come from the same task resource store
/// as the managed engine's; downloads stay in Chrome, so it has no download root. Registering the
/// engine belongs to the computer wiring.
extension ShellController {
  func makeChromeComputer(links: ChromeLinks) -> ChromeBrowserEngine {
    let computerData = services.dataDirectory.appending(
      path: "computer", directoryHint: .isDirectory)
    let resources = services.dataDirectory.appending(path: "resources", directoryHint: .isDirectory)
    let workers = BrowserWorkerPool(
      binaries: .current(),
      logDirectory: computerData.appending(path: "browser-workers", directoryHint: .isDirectory),
      uploadRoot: resources)
    return ChromeBrowserEngine(
      links: links, workers: workers, binaries: .current(), uploadRoot: resources,
      onShellLog: { [services] level, category, message in
        services.shellLog.enqueue(level: level, category: category, message: message)
      })
  }
}
