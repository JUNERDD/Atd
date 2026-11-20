import Foundation
import WebKit

/// Reads the page behind a link that was shared without its text (apps other than Safari send
/// only the address). It runs only when the person runs a command on the link, which the
/// list's footer says.
protocol PageReading {
  /// The page at `url` with its title and text.
  /// - Throws: `PageFailure`, or `CancellationError` when the run is stopped.
  func read(_ url: URL) async throws -> SharedPage
}

/// Why a shared link's page could not be read.
enum PageFailure: Error, Equatable {
  /// No network, or the site did not answer.
  case offline
  /// The page did not load, or has no text.
  case unreadable
}

/// Loads the page in a web page of its own, with no cookies or storage shared with anything, and
/// runs `Share/SharePage.js` in it, the script Safari runs in a page it shares.
struct WebPageReader: PageReading {
  /// How long a page may take to load before Atd reads what has arrived.
  static let timeout: Duration = .seconds(15)

  /// The script's source (the extension bundle's `SharePage.js`).
  let script: String

  func read(_ url: URL) async throws -> SharedPage {
    var configuration = WebPage.Configuration()
    configuration.websiteDataStore = .nonPersistent()
    let page = WebPage(configuration: configuration)
    do {
      try await withTaskCancellationHandler {
        try await load(url, in: page)
      } onCancel: {
        Task { @MainActor in page.stopLoading() }
      }
    } catch {
      // Stopping the load for a stopped run fails it too; the run's end is what counts.
      try Task.checkCancellation()
      throw error
    }
    let value = try? await page.callJavaScript(Self.reading(script))
    guard let results = (value as? NSDictionary) as? [String: Any] else {
      throw PageFailure.unreadable
    }
    // The address the person shared, even when the site redirected.
    let read = SharedPage(url: url, preprocessed: results.compactMapValues { $0 as? String })
    guard read.text?.isEmpty == false else { throw PageFailure.unreadable }
    return read
  }

  /// Waits until the page finished loading, or until the timeout once it has started to show.
  private func load(_ url: URL, in page: WebPage) async throws {
    let timeout = Task { @MainActor in
      try await Task.sleep(for: Self.timeout)
      page.stopLoading()
    }
    defer { timeout.cancel() }
    var committed = false
    do {
      for try await event in page.load(url) {
        if event == .committed { committed = true }
        if event == .finished { return }
      }
    } catch let error as WebPage.NavigationError {
      // Stopped by the timeout after the page began to show: read what arrived.
      guard !committed else { return }
      throw Self.failure(error)
    }
    guard committed else { throw PageFailure.unreadable }
  }

  /// A function body that runs the script and returns what it hands `completionFunction`.
  static func reading(_ script: String) -> String {
    script + "\nreturn await new Promise((resolve) => "
      + "ExtensionPreprocessingJS.run({ completionFunction: resolve }));"
  }

  private static func failure(_ error: WebPage.NavigationError) -> PageFailure {
    guard case .failedProvisionalNavigation(let underlying) = error,
      let error = underlying as? URLError
    else { return .unreadable }
    switch error.code {
    case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost,
      .cannotConnectToHost, .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff,
      .secureConnectionFailed:
      return .offline
    default:
      return .unreadable
    }
  }
}
