import AtdMiniApps
import Foundation
import Synchronization
import UIKit
import WebKit

/// The walls every mini app page runs inside. Each page gets its own `WebPage` with:
///
/// - a data store that keeps nothing (no cookies, storage or cache outlive the page), and the
///   document's `sandbox` policy on top, which gives it an opaque origin with no storage at all;
/// - its document served at its own address on the `atd-mini` scheme, with the content security
///   policy that allows no network, frames, workers or forms that go anywhere;
/// - a content rule list that blocks every load but its own document and data URLs, in case a
///   policy is ever missed;
/// - a navigation decider that keeps the frame on its document;
/// - no sensors, no data detectors, no link previews or full screen, and Lockdown Mode.
///
/// The page reaches its data only through the `atd` message handler (`MiniAppPageHost`).
enum MiniAppSandbox {
  static let scheme = "atd-mini"

  /// A stored app's page.
  static func url(app id: String) -> URL {
    URL(string: "\(scheme)://app/\(id)/")!
  }

  /// A page being previewed before it is saved, which has no id yet.
  static func url(draft token: UUID) -> URL {
    URL(string: "\(scheme)://draft/\(token.uuidString.lowercased())/")!
  }

  static func configuration(
    documents: MiniAppDocuments, controller: WKUserContentController
  ) -> WebPage.Configuration {
    var configuration = WebPage.Configuration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.userContentController = controller
    if let scheme = URLScheme(scheme) {
      configuration.urlSchemeHandlers = [scheme: MiniAppSchemeHandler(documents: documents)]
    }
    configuration.deviceSensorAuthorization = .init(decision: .deny)
    configuration.dataDetectorTypes = []
    configuration.allowsAirPlayForMediaPlayback = false
    configuration.allowsInlinePredictions = false
    configuration.upgradeKnownHostsToHTTPS = true
    configuration.defaultNavigationPreferences.isLockdownModeEnabled = true
    return configuration
  }

  /// Every load is blocked but the page's own scheme and data URLs. Compiled once per launch.
  static func rules() async -> WKContentRuleList? {
    if let compiled { return compiled }
    let list = try? await WKContentRuleListStore.default()?.compileContentRuleList(
      forIdentifier: "atd-mini-apps-1", encodedContentRuleList: ruleList)
    compiled = list
    return list
  }

  private static var compiled: WKContentRuleList?

  private static let ruleList = """
    [{"trigger": {"url-filter": ".*"}, "action": {"type": "block"}},
    {"trigger": {"url-filter": "^atd-mini:"}, "action": {"type": "ignore-previous-rules"}},
    {"trigger": {"url-filter": "^data:"}, "action": {"type": "ignore-previous-rules"}}]
    """

  /// Whether `url` is the page's own document, with or without a fragment.
  nonisolated static func isDocument(_ url: URL?, of document: URL) -> Bool {
    guard let url, var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
      return false
    }
    parts.fragment = nil
    return parts.url == document
  }
}

/// The document each page shows, which the host replaces before it loads a new version.
nonisolated final class MiniAppDocuments: Sendable {
  private let current = Mutex<(url: URL?, data: Data)>((nil, Data()))

  func set(_ html: String, at url: URL) {
    current.withLock { $0 = (url, Data(html.utf8)) }
  }

  func document(for url: URL) -> Data? {
    current.withLock { current in
      guard let document = current.url, MiniAppSandbox.isDocument(url, of: document) else {
        return nil
      }
      return current.data
    }
  }
}

/// Serves the page's document at its address and fails every other request on the scheme, so a
/// page cannot load another app's document.
nonisolated struct MiniAppSchemeHandler: URLSchemeHandler {
  let documents: MiniAppDocuments

  func reply(for request: URLRequest) -> AsyncThrowingStream<URLSchemeTaskResult, any Error> {
    AsyncThrowingStream { continuation in
      guard let url = request.url, let data = documents.document(for: url),
        let response = HTTPURLResponse(
          url: url, statusCode: 200, httpVersion: "HTTP/1.1",
          headerFields: [
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": MiniAppDocument.contentSecurityPolicy,
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "X-DNS-Prefetch-Control": "off",
          ])
      else {
        continuation.finish(throwing: URLError(.fileDoesNotExist))
        return
      }
      continuation.yield(.response(response))
      continuation.yield(.data(data))
      continuation.finish()
    }
  }
}

