import AICore
import AppKit

/// The task panel: a non-activating `NSPanel` whose background is an `NSGlassEffectView` with
/// the transparent renderer web view on top (grill decision Q13). The native window owns the
/// clipping, edge and shadow; the page paints no window shell.
///
/// Hiding follows spike S7 and plan decision R9: the panel stays ordered in at alpha 0, ignores
/// the mouse and gives up key status, because `orderOut` drops WebKit's timers to 1/s. Alpha 0
/// alone keeps timers and animation frames at full rate, so occlusion detection stays on.
final class PanelWindowController: NSObject, NSWindowDelegate {
  let panel: ShellPanel
  let host: WebViewHost
  private let defaults: UserDefaults
  /// The work area the panel was last docked against; see `PanelGeometry.follow`.
  private var dockedWorkArea: ScreenRect?
  /// Called with the new visibility after every show and hide.
  var onVisibilityChange: ((Bool) -> Void)?
  /// Called when the panel is hidden while it held key status, to pass focus on.
  var onGaveUpKey: (() -> Void)?

  private static let widthKey = "panel.width"
  private static let heightKey = "panel.height"

  init(host: WebViewHost, pinned: Bool, defaults: UserDefaults = .standard) {
    self.host = host
    self.defaults = defaults
    let workArea = Screens.workAreaUnderCursor()
    panel = ShellPanel(
      contentRect: NSRect(PanelGeometry.dockedFrame(in: workArea, size: Self.savedSize(defaults))),
      styleMask: [
        .titled, .closable, .miniaturizable, .resizable, .fullSizeContentView, .nonactivatingPanel,
      ],
      backing: .buffered, defer: false)
    super.init()
    dockedWorkArea = workArea
    // The page's 52px header sits on this bar, so the traffic lights center on its controls.
    UnifiedTitleBar.apply(to: panel, identifier: "panel.titleBar")
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.hidesOnDeactivate = false
    panel.becomesKeyOnlyIfNeeded = false
    panel.isReleasedWhenClosed = false
    panel.isExcludedFromWindowsMenu = true
    panel.collectionBehavior = [.fullScreenNone, .moveToActiveSpace]
    panel.contentView = GlassBackground.make(content: host.container)
    panel.delegate = self
    applyMinimumSize(workArea)
    setPinned(pinned)
    // Resident from launch: ordered in, invisible, not clickable.
    panel.alphaValue = 0
    panel.ignoresMouseEvents = true
    panel.orderFrontRegardless()
    NotificationCenter.default.addObserver(
      self, selector: #selector(screensChanged),
      name: NSApplication.didChangeScreenParametersNotification, object: nil)
  }

  var isVisible: Bool { panel.alphaValue > 0 && !panel.ignoresMouseEvents && !panel.isMiniaturized }
  var isKey: Bool { panel.isKeyWindow }

  func setTitle(_ title: String) { panel.title = title }

  func setPinned(_ pinned: Bool) {
    panel.isFloatingPanel = pinned
    panel.level = pinned ? .floating : .normal
  }

  /// Floats below system panels (open and save) while one is open; returns the level to restore.
  func lowerForSystemPanel() -> NSWindow.Level {
    let level = panel.level
    panel.level = .normal
    return level
  }

  func restoreLevel(_ level: NSWindow.Level) { panel.level = level }

  /// Re-docks at the bottom-right of the display under the cursor, keeping the user's size.
  func dockAtCursor() {
    let workArea = Screens.workAreaUnderCursor()
    let size = panel.isZoomed ? Self.savedSize(defaults) : ScreenRect(panel.frame).size
    applyMinimumSize(workArea)
    panel.setFrame(NSRect(PanelGeometry.dockedFrame(in: workArea, size: size)), display: true)
    dockedWorkArea = workArea
  }

  func show() {
    if panel.isMiniaturized { panel.deminiaturize(nil) }
    panel.alphaValue = 1
    panel.ignoresMouseEvents = false
    panel.orderFrontRegardless()
    panel.makeKey()
    onVisibilityChange?(true)
  }

  func hide() {
    let wasKey = panel.isKeyWindow
    panel.alphaValue = 0
    panel.ignoresMouseEvents = true
    if wasKey { onGaveUpKey?() }
    onVisibilityChange?(false)
  }

  /// Takes the panel off screen for a capture session and returns what puts it back as it was.
  /// A resident panel is ordered out too, not only a visible one, so no panel state can take
  /// key status or events while the overlays are up; `orderOut`'s timer throttling (R9) only
  /// lasts as long as the session. A miniaturized panel is left alone.
  func withdrawForCapture() -> @MainActor () -> Void {
    guard !panel.isMiniaturized else { return {} }
    let visible = isVisible
    if visible { hide() }
    panel.orderOut(nil)
    return { [weak self] in
      guard let self else { return }
      if visible { show() } else { panel.orderFrontRegardless() }
    }
  }

  // MARK: NSWindowDelegate

  /// The close button dismisses like the in-panel hide control; quitting releases the panel.
  func windowShouldClose(_ sender: NSWindow) -> Bool {
    hide()
    return false
  }

  /// Only an edge drag by the user replaces the remembered size.
  func windowDidEndLiveResize(_ notification: Notification) {
    defaults.set(panel.frame.width, forKey: Self.widthKey)
    defaults.set(panel.frame.height, forKey: Self.heightKey)
  }

  func windowDidBecomeKey(_ notification: Notification) {
    host.setState(.windowActive(.init(active: true)))
  }

  func windowDidResignKey(_ notification: Notification) {
    host.setState(.windowActive(.init(active: false)))
  }

  /// A display change: a panel still docked follows its corner, a moved one stays inside.
  @objc private func screensChanged() {
    let frame = ScreenRect(panel.frame)
    let workArea = Screens.workArea(containing: frame)
    applyMinimumSize(workArea)
    let next = PanelGeometry.follow(frame, docked: dockedWorkArea, workArea: workArea)
    dockedWorkArea = next.docked
    if next.frame != frame { panel.setFrame(NSRect(next.frame), display: true) }
  }

  private func applyMinimumSize(_ workArea: ScreenRect) {
    let minimum = PanelGeometry.minimumSize(in: workArea)
    panel.minSize = NSSize(width: minimum.width, height: minimum.height)
  }

  private static func savedSize(_ defaults: UserDefaults) -> WindowSize {
    let width = defaults.double(forKey: widthKey)
    let height = defaults.double(forKey: heightKey)
    return width > 0 && height > 0
      ? WindowSize(width: width, height: height) : PanelGeometry.defaultSize
  }
}

/// A panel that can become key although it never activates the app, so the page gets the
/// keyboard while the other app keeps the menu bar (spike S7).
final class ShellPanel: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}
