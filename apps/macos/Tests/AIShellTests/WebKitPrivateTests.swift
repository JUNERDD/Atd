import Testing
import WebKit

@testable import AIShell

/// Loads a page in a windowless WKWebView and reports what WebKit resolved for the glass rule.
@MainActor
private final class GlassProbe: NSObject, WKNavigationDelegate {
  private var loaded: CheckedContinuation<Void, Never>?

  func run(systemAppearance: Bool) async throws -> [String: Any] {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    if systemAppearance { #expect(WebKitPrivate.enableSystemAppearance(configuration.preferences)) }
    let webView = WKWebView(
      frame: CGRect(x: 0, y: 0, width: 200, height: 200), configuration: configuration)
    #expect(WebKitPrivate.disableBackground(webView))
    webView.navigationDelegate = self
    await withCheckedContinuation { continuation in
      loaded = continuation
      webView.loadHTMLString(Self.page, baseURL: nil)
    }
    let result = try await webView.callAsyncJavaScript(
      """
      const glass = document.getElementById('glass');
      return {
        supported: CSS.supports('-apple-visual-effect', '-apple-system-glass-material'),
        effect: getComputedStyle(glass).getPropertyValue('-apple-visual-effect'),
        background: getComputedStyle(glass).backgroundColor,
      };
      """, contentWorld: .page)
    return result as? [String: Any] ?? [:]
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loaded?.resume()
    loaded = nil
  }

  /// The same shape as `surface-glass` in packages/ui: a fallback fill, replaced by system glass
  /// where WebKit supports it.
  private static let page = """
    <style>
      #glass { width: 100px; height: 100px; border-radius: 14px; background-color: rgb(12 12 12 / 80%); }
      @supports (-apple-visual-effect: -apple-system-glass-material) {
        #glass { background-color: transparent; -apple-visual-effect: -apple-system-glass-material; }
      }
    </style>
    <div id="glass"></div>
    """
}

@MainActor
@Suite("WebKit private settings")
struct WebKitPrivateTests {
  @Test("System appearance turns on WebKit's in-page glass material")
  func systemAppearanceEnablesGlass() async throws {
    let result = try await GlassProbe().run(systemAppearance: true)
    #expect(result["supported"] as? Bool == true)
    #expect(result["effect"] as? String == "-apple-system-glass-material")
    #expect(result["background"] as? String == "rgba(0, 0, 0, 0)")
  }

  @Test("Without it the page keeps the translucent fallback fill")
  func fallbackWithoutSystemAppearance() async throws {
    let result = try await GlassProbe().run(systemAppearance: false)
    #expect(result["supported"] as? Bool == false)
    #expect(result["background"] as? String == "rgba(12, 12, 12, 0.8)")
  }
}
