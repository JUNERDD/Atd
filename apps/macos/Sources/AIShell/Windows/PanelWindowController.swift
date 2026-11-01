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
  private let placements: PanelPlacementStore
  /// The anchor the panel was last placed against, which it keeps to across display changes
  /// while it stays there; see `PanelGeometry.follow`.
  private var anchor: PanelAnchor?
  /// The user is moving the panel: AppKit sent `windowWillMove`, which it sends when the user
  /// starts a drag (on the title bar or a page drag region, `performDrag`); the shell's own
  /// frame changes never set it (``placing``). Moves made while it is set are remembered as where
  /// the user left the panel; programmatic placement, display changes and hiding clear it, as
  /// does the first move once the mouse button is up.
  private var userMoving = false
  /// The shell itself is setting the frame, which never counts as the user's move.
  private var placing = false
  /// Called with the new visibility after every show and hide.
  var onVisibilityChange: ((Bool) -> Void)?
  /// Called when the panel is hidden while it held key status, to pass focus on.
  var onGaveUpKey: (() -> Void)?

  private static let widthKey = "panel.width"
  private static let heightKey = "panel.height"

  init(host: WebViewHost, pinned: Bool, defaults: UserDefaults = .standard) {
    self.host = host
    self.defaults = defaults
    let placements = PanelPlacementStore(defaults: defaults)
    self.placements = placements
    let display = Screens.displayUnderCursor()
    let placed = Self.summonFrame(on: display, size: Self.savedSize(defaults), placements)
    panel = ShellPanel(
      contentRect: NSRect(placed.frame),
      styleMask: [
        .titled, .closable, .miniaturizable, .resizable, .fullSizeContentView, .nonactivatingPanel,
      ],
      backing: .buffered, defer: false)
    super.init()
    anchor = placed.anchor
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
    applyMinimumSize(display.workArea)
    setPinned(pinned)
    panel.configureClickActivation()
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
    FocusDiagnostics.shared.record("panel.pinned", details: ["pinned": .bool(pinned)])
  }

  /// Floats below system panels (open and save) while one is open; returns the level to restore.
  func lowerForSystemPanel() -> NSWindow.Level {
    let level = panel.level
    panel.level = .normal
    return level
  }

  func restoreLevel(_ level: NSWindow.Level) { panel.level = level }

  /// Where summons show the panel. A change applies from the next summon: a visible panel
  /// stays where it is.
  var placement: PanelPlacement {
    get { placements.placement }
    set { placements.placement = newValue }
  }

  /// Places the panel for a summon on the display under the cursor, keeping the user's size:
  /// in the work area's bottom-right corner, its center, or where the user last left it on that
  /// display (its center until they have), as ``placement`` says.
  func placeForSummon() {
    let display = Screens.displayUnderCursor()
    let size = panel.isZoomed ? Self.savedSize(defaults) : ScreenRect(panel.frame).size
    let placed = Self.summonFrame(on: display, size: size, placements)
    applyMinimumSize(display.workArea)
    place(placed.frame)
    anchor = placed.anchor
  }

  func show() {
    FocusDiagnostics.shared.record("panel.show.before")
    if panel.isMiniaturized { panel.deminiaturize(nil) }
    panel.alphaValue = 1
    panel.ignoresMouseEvents = false
    panel.orderFrontRegardless()
    panel.makeKey()
    FocusDiagnostics.shared.record("panel.show.after")
    onVisibilityChange?(true)
  }

  func hide() {
    FocusDiagnostics.shared.record("panel.hide.before")
    let wasKey = panel.isKeyWindow
    userMoving = false
    panel.alphaValue = 0
    panel.ignoresMouseEvents = true
    if wasKey { onGaveUpKey?() }
    onVisibilityChange?(false)
    FocusDiagnostics.shared.record("panel.hide.after")
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

  /// Only an edge drag by the user replaces the remembered size; a drag on the left or top edge
  /// moves the panel as well.
  func windowDidEndLiveResize(_ notification: Notification) {
    defaults.set(panel.frame.width, forKey: Self.widthKey)
    defaults.set(panel.frame.height, forKey: Self.heightKey)
    rememberPosition()
  }

  func windowWillMove(_ notification: Notification) {
    if !placing { userMoving = true }
  }

  /// AppKit may report a drag's last move after the button is released, so that move still
  /// counts before the drag ends.
  func windowDidMove(_ notification: Notification) {
    guard userMoving else { return }
    rememberPosition()
    if NSEvent.pressedMouseButtons & 1 == 0 { userMoving = false }
  }

  func windowDidBecomeKey(_ notification: Notification) {
    host.setState(.windowActive(.init(active: true)))
  }

  func windowDidResignKey(_ notification: Notification) {
    host.setState(.windowActive(.init(active: false)))
  }

  /// A display change: a panel still at its corner or center follows it, a moved one or one
  /// shown where the user left it stays inside. Moves AppKit makes for the change are not the
  /// user's.
  @objc private func screensChanged() {
    userMoving = false
    let frame = ScreenRect(panel.frame)
    let workArea = Screens.workArea(containing: frame)
    applyMinimumSize(workArea)
    let next = PanelGeometry.follow(frame, anchor: anchor, workArea: workArea)
    anchor = next.anchor
    if next.frame != frame { place(next.frame) }
  }

  private func place(_ frame: ScreenRect) {
    userMoving = false
    placing = true
    defer { placing = false }
    panel.setFrame(NSRect(frame), display: true)
  }

  /// Records where the panel sits on the display holding most of it. A zoomed panel fills the
  /// work area by the system's choice, not where the user put it.
  private func rememberPosition() {
    guard !panel.isZoomed else { return }
    let frame = ScreenRect(panel.frame)
    let display = Screens.display(containing: frame)
    guard let uuid = display.uuid else { return }
    placements.remember(PanelGeometry.offset(of: frame, in: display.workArea), onDisplay: uuid)
  }

  private static func summonFrame(
    on display: Screens.Display, size: WindowSize, _ placements: PanelPlacementStore
  ) -> (frame: ScreenRect, anchor: PanelAnchor?) {
    PanelGeometry.summonFrame(
      placements.placement, in: display.workArea, size: size,
      remembered: display.uuid.flatMap(placements.position(onDisplay:)))
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

/// A panel that can become key on summon without activating the app, so the page gets the
/// keyboard while the other app keeps the menu bar (spike S7). Direct clicks use normal native
/// activation when available. Hidden, it stays ordered in for WebKit's timers but must not inherit
/// the keyboard when the command island resigns it: the next summon would otherwise read this
/// invisible panel instead of the original selection.
final class ShellPanel: NSPanel {
  private(set) var nativeClickActivation = false

  /// Configured once before this task panel is first ordered in; mini panels keep their own
  /// non-activating clicks so their actions can still capture the source application's selection.
  func configureClickActivation() {
    nativeClickActivation = PanelClickActivation.configure(self)
  }

  override var canBecomeKey: Bool {
    alphaValue > 0 && !ignoresMouseEvents && !isMiniaturized
  }
  override var canBecomeMain: Bool { false }

  override func sendEvent(_ event: NSEvent) {
    // If the private capability is unavailable, keep the previous click activation request.
    // Native clicks otherwise pass through once, including their drag and mouse-up sequence.
    switch event.type {
    case .leftMouseDown, .rightMouseDown, .otherMouseDown:
      FocusDiagnostics.shared.mouse(event, stage: "native.mouse.before")
      if !nativeClickActivation, canBecomeKey {
        let attempt = FocusDiagnostics.shared.record("native.activation.request")
        NSApp.activate()
        FocusDiagnostics.shared.record("native.activation.return", correlation: attempt)
        FocusDiagnostics.shared.burst(correlation: attempt, activation: true)
      }
    default: break
    }
    super.sendEvent(event)
    switch event.type {
    case .leftMouseDown, .rightMouseDown, .otherMouseDown:
      FocusDiagnostics.shared.mouse(event, stage: "native.mouse.after")
    default: break
    }
  }
}
