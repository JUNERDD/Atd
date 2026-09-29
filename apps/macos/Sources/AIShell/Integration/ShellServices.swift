import AICore
import Foundation
import WebKit

/// The two windows that host the renderer.
public enum WebViewRole: String, Sendable {
  case panel
  case settings
}

/// Supplies what serves the `ai-app` scheme (the relay's scheme handler, static files and
/// `/v1/*`) and learns which web views exist, so it can own per-web-view state such as virtual
/// sockets. Called on every (re)build of a web view, including after a WebContent crash.
@MainActor
public protocol WebContentProviding: AnyObject, Sendable {
  /// The handler registered for ``RendererOrigin/scheme`` on a new configuration.
  func schemeHandler(for role: WebViewRole) -> any WKURLSchemeHandler
  /// Adds further handlers (for example the virtual socket pipe) to a new configuration.
  func configure(_ configuration: WKWebViewConfiguration, for role: WebViewRole)
  /// The web view built from that configuration is about to load the renderer.
  func webViewDidAttach(_ webView: WKWebView, role: WebViewRole)
  /// The web view is being replaced (WebContent crash) or its window closed; release its state.
  func webViewWillDetach(_ webView: WKWebView, role: WebViewRole)
}

/// One trusted page-to-shell call: the method name and its JSON parameters.
public struct BridgeCall: Sendable {
  public let method: String
  public let params: JSONValue
  public let role: WebViewRole

  public init(method: String, params: JSONValue, role: WebViewRole) {
    self.method = method
    self.params = params
    self.role = role
  }
}

/// A bridge call the router refused or could not complete; the message reaches the page as
/// the rejection of its `postMessage` promise.
public struct BridgeError: Error, Equatable, Sendable {
  public let message: String
  public init(_ message: String) { self.message = message }
}

/// Routes trusted bridge calls. The shell's own methods live in ``ShellBridge``, which hands
/// every other method to the router integration supplies.
@MainActor
public protocol BridgeRouting: AnyObject, Sendable {
  func route(_ call: BridgeCall) async throws(BridgeError) -> JSONValue
}

/// Receives shell-to-page events for one role (command shortcuts, attachment results, window
/// state). The default sink is that role's web view host, which queues until its page is ready.
@MainActor
public protocol ShellEventSending: AnyObject, Sendable {
  func send(_ event: ShellEvent, to role: WebViewRole)
  func setState(_ name: String, _ payload: JSONValue, for role: WebViewRole)
}

/// The service's run count, for the quit guard (`GET /v1/status` → `activeRuns`).
@MainActor
public protocol ActiveRunsProviding: AnyObject, Sendable {
  func activeRuns() async throws -> Int
}

/// `POST /v1/resources/import`. One call carries 1–10 absolute paths
/// (``AttachmentRules/maxPathsPerImport``); the shell batches larger sets.
@MainActor
public protocol ResourceImporting: AnyObject, Sendable {
  func importResources(paths: [String]) async throws -> ResourceImportResponse
}

/// An artifact's bytes, downloaded with the shell's credentials.
public struct DownloadedArtifact: Sendable {
  public let name: String
  public let mime: String
  public let bytes: Data

  public init(name: String, mime: String, bytes: Data) {
    self.name = name
    self.mime = mime
    self.bytes = bytes
  }
}

@MainActor
public protocol ArtifactDownloading: AnyObject, Sendable {
  func downloadArtifact(id: String) async throws -> DownloadedArtifact
}

/// What the menu bar shows about the service: reachability plus the counts of the last
/// `status` frame.
public struct ServiceSnapshot: Equatable, Sendable {
  public let availability: ServiceAvailability
  public let running: Int
  public let attention: Int

  public init(availability: ServiceAvailability, running: Int, attention: Int) {
    self.availability = availability
    self.running = running
    self.attention = attention
  }
}

@MainActor
public protocol ServiceStatusProviding: AnyObject, Sendable {
  var snapshot: ServiceSnapshot { get }
  /// Calls `handler` on every later change of ``snapshot``.
  func observeSnapshot(_ handler: @escaping @MainActor (ServiceSnapshot) -> Void)
}

/// The service actions of the menus and the quit flow.
@MainActor
public protocol ServiceControlling: AnyObject, Sendable {
  /// Replaces the service; also the way back after automatic restarts gave up.
  func restartService() async throws
  /// Reveals the folder with the service's log files.
  func revealServiceLogs() async throws
  /// Runs once a quit is confirmed, before the app terminates (shutdown, then SIGTERM).
  func stopServiceForQuit() async
}

/// Everything the shell needs from outside AIShell. Integration conforms AIRelay to these.
@MainActor
public struct ShellServices {
  public var webContent: any WebContentProviding
  /// Receives every bridge method the shell does not serve itself.
  public var router: any BridgeRouting
  public var activeRuns: any ActiveRunsProviding
  public var resources: any ResourceImporting
  public var artifacts: any ArtifactDownloading
  public var status: any ServiceStatusProviding
  public var control: any ServiceControlling

  public init(
    webContent: any WebContentProviding, router: any BridgeRouting,
    activeRuns: any ActiveRunsProviding, resources: any ResourceImporting,
    artifacts: any ArtifactDownloading, status: any ServiceStatusProviding,
    control: any ServiceControlling
  ) {
    self.webContent = webContent
    self.router = router
    self.activeRuns = activeRuns
    self.resources = resources
    self.artifacts = artifacts
    self.status = status
    self.control = control
  }
}
