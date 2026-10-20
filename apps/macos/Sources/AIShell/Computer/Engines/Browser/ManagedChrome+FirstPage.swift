import AICore
import Foundation
import MCP

extension ManagedChromes {
  /// Gives a profile whose browser has no window its first one, without a person at the screen
  /// (plan §7, cold-start method A; the S8 probe passed it on an unlocked session: Chrome never
  /// became the front app and the key window never changed). A browser that does not run is
  /// started first (``launchWithoutWindow(profileId:)``); a browser that runs with no window gets
  /// the window only. The page opens through CDP `Target.createTarget` with `newWindow` and
  /// `background`, and the window is parked beyond the displays at once (the worker's `open_page`
  /// with `parkAt`). A browser started here that cannot show its first page is quit again.
  ///
  /// It refuses with `openBrowser` only when the browser itself will not start: the person then
  /// opens it, and the rest of the run goes on from there. A browser that came forward on its own
  /// is no failure; the caller's activation watch reports it.
  func openFirstPage(for browser: TargetBindingWire.Browser, running: ManagedChromeInstance?)
    async throws(ComputerFailure) -> ManagedChromeInstance
  {
    guard let workers else {
      throw ComputerFailure(.engineFailed, "The browser worker is not available.")
    }
    let instance: ManagedChromeInstance
    if let running {
      instance = running
    } else {
      do throws(ManagedChromeError) {
        instance = try await launchWithoutWindow(profileId: browser.profileId)
      } catch {
        throw Self.openBrowserRefusal(browser, why: error.errorDescription)
      }
    }
    do throws(ComputerFailure) {
      try await openWindow(workers, instance, browser)
    } catch {
      // A browser this call started has no window to show for it.
      if running == nil { await quit(browser.profileId) }
      throw error
    }
    return instance
  }

  /// Opens the binding's start page in a new background window parked beyond the displays, and
  /// logs where the system left it: it keeps part of a window on a display, so the frame asked
  /// for is never the frame read back.
  private func openWindow(
    _ workers: BrowserWorkerPool, _ instance: ManagedChromeInstance,
    _ browser: TargetBindingWire.Browser
  ) async throws(ComputerFailure) {
    let park = BrowserWindowPlacement.parked(displays: Self.displays().frames)
    let (reply, _) = try await workers.invoke(
      instance, "open_page",
      [
        "url": .string(browser.startUrl),
        "allowedOrigins": PlaywrightBrowserEngine.origins(browser),
        "parkAt": park.value,
      ], timeout: .seconds(20), writes: true)
    let opened = try reply.checked("open_page")
    if let actual = opened.parked {
      Self.log.notice(
        """
        A browser window was parked: asked for \(park.left, privacy: .public),\
        \(park.top, privacy: .public) (\(park.width, privacy: .public) by \
        \(park.height, privacy: .public)), the system kept it at \(actual.left, privacy: .public),\
        \(actual.top, privacy: .public) (\(actual.width, privacy: .public) by \
        \(actual.height, privacy: .public)).
        """)
    } else {
      Self.log.error("A browser window could not be parked beyond the displays.")
    }
  }

  /// The refusal for a browser that will not start: the person opens it themselves, which is
  /// what the transcript's "Open browser" does, and the next request finds it running.
  private static func openBrowserRefusal(_ browser: TargetBindingWire.Browser, why: String?)
    -> ComputerFailure
  {
    .noBackgroundRoute(
      .openBrowser,
      "The managed browser of \(browser.label) could not be started in the background"
        + (why.map { " (\($0))" } ?? "") + ". Ask the person to open it (Settings > Computer > "
        + "Targets: Sign in again on this website, or Add browser environment if it has no row "
        + "yet), then request access again.")
  }
}

extension BrowserWindowRect {
  /// The frame as the worker's tools take it.
  var value: Value {
    .object([
      "left": .int(left), "top": .int(top), "width": .int(width), "height": .int(height),
    ])
  }
}
