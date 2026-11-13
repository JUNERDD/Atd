import AICore
import AppKit

/// The task panel: a non-activating `NSPanel` with an `NSGlassEffectView` background and the
/// transparent renderer web view on top (Q13). Hiding stays ordered in at alpha 0, ignores mouse
/// events and gives up key status because `orderOut` throttles WebKit timers to 1/s (S7, R9).
final class PanelWindowController: NSObject, NSWindowDelegate {
  let panel: ShellPanel
  let host: WebViewHost
  private let defaults: UserDefaults
  private let placements: PanelPlacementStore
  /// Anchor the panel follows across display changes (`PanelGeometry.follow`).
  private var anchor: PanelAnchor?
  /// True during a user drag (`windowWillMove`); cleared on shell placement, hide or mouse-up.
  private var userMoving = false
  private var placing = false
  private var isPinned = false
  private var systemPanelDepth = 0
  /// A summon put the panel in front, or it gained key uncovered; only then may it float.
  private var holdsFront = false
  private var awaitsKey = false
  private var ordersOutAfterHandoff = false
  private var handoffTask: Task<Void, Never>?
  var onVisibilityChange: ((Bool) -> Void)?
  /// Called when the panel is hidden while it held key status, to pass focus on.
  var onGaveUpKey: (() -> Void)?
  private static let widthKey = "panel.width"
  private static let heightKey = "panel.height"

  init(host: WebViewHost, pinned: Bool, defaults: UserDefaults = .standard) {
    self.host = host
    self.defaults = defaults
    placements = PanelPlacementStore(defaults: defaults)
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
    // Auxiliary lets a summon enter another app's full-screen Space without full-screening itself.
    panel.collectionBehavior = [.fullScreenAuxiliary, .moveToActiveSpace]
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

  isolated deinit { handoffTask?.cancel() }

  var isVisible: Bool { panel.alphaValue > 0 && !panel.ignoresMouseEvents && !panel.isMiniaturized }
  var isKey: Bool { (panel.isKeyWindow || (isVisible && awaitsKey)) && !panel.retainsKeyForHandoff }

  func setTitle(_ title: String) { panel.title = title }

  func setPinned(_ pinned: Bool) {
    isPinned = pinned
    panel.isFloatingPanel = pinned
    updateLevel()
  }

  /// Keep open/save panels above the task panel even if AppKit changes key ownership meanwhile.
  func lowerForSystemPanel() { setSystemPanel(true) }
  func restoreAfterSystemPanel() { setSystemPanel(false) }

  private func setSystemPanel(_ open: Bool) {
    systemPanelDepth = open ? systemPanelDepth + 1 : max(0, systemPanelDepth - 1)
    updateLevel()
  }

  private func updateLevel() {
    // Non-activating key panels stay above frontmost windows reordering on modifiers; never
    // reassign an unchanged level, which orders the window above peers that cover it.
    let floats = isPinned || (holdsFront && isVisible && panel.isKeyWindow)
    let level: NSWindow.Level = systemPanelDepth == 0 && floats ? .floating : .normal
    if panel.level != level { panel.level = level }
  }

  var placement: PanelPlacement {
    get { placements.placement }
    set { placements.placement = newValue }
  }

  /// Places the panel on the cursor's display according to ``placement``, keeping the user's size.
  func placeForSummon() {
    let display = Screens.displayUnderCursor()
    let size = panel.isZoomed ? Self.savedSize(defaults) : ScreenRect(panel.frame).size
    let placed = Self.summonFrame(on: display, size: size, placements)
    applyMinimumSize(display.workArea)
    place(placed.frame)
    anchor = placed.anchor
  }

  func show() {
    resetHandoff()
    if panel.isMiniaturized { panel.deminiaturize(nil) }
    panel.alphaValue = 1
    panel.ignoresMouseEvents = false
    panel.orderFrontRegardless()
    holdsFront = true
    awaitsKey = true
    waitForHandoff { [weak self] released in
      guard let self else { return }
      awaitsKey = false
      guard released, isVisible else { return }
      panel.makeKey()
      updateLevel()
    }
    updateLevel()
    onVisibilityChange?(true)
  }

  func hide() {
    let wasKey = panel.isKeyWindow || panel.retainsKeyForHandoff
    conceal()
    if wasKey { onGaveUpKey?() }
    onVisibilityChange?(false)
  }

  /// Hides visually at once while keeping key absorption until the shortcut's keys come up.
  func hideFromShortcut() {
    let wasKey = panel.isKeyWindow || panel.retainsKeyForHandoff
    conceal()
    onVisibilityChange?(false)
    if wasKey { releaseHiddenKey() }
  }

  private func releaseHiddenKey() {
    panel.retainsKeyForHandoff = true
    waitForHandoff { [weak self] released in
      guard let self else { return }
      panel.retainsKeyForHandoff = false
      if released { onGaveUpKey?() } else { panel.returnKeyboard() }
    }
  }

  private func waitForHandoff(_ completion: @escaping @MainActor (Bool) -> Void) {
    handoffTask?.cancel()
    let source = NSWorkspace.shared.frontmostApplication?.processIdentifier
    let sourceWindow = NSApp.keyWindow
    handoffTask = Task { [weak self] in
      let released = await ShortcutRelease.waitForHandoff(
        until: .now + .seconds(2),
        isValid: {
          NSWorkspace.shared.frontmostApplication?.processIdentifier == source
            && NSApp.keyWindow === sourceWindow
        })
      guard !Task.isCancelled, let self else { return }
      handoffTask = nil
      completion(released)
    }
  }

  private func resetHandoff() {
    handoffTask?.cancel()
    handoffTask = nil
    awaitsKey = false
    ordersOutAfterHandoff = false
    panel.retainsKeyForHandoff = false
  }

  private func conceal() {
    resetHandoff()
    holdsFront = false
    userMoving = false
    panel.alphaValue = 0
    panel.ignoresMouseEvents = true
    updateLevel()
  }

  /// Takes the panel off screen for a capture session and returns what puts it back as it was;
  /// a key panel hides at alpha 0 immediately and defers `orderOut` until the shortcut releases.
  func withdrawForCapture() -> @MainActor () -> Void {
    guard !panel.isMiniaturized else { return {} }
    let visible = isVisible
    let holdsKey = panel.isKeyWindow || panel.retainsKeyForHandoff
    let inUse = visible && (holdsKey || awaitsKey)
    let above = visible && !inUse ? WindowStack.windowsAbove(atLevelOf: panel) : []
    if holdsKey {
      conceal()
      panel.retainsKeyForHandoff = true
      ordersOutAfterHandoff = true
      if visible { onVisibilityChange?(false) }
      waitForHandoff { [weak self] _ in
        guard let self, ordersOutAfterHandoff else { return }
        resetHandoff()
        panel.orderOut(nil)
      }
    } else {
      if visible { hide() }
      panel.orderOut(nil)
    }
    return { [weak self] in
      guard let self else { return }
      resetHandoff()
      if inUse {
        show()
      } else if visible {
        reveal(below: above)
      } else if panel.isKeyWindow {
        releaseHiddenKey()
      } else {
        panel.orderFrontRegardless()
      }
    }
  }

  /// Shows the panel under `windows` (``WindowStack/orderIn(_:below:)``) without taking focus.
  private func reveal(below windows: [CGWindowID]) {
    panel.alphaValue = 1
    panel.ignoresMouseEvents = false
    WindowStack.orderIn(panel, below: windows)
    updateLevel()
    onVisibilityChange?(true)
  }

  // MARK: NSWindowDelegate

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    hide()
    return false
  }

