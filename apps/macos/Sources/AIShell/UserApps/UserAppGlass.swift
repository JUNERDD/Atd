import AICore
import AppKit
import OSLog
import WebKit

/// A glass app's window background, the computer-use monitor's recipe: the window material
/// (``GlassBackground``) pinned to the page's color scheme with its adaptation off
/// (``GlassSurface/pin(_:to:)``), so the glass never drifts with the brightness behind the window,
/// under the translucent fill the page paints (`--ata-surface-panel`). It starts dark, the
/// starter's default, and is pinned again whenever the page reports another scheme
/// (``UserAppColorSchemeHandler``).
///
/// Only the glass takes the page's scheme. Its content, the page's web view, keeps the app's
/// appearance (the user's Theme setting or the system's), which it would otherwise inherit from
/// the pinned glass: a page that follows `prefers-color-scheme` would then see the scheme it
/// reported itself and never leave it. The window's own appearance is never set, for the same
/// reason.
final class UserAppGlass {
  /// The window's content view.
  let view: NSView
  private let material: NativeMaterialView
  private var isDark = true
  private var appAppearance: NSKeyValueObservation?

  init(content: NSView) {
    material = GlassBackground.material(content: content)
    view = material.view
    GlassSurface.pin(material, to: NSAppearance(named: .darkAqua))
    appAppearance = NSApplication.shared.observe(\.effectiveAppearance, options: .initial) {
      [weak content] app, _ in
      MainActor.assumeIsolated { content?.appearance = app.effectiveAppearance }
    }
  }

  /// The page reported its scheme: the glass is pinned to it when it changed.
  func pin(dark: Bool) {
    guard dark != isDark else { return }
    isDark = dark
    GlassSurface.pin(material, to: NSAppearance(named: dark ? .darkAqua : .aqua))
  }
}

/// Hears a glass page's color scheme from the shell's own script in the isolated `.defaultClient`
/// world (``UserAppPageScripts/colorScheme``). It is registered in that world alone, so the page's
/// scripts can neither see nor call it. A report counts only from the main frame of the app's own
/// origin and only as `"dark"` or `"light"`; anything else is dropped.
final class UserAppColorSchemeHandler: NSObject, WKScriptMessageHandler {
  /// Receives the page's scheme: true for dark.
  var onChange: ((_ dark: Bool) -> Void)?
  private let appId: String
  private static let log = Logger(subsystem: "com.junerdd.ai", category: "user-apps")

  init(appId: String) {
    self.appId = appId
  }

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    let origin = message.frameInfo.securityOrigin
    guard
      UserAppOrigin.isTrustedSender(
        scheme: origin.protocol, host: origin.host, port: origin.port,
        isMainFrame: message.frameInfo.isMainFrame, appId: appId),
      let scheme = message.body as? String, scheme == "dark" || scheme == "light"
    else { return Self.log.error("Refused a color scheme report.") }
    onChange?(scheme == "dark")
  }
}