/// Lets the frame load its own document (again, or at a fragment) and nothing else, in any
/// frame: links, forms, `location` and `window.open` go nowhere.
struct MiniAppNavigation: WebPage.NavigationDeciding {
  let document: URL

  mutating func decidePolicy(
    for action: WebPage.NavigationAction, preferences: inout WebPage.NavigationPreferences
  ) async -> WKNavigationActionPolicy {
    MiniAppSandbox.isDocument(action.request.url, of: document) ? .allow : .cancel
  }

  mutating func decidePolicy(for response: WebPage.NavigationResponse) async
    -> WKNavigationResponsePolicy
  {
    MiniAppSandbox.isDocument(response.response.url, of: document) ? .allow : .cancel
  }
}

/// `alert` and `confirm` as the system's alerts, which the page's sheet shows; a page cannot
/// prompt for text or files.
struct MiniAppDialogs: WebPage.DialogPresenting {
  let queue: MiniAppDialogQueue

  func handleJavaScriptAlert(message: String, initiatedBy frame: WebPage.FrameInfo) async {
    _ = await queue.present(message, asks: false)
  }

  func handleJavaScriptConfirm(message: String, initiatedBy frame: WebPage.FrameInfo) async
    -> WebPage.JavaScriptConfirmResult
  {
    await queue.present(message, asks: true) ? .ok : .cancel
  }

  func handleJavaScriptPrompt(
    message: String, defaultText: String?, initiatedBy frame: WebPage.FrameInfo
  ) async -> WebPage.JavaScriptPromptResult {
    .cancel
  }

  func handleFileInputPrompt(
    parameters: WKOpenPanelParameters, initiatedBy frame: WebPage.FrameInfo
  ) async -> WebPage.FileInputPromptResult {
    .cancel
  }
}

/// The page's dialog waiting for the person, one at a time.
@Observable
final class MiniAppDialogQueue {
  struct Dialog: Identifiable {
    let id = UUID()
    let message: String
    /// `confirm`: OK and Cancel; `alert`: OK only.
    let asks: Bool
  }

  private(set) var current: Dialog?
  @ObservationIgnored private var answer: CheckedContinuation<Bool, Never>?

  func present(_ message: String, asks: Bool) async -> Bool {
    // A page that opens a dialog while one is showing gets Cancel.
    guard current == nil else { return false }
    return await withCheckedContinuation { continuation in
      answer = continuation
      current = Dialog(message: String(message.prefix(300)), asks: asks)
    }
  }

  func answer(_ ok: Bool) {
    current = nil
    answer?.resume(returning: ok)
    answer = nil
  }
}

/// SF Symbols for `<i class="sym">`, as PNG data URLs the page masks with its text color.
enum MiniAppSymbols {
  private static var cache: [String: String] = [:]

  /// `{name: dataURL}` for each name; a name that is not a symbol gets a placeholder glyph.
  static func json(_ names: [String]) -> String {
    MiniAppJSON.object(
      Dictionary(names.map { ($0, MiniAppJSON.string(dataURL($0))) }) { first, _ in first }
    ).jsonString
  }

  private static func dataURL(_ name: String) -> String {
    if let url = cache[name] { return url }
    let configuration = UIImage.SymbolConfiguration(pointSize: 40, weight: .medium)
    guard
      let symbol = UIImage(systemName: name, withConfiguration: configuration)
        ?? UIImage(systemName: "questionmark.square.dashed", withConfiguration: configuration)
    else { return "" }
    let format = UIGraphicsImageRendererFormat()
    format.scale = 2
    let png = UIGraphicsImageRenderer(size: symbol.size, format: format).pngData { _ in
      symbol.withTintColor(.black, renderingMode: .alwaysOriginal).draw(at: .zero)
    }
    let url = "data:image/png;base64,\(png.base64EncodedString())"
    cache[name] = url
    return url
  }
}
