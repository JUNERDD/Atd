import AICore
import AppKit
import WebKit

/// The welcome guide's window: a transparent, borderless stage covering the whole display under
/// the cursor, menu bar and Dock included. The page draws the scrim, opening page and card; under
/// them the shell lays the panel's and Settings' window material (``GlassBackground``), placed,
/// rounded and shown as the page reports its surface (`onboarding.surface`: the opening page's
/// whole box, then the card's), since a page cannot draw the desktop's glass itself. There is no
/// title bar or window shadow. It stays above the menu bar while the intro plays; from
/// ``settle()`` on it stays above other apps' windows (see ``applyLevel(for:)``). The window owns its
/// renderer web view (loaded at `#onboarding`); closing releases both, and opening again builds
/// fresh ones.
/// The shell opens it for the panel page's first-run decision (`app.startup`), or the user opens
/// it through the Welcome Guide menu item.
final class OnboardingWindowController: NSObject, NSWindowDelegate {
  private var window: NSWindow?
  /// The guide's glass, behind the page; hidden (alpha 0) until the page reports a surface.
  private var surface: NSGlassEffectView?
  /// Whether the glass is shown or fading in, so only the first rect after a hide fades.
  private var surfaceShown = false
  /// Whether the intro is over (``settle()``), so ``applyLevel(for:)`` owns the window's level.
  private var settled = false
  private(set) var host: WebViewHost?
  private let makeHost: () -> WebViewHost
  /// Runs as the window closes, by Skip, the last step or its close button.
  var onClose: (() -> Void)?

  /// Above the menu bar (`.mainMenu`) and the Dock, which the stage must cover for the intro.
  private static let introLevel = NSWindow.Level.statusBar
  /// The page settles the stage when its intro ends (a few seconds); a page that never does (it
  /// failed to load, or threw) must not keep a window above the menu bar, so the shell settles
  /// it after this long regardless.
  private static let settleDeadline: Duration = .seconds(12)
  init(makeHost: @escaping () -> WebViewHost) {
    self.makeHost = makeHost
    super.init()
    NotificationCenter.default.addObserver(
      self, selector: #selector(screensChanged),
      name: NSApplication.didChangeScreenParametersNotification, object: nil)
    // Every change of the app in front, Atd's own included, arrives here.
    NSWorkspace.shared.notificationCenter.addObserver(
      self, selector: #selector(appActivated(_:)),
      name: NSWorkspace.didActivateApplicationNotification, object: nil)
  }

  var isKey: Bool { window?.isKeyWindow == true }

  /// Activates the app and shows the stage over the display under the cursor, or brings an open
  /// one forward with its page as it is.
  func open(title: String) {
    NSApp.activate()
    if let window {
      window.makeKeyAndOrderFront(nil)
      return
    }
    let window = OnboardingStageWindow(
      contentRect: NSRect(Screens.frameUnderCursor()),
      styleMask: [.borderless], backing: .buffered, defer: false)
    let host = makeHost()
    // A borderless window shows no title; it still names the window to the Window menu and
    // accessibility.
    window.title = title
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.isReleasedWhenClosed = false
    window.level = Self.introLevel
    // Like the panel: it appears on the Space the user is on, and never becomes a full-screen
    // window of its own, which would move it to a Space of its own.
    window.collectionBehavior = [.moveToActiveSpace, .fullScreenNone]
    let surface = GlassBackground.material()
    surface.alphaValue = 0
    window.contentView = Self.stage(surface: surface, page: host.container)
    window.delegate = self
    self.window = window
    self.surface = surface
    surfaceShown = false
    settled = false
    self.host = host
    host.load()
    window.makeKeyAndOrderFront(nil)
    Task { @MainActor [weak self, weak window] in
      try? await Task.sleep(for: Self.settleDeadline)
      if let window, self?.window === window { self?.settle() }
    }
  }

  /// The intro is over: the stage leaves the menu bar's level for ``applyLevel(for:)``'s.
  /// Idempotent, and a no-op without an open guide.
  func settle() {
    guard window != nil else { return }
    settled = true
    applyLevel(for: NSWorkspace.shared.frontmostApplication)
  }

  /// The settled stage's level, from the app in front. Atd: a normal window, so Atd's own panel
  /// and windows order with it as usual. System Settings: normal too, so the permission rows'
  /// Privacy & Security pages (and their drag-to-allow guide) come in front of it. Any other app:
  /// it floats above that app's windows, so the guide is never buried; in particular when System
  /// Settings closes, macOS brings forward whichever regular app is next, never Atd (an agent
  /// app), and this lifts the stage at that moment rather than when System Settings has quit.
  private func applyLevel(for front: NSRunningApplication?) {
    guard let window, settled else { return }
    let yields =
      front?.processIdentifier == ProcessInfo.processInfo.processIdentifier
      || front?.bundleIdentifier == SettingsWindowTracker.bundleIdentifier
    window.level = yields ? .normal : .floating
  }