  func windowDidEndLiveResize(_ notification: Notification) {
    defaults.set(panel.frame.width, forKey: Self.widthKey)
    defaults.set(panel.frame.height, forKey: Self.heightKey)
    rememberPosition()
  }

  func windowWillMove(_ notification: Notification) {
    if !placing { userMoving = true }
  }

  /// AppKit may report a drag's last move after mouse-up, so record it before ending the drag.
  func windowDidMove(_ notification: Notification) {
    guard userMoving else { return }
    rememberPosition()
    if NSEvent.pressedMouseButtons & 1 == 0 { userMoving = false }
  }

  /// Key status inherited when another Atd window resigns must not float a covered panel.
  func windowDidBecomeKey(_ notification: Notification) {
    awaitsKey = false
    if !holdsFront { holdsFront = !WindowStack.isCovered(panel) }
    updateLevel()
    host.setState(.windowActive(.init(active: true)))
  }

  func windowDidResignKey(_ notification: Notification) {
    let ordersOut = ordersOutAfterHandoff
    if ordersOut || !isVisible { resetHandoff() } else { awaitsKey = false }
    if ordersOut { panel.orderOut(nil) }
    holdsFront = false
    updateLevel()
    host.setState(.windowActive(.init(active: false)))
  }

  /// Keeps anchored panels with their display and clamps moved ones inside the new work area.
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

  /// Records the unzoomed panel offset on the display holding most of it.
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
    let (w, h) = (defaults.double(forKey: widthKey), defaults.double(forKey: heightKey))
    return w > 0 && h > 0 ? WindowSize(width: w, height: h) : PanelGeometry.defaultSize
  }
}

/// Non-activating summonable task panel (S7); direct clicks activate natively when available, and
/// hidden `canBecomeKey` stays false outside shortcut handoff so resigning HUDs skip it.
final class ShellPanel: NSPanel {
  private var nativeClickActivation = false
  var retainsKeyForHandoff = false

  /// Configured once for the task panel; mini panels keep non-activating clicks for selection.
  func configureClickActivation() {
    nativeClickActivation = PanelClickActivation.configure(self)
  }

  override var canBecomeKey: Bool {
    retainsKeyForHandoff || (alphaValue > 0 && !ignoresMouseEvents && !isMiniaturized)
  }
  override var canBecomeMain: Bool { false }

  override func sendEvent(_ event: NSEvent) {
    // Fall back to explicit activation on click only when the native capability is unavailable.
    if !nativeClickActivation, canBecomeKey,
      [.leftMouseDown, .rightMouseDown, .otherMouseDown].contains(event.type)
    {
      NSApp.activate()
    }
    super.sendEvent(event)
  }
}
