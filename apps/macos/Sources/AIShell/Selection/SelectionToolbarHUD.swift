import AICore
import AppKit

/// The `toggle` mode's status HUD: while the selection toolbar listens, a small Liquid Glass
/// capsule (``AnnotationGlassBar``) near the bottom of the screen says so and names the keys that
/// turn it off (``SelectionToolbarHUDContent``). It enters like the selection toolbar
/// (``SelectionToolbarEntrance``, growing from its bottom edge) and follows the pointer the same
/// way (``SelectionToolbarHover``: the button wash and pointing hand, the open hand on the grip).
/// Turning listening off, or its close button, fades it out as it is. Turning listening off while
/// the close button had hidden it shows a brief off notice instead (``noticeDuration``), since
/// nothing on screen would otherwise answer the keys.
///
/// It never takes the keyboard (``ToolbarWindow``) and joins every Space. Its surface or grip
/// drags it within the work area of the display under it, and it stays where it is dropped while
/// it is on screen; a double-click puts it back, and every appearance starts at the bottom centre
/// of the display under the pointer. Its close button
/// hides it until listening next turns on. The page's `showHud` turns it off altogether.
///
/// Hover tracking pauses while the pointer rests away from it; a tracking area over the window,
/// transparent margin included, wakes it as the pointer comes near, so the HUD never watches the
/// pointer across other apps however long it stays up.
final class SelectionToolbarHUD: NSObject {
  static let exitDuration = 0.2
  /// How long the off notice stays before it exits.
  static let noticeDuration: Duration = .seconds(1.2)
  /// Distance from the bottom of the work area at the default position.
  static let bottomMargin: CGFloat = 24
  /// The transparent margin around the capsule, so its shadow and entrance are never cut off.
  static let inset: CGFloat = 24

  private let window: ToolbarWindow
  private let hover = SelectionToolbarHover()
  /// The page's `showHud`.
  private var enabled = true
  /// The combination as keycap symbols, for the hint.
  private var keys: [String] = []
  private var listening = false
  /// The close button hid it; cleared when listening turns off.
  private var dismissed = false
  private var dragOrigin: NSPoint?
  /// Where the capsule was dropped while it is on screen; every appearance starts at home.
  private var dropped: NSPoint?
  /// Bumped by every show, so an exit still fading never hides a HUD shown again meanwhile.
  private var generation = 0