  /// The app the notification names, not `frontmostApplication`, which still reports the previous
  /// app while this notification is delivered (System Settings, as it closes).
  @objc private func appActivated(_ notification: Notification) {
    applyLevel(
      for: notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)
  }

  /// Makes an open, visible window key again; false when there is none to focus.
  func focusIfShown() -> Bool {
    guard let window, window.isVisible else { return false }
    window.makeKeyAndOrderFront(nil)
    return true
  }

  func setTitle(_ title: String) { window?.title = title }

  func close() { window?.close() }

  func windowWillClose(_ notification: Notification) {
    host?.close()
    host = nil
    window?.delegate = nil
    window = nil
    surface = nil
    surfaceShown = false
    settled = false
    onClose?()
  }

  /// The window's content: the guide's glass, with the transparent page over it filling the stage
  /// edge to edge. The glass keeps the frame ``setSurface(_:from:)`` gives it.
  private static func stage(surface: NSView, page: NSView) -> NSView {
    let stage = NSView()
    stage.addSubview(surface)
    page.frame = stage.bounds
    page.autoresizingMask = [.width, .height]
    stage.addSubview(page)
    return stage
  }

  /// Lays the glass under the surface the guide's page reports (`onboarding.surface`), in CSS
  /// pixels from its web view's top-left: the first rect fades it in, later ones move it at once,
  /// and `null` fades it out, each fade over the post's `fade` seconds (the page paces it with its
  /// own timeline). Other pages' posts, non-finite values and an empty rect (after clamping to the
  /// web view) are ignored.
  func setSurface(_ post: OnboardingSurfacePost, from sender: WebViewHost) {
    guard sender === host, let surface, let stage = surface.superview else { return }
    guard let rect = post.rect else {
      if surfaceShown { fade(surface, to: 0, over: post.fade) }
      surfaceShown = false
      return
    }
    let webView = sender.webView
    guard post.radius.isFinite,
      let inView = Self.viewRect(
        CGRect(x: rect.x, y: rect.y, width: rect.width, height: rect.height), in: webView)
    else { return }
    surface.frame = webView.convert(inView, to: stage)
    surface.cornerRadius = post.radius * webView.pageZoom * webView.magnification
    if !surfaceShown { fade(surface, to: 1, over: post.fade) }
    surfaceShown = true
  }

  /// A rect the guide's page reports in CSS pixels from its web view's top-left, in Cocoa global
  /// points (origin at the primary display's bottom-left, y up); nil for another page's post, a
  /// closed guide, non-finite values or a rect empty once clamped to the web view.
  func screenRect(_ css: CGRect, from sender: WebViewHost) -> CGRect? {
    guard sender === host, let window else { return nil }
    let webView = sender.webView
    guard let inView = Self.viewRect(css, in: webView) else { return nil }
    return window.convertToScreen(webView.convert(inView, to: nil))
  }

  /// `css` (CSS pixels from the web view's top-left) in the web view's own coordinates, clamped
  /// to its bounds; nil when non-finite or empty after clamping.
  private static func viewRect(_ css: CGRect, in webView: WKWebView) -> CGRect? {
    let values = [css.origin.x, css.origin.y, css.width, css.height]
    guard values.allSatisfy(\.isFinite) else { return nil }
    // CSS pixels to the web view's points, top-left origin.
    let scale = webView.pageZoom * webView.magnification
    let page = CGRect(
      x: css.origin.x * scale, y: css.origin.y * scale, width: css.width * scale,
      height: css.height * scale)
    let local = page.intersection(CGRect(origin: .zero, size: webView.bounds.size))
    guard !local.isNull, local.width > 0, local.height > 0 else { return nil }
    return webView.isFlipped
      ? local
      : CGRect(
        x: local.minX, y: webView.bounds.height - local.maxY, width: local.width,
        height: local.height)
  }

  private func fade(_ view: NSView, to alpha: CGFloat, over duration: TimeInterval) {
    NSAnimationContext.runAnimationGroup { context in
      context.duration = duration
      context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
      view.animator().alphaValue = alpha
    }
  }

  func windowDidBecomeKey(_ notification: Notification) {
    host?.setState(.windowActive(.init(active: true)))
  }

  func windowDidResignKey(_ notification: Notification) {
    host?.setState(.windowActive(.init(active: false)))
  }

  /// Refits the stage to its display's frame when displays change resolution or arrangement; if
  /// its display is gone, to the display under the cursor.
  @objc private func screensChanged() {
    guard let window else { return }
    let frame = ScreenRect(window.frame)
    let next = Screens.frame(containing: frame)
    if next != frame { window.setFrame(NSRect(next), display: true) }
  }
}

/// A borderless window refuses key and main status by default, which would leave the guide's
/// keyboard (Esc, Return, Space, Tab) unreachable. AppKit also keeps windows out from under the
/// menu bar; the stage opts out of that so it covers the display's full frame.
private final class OnboardingStageWindow: NSWindow {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { true }

  override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
    frameRect
  }
}
