import CryptoKit
import Foundation

/// The `Content-Security-Policy` header of the renderer's HTML documents, in development and
/// release alike. `apps/desktop/index.html` carries no meta CSP (decision R2), so this header is
/// the page's whole policy.
///
/// Spike S2 established what a header CSP does for `ai-app://`: `script-src`, `connect-src` and
/// `frame-src` are enforced; `frame-ancestors` is not (navigation lockdown, R6, covers framing).
/// `frame-ancestors 'none'` is still sent: harmless, and correct should WebKit start honoring it.
public enum ContentSecurityPolicy {
  /// The React Fast Refresh preamble `@vitejs/plugin-react` injects inline into the development
  /// `index.html` (plugin 6.1.1, `preambleCode` with base `/`). Vite serializes a tag's string
  /// children verbatim, so the browser hashes exactly this text. If an upgrade changes it, the
  /// development page reports a CSP violation for the preamble and Fast Refresh stops; update
  /// this text from `(await import('@vitejs/plugin-react')).default.preambleCode`.
  public static let reactRefreshPreamble = """
    import { injectIntoGlobalHook } from "/@react-refresh";
    injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    """

  /// `'sha256-…'` source for an inline script's exact text.
  public static func hashSource(ofInlineScript script: String) -> String {
    let digest = SHA256.hash(data: Data(script.utf8))
    return "'sha256-\(Data(digest).base64EncodedString())'"
  }

  /// Release: everything from the bundle, no inline or evaluated script, no frames, and fetches
  /// only to the page's own origin (the relay).
  public static let production = build(scriptExtra: [], connectExtra: [])

  /// Development against the Vite dev server: additionally allows the React refresh preamble by
  /// hash (never `'unsafe-inline'`) and the HMR WebSocket, which Vite opens directly to the dev
  /// server because a scheme handler cannot carry WebSockets (spike S4).
  public static func development(hmr: DevServerOrigin) -> String {
    build(
      scriptExtra: [hashSource(ofInlineScript: reactRefreshPreamble)],
      connectExtra: [hmr.webSocketOrigin])
  }

  private static func build(scriptExtra: [String], connectExtra: [String]) -> String {
    let directives: [(String, [String])] = [
      ("default-src", ["'self'"]),
      ("script-src", ["'self'"] + scriptExtra),
      // Radix, CodeMirror and Mermaid set inline styles.
      ("style-src", ["'self'", "'unsafe-inline'"]),
      ("img-src", ["'self'", "data:", "blob:"]),
      ("font-src", ["'self'"]),
      ("connect-src", ["'self'"] + connectExtra),
      ("object-src", ["'none'"]),
      ("base-uri", ["'self'"]),
      ("form-action", ["'self'"]),
      ("frame-src", ["'none'"]),
      ("frame-ancestors", ["'none'"]),
    ]
    return directives.map { "\($0.0) \($0.1.joined(separator: " "))" }.joined(separator: "; ")
  }
}