  override init() {
    window = ToolbarWindow(
      contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: true)
    super.init()
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.level = .statusBar
    window.hidesOnDeactivate = false
    window.isReleasedWhenClosed = false
    window.becomesKeyOnlyIfNeeded = true
    window.collectionBehavior = [
      .canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle,
    ]
    NotificationCenter.default.addObserver(
      self, selector: #selector(languageChanged), name: ShellStrings.didChange, object: nil)
  }

  /// A HUD on screen takes the new language in place; an off notice just runs out.
  @objc private func languageChanged() {
    if listening, !dismissed, window.isVisible, window.alphaValue == 1 { show() }
  }

  /// What the page pushed: whether the HUD may show, and the combination it names.
  func configure(enabled: Bool, keys: Set<SelectionActivation.Key>) {
    let symbols = Self.symbols(keys)
    let changed = enabled != self.enabled || symbols != self.keys
    self.enabled = enabled
    self.keys = symbols
    if !enabled {
      hide()
    } else if changed, listening, !dismissed {
      show()
    }
  }

  /// Listening turned on or off.
  func setListening(_ on: Bool) {
    guard on != listening else { return }
    listening = on
    guard enabled else { return }
    if on {
      show()
    } else if dismissed {
      dismissed = false
      showNotice()
    } else {
      exit()
    }
  }

  /// The off notice: enters like the HUD, then exits after ``noticeDuration`` unless something
  /// showed meanwhile.
  private func showNotice() {
    show(notice: true)
    let current = generation
    Task { [weak self] in
      try? await Task.sleep(for: Self.noticeDuration)
      guard let self, self.generation == current else { return }
      self.exit()
    }
  }

  // MARK: Showing

  /// Builds the capsule (the HUD, or the off `notice`) where it belongs; one not yet on screen
  /// enters.
  private func show(notice: Bool = false) {
    generation += 1
    // Every appearance starts at home, even one that interrupts the exit fade.
    let appearing = !window.isVisible || window.alphaValue < 1
    if appearing { dropped = nil }
    let (bar, close, grip) = notice ? makeNotice() : makeContent()
    let size = bar.fittingSize
    let capsule = NSRect(origin: capsuleOrigin(size: size), size: size)
    let frame = clamped(capsule).insetBy(dx: -Self.inset, dy: -Self.inset)
    let container = HUDContainer(frame: NSRect(origin: .zero, size: frame.size))
    container.wantsLayer = true
    container.onPointerNear = { [weak self] in self?.hover.pointerMoved() }
    bar.frame = container.bounds.insetBy(dx: Self.inset, dy: Self.inset)
    container.addSubview(bar)
    window.contentView = container
    window.setFrame(frame, display: true)
    window.alphaValue = 1
    window.orderFrontRegardless()
    if appearing {
      SelectionToolbarEntrance.play(on: container, capsule: bar.frame, upward: true)
    }
    if let close, let grip {
      hover.start([close], grip: grip, in: container)
    } else {
      hover.stop()
    }
  }

  /// Fades out as it is, then leaves the screen.
  private func exit() {
    guard window.isVisible else { return }
    let current = generation
    hover.stop()
    NSAnimationContext.runAnimationGroup { context in
      context.duration = Self.exitDuration
      window.animator().alphaValue = 0
    } completionHandler: { [weak self] in
      MainActor.assumeIsolated {
        guard let self, self.generation == current else { return }
        self.hide()
      }
    }
  }

  private func hide() {
    hover.stop()
    dragOrigin = nil
    dropped = nil
    guard window.isVisible else { return }
    window.orderOut(nil)
    window.contentView = nil
  }

  /// The capsule, its close button and its grip (what hover tracking follows).
  private func makeContent() -> (AnnotationGlassBar, AnnotationToolbarButton?, NSView?) {
    let strings = ShellStrings.shared
    let close = AnnotationToolbarButton(selection: nil, action: #selector(closeClicked))
    close.image = AnnotationIcons.glyph(
      AnnotationIcons.cancel, label: strings.text(.selectionHudHide))
    close.setAccessibilityLabel(strings.text(.selectionHudHide))
    close.toolTip = strings.text(.selectionHudHide)
    close.target = self
    let (row, text) = SelectionToolbarHUDContent.row(keys: keys, close: close)
    let bar = AnnotationGlassBar(groups: [row], padding: SelectionToolbarLayout.padding)
    bar.onDrag = { [weak self] in self?.drag($0) }
    bar.setAccessibilityElement(true)
    bar.setAccessibilityRole(.group)
    bar.setAccessibilityLabel(text)
    return (bar, close, row.first { $0 is AnnotationBarGrip } ?? bar)
  }

  /// The off notice's capsule: nothing to follow, move or close.
  private func makeNotice() -> (AnnotationGlassBar, AnnotationToolbarButton?, NSView?) {
    let (row, text) = SelectionToolbarHUDContent.offRow()
    let bar = AnnotationGlassBar(groups: [row], padding: SelectionToolbarLayout.padding)
    bar.setAccessibilityElement(true)
    bar.setAccessibilityRole(.group)
    bar.setAccessibilityLabel(text)
    return (bar, nil, nil)
  }

  @objc private func closeClicked() {
    dismissed = true
    exit()
  }

  // MARK: Placing

  /// Where it was dropped while on screen (a rebuild in place), or its home: the bottom centre
  /// of the display under the pointer.
  private func capsuleOrigin(size: NSSize) -> NSPoint {
    if let dropped { return dropped }
    let pointer = NSEvent.mouseLocation
    let screen = NSScreen.screens.first { $0.frame.contains(pointer) } ?? NSScreen.main
    guard let area = screen?.visibleFrame else { return .zero }
    return NSPoint(x: area.midX - size.width / 2, y: area.minY + Self.bottomMargin)
  }

  private func drag(_ drag: AnnotationGlassBar.Drag) {
    switch drag {
    case .began:
      dragOrigin = window.frame.origin
    case .moved(let travel):
      guard let dragOrigin else { return }
      var capsule = window.frame.insetBy(dx: Self.inset, dy: Self.inset)
      capsule.origin = NSPoint(
        x: dragOrigin.x + Self.inset + travel.dx, y: dragOrigin.y + Self.inset - travel.dy)
      let placed = clamped(capsule)
      window.setFrameOrigin(NSPoint(x: placed.minX - Self.inset, y: placed.minY - Self.inset))
      dropped = placed.origin
    case .reset:
      dragOrigin = nil
      dropped = nil
      let capsule = window.frame.insetBy(dx: Self.inset, dy: Self.inset)
      let home = clamped(NSRect(origin: capsuleOrigin(size: capsule.size), size: capsule.size))
      window.setFrame(home.insetBy(dx: -Self.inset, dy: -Self.inset), display: true, animate: true)
    }
  }

  /// `frame` kept ``SelectionToolbarPlacement/margin`` inside the work area of the display that
  /// holds most of it, or of the main display when it is on none (a display was removed).
  private func clamped(_ frame: NSRect) -> NSRect {
    let screen =
      NSScreen.screens.max {
        $0.frame.intersection(frame).area < $1.frame.intersection(frame).area
      }.flatMap { $0.frame.intersects(frame) ? $0 : nil } ?? NSScreen.main
    guard
      let area = screen?.visibleFrame.insetBy(
        dx: SelectionToolbarPlacement.margin, dy: SelectionToolbarPlacement.margin)
    else { return frame }
    var result = frame
    result.origin.x = min(max(frame.minX, area.minX), area.maxX - frame.width)
    result.origin.y = min(max(frame.minY, area.minY), area.maxY - frame.height)
    return result
  }

  /// The combination as macOS draws it, in the order the app's shortcuts list modifiers.
  private static func symbols(_ keys: Set<SelectionActivation.Key>) -> [String] {
    let order: [(SelectionActivation.Key, String)] = [
      (.command, "⌘"), (.option, "⌥"), (.shift, "⇧"),
    ]
    return order.filter { keys.contains($0.0) }.map(\.1)
  }
}

extension NSRect {
  fileprivate var area: CGFloat { isNull ? 0 : width * height }
}

/// The HUD window's content: reports the pointer entering it (the capsule or its margin), which
/// wakes paused hover tracking. Entered events reach an inactive app late, which is fine for a
/// wake-up; the tracking itself reads the pointer every frame.
private final class HUDContainer: NSView {
  var onPointerNear: (() -> Void)?

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for area in trackingAreas { removeTrackingArea(area) }
    addTrackingArea(
      NSTrackingArea(
        rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
        owner: self))
  }

  override func mouseEntered(with event: NSEvent) { onPointerNear?() }
}
