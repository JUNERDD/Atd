import AICore
import Foundation
import WebKit

/// Stand-ins for everything AIRelay will provide, so the shell runs on its own before
/// integration: the page cannot load, the service reads as unavailable (with the `pnpm dev`
/// hint in Debug builds), and every service action fails.
@MainActor
final class UnconnectedServices: NSObject, WebContentProviding, BridgeRouting,
  ActiveRunsProviding, ResourceImporting, ArtifactDownloading, ServiceStatusProviding,
  ServiceControlling, WKURLSchemeHandler
{
  var services: ShellServices {
    ShellServices(
      webContent: self, router: self, activeRuns: self, resources: self, artifacts: self,
      status: self, control: self)
  }

  private struct Unavailable: LocalizedError {
    var errorDescription: String? { "The agent service is not connected." }
  }

  func schemeHandler(for role: WebViewRole) -> any WKURLSchemeHandler { self }
  func configure(_ configuration: WKWebViewConfiguration, for role: WebViewRole) {}
  func webViewDidAttach(_ webView: WKWebView, role: WebViewRole) {}
  func webViewWillDetach(_ webView: WKWebView, role: WebViewRole) {}

  func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
    urlSchemeTask.didFailWithError(URLError(.cannotConnectToHost))
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {}

  func route(_ call: BridgeCall) async throws(BridgeError) -> JSONValue {
    throw BridgeError("\(call.method) is not available without the agent service.")
  }

  func activeRuns() async throws -> Int { 0 }

  func importResources(paths: [String]) async throws -> ResourceImportResponse {
    throw Unavailable()
  }

  func downloadArtifact(id: String) async throws -> DownloadedArtifact { throw Unavailable() }

  var snapshot: ServiceSnapshot {
    #if DEBUG
      ServiceSnapshot(availability: .unavailable(development: true), running: 0, attention: 0)
    #else
      ServiceSnapshot(availability: .unavailable(development: false), running: 0, attention: 0)
    #endif
  }

  func observeSnapshot(_ handler: @escaping @MainActor (ServiceSnapshot) -> Void) {}

  func restartService() async throws { throw Unavailable() }
  func revealServiceLogs() async throws { throw Unavailable() }
  func stopServiceForQuit() async {}
}
