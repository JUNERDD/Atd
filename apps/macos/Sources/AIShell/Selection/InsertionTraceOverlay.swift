import AICore
import AppKit
import QuartzCore

/// The window and layers of a paced paste's typing trace (``InsertionTracer``): a glow that
/// follows the insertion point and a wash behind each chunk that fades as the next ones land.
/// All of it is the release film's coral caret (``Coral``): the glow is that caret with its
/// bloom, the wash its selection colour, so the trace on screen is the one the film shows; the
/// window draws nothing else. Under reduced motion only the washes show, which fade in place: the
/// glow, which moves, is left out rather than the trace as a whole.
///
/// The window is a borderless, non-activating panel that ignores the mouse, above the target
/// field like the selection toolbar, so the target app keeps the keyboard and the frontmost
/// check of the write never sees Atd. It covers the field's frame (``InsertionTrace/coverage``)
/// on the display of the first mark. Layers go in ``stage``, a flipped container, so they are
/// placed in Quartz points less the window's Quartz origin; the view's own layer cannot be the
/// flipped one, as AppKit resets a hosted layer's `isGeometryFlipped` when the window shows. Glyphs stay the target's: everything here is
/// plain alpha over them, as one window can only be composited over another.
final class InsertionTraceOverlay {
  /// The caret bar's width, the film's thinnest (`max(3px, …)` in its caret.css).
  private static let coreWidth: CGFloat = 3
  /// Room around the field for the glow's halo.
  private static let margin: CGFloat = 24
  private static let move = (duration: 0.15, bounce: 0.0)
  private static let washFade: CFTimeInterval = 0.62
  private static let tailFade: CFTimeInterval = 0.22
  private static let glowFade: CFTimeInterval = 0.35

  /// The open window; nil before the first mark and once ``finish()`` let it go.
  private(set) var window: NSPanel?
  private let canvas = CALayer()
  private let stage = CALayer()
  private let glow = CALayer()
  private let halo = CAGradientLayer()
  private let core = CAGradientLayer()
  private let tail = CAGradientLayer()
  /// The window's top-left in Quartz points.
  private var origin = CGPoint.zero
  /// The line the glow is on (its top, in window points); nil while it is hidden.
  private var glowLine: CGFloat?
  /// Washes still fading, with when they are gone.
  private var washes: [(layer: CALayer, gone: CFTimeInterval)] = []
  /// Whether the system reduces motion, which leaves the glow out.
  private let reducesMotion: Bool

  init(reducesMotion: Bool = false) {
    self.reducesMotion = reducesMotion
  }

  /// Moves the glow to `anchor`, the last character in, and lays a fading wash over `wash`; all
  /// in Quartz points. The window opens with the first mark.
  func show(anchor: CGRect?, wash: [CGRect], field: CGRect?) {
    let anchor = reducesMotion ? nil : anchor
    guard let first = anchor ?? wash.first else { return }
    // Layers move only as the animations below say, the window's first ones included.
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    guard open(over: first, field: field) else { return }
    let now = CACurrentMediaTime()
    washes.removeAll { entry in
      guard entry.gone <= now else { return false }
      entry.layer.removeFromSuperlayer()
      return true
    }
    for rect in wash { addWash(rect.offsetBy(dx: -origin.x, dy: -origin.y), at: now) }
    if let anchor { moveGlow(to: anchor.offsetBy(dx: -origin.x, dy: -origin.y)) }
  }

  /// Fades the glow out and closes the window once the last wash is gone.
  func finish() {
    guard let window else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    fade(glow)
    CATransaction.commit()
    let remaining = max(Self.glowFade, (washes.map(\.gone).max() ?? 0) - CACurrentMediaTime())
    self.window = nil
    Task {
      try? await Task.sleep(for: .seconds(remaining + 0.05))
      window.orderOut(nil)
    }
  }

  /// Opens the window over the field on `first`'s display, unless it is open; false when no
  /// display holds `first`.
  private func open(over first: CGRect, field: CGRect?) -> Bool {
    if window != nil { return true }
    let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
    let center = CGPoint(x: first.midX, y: first.midY)
    guard
      let screen = NSScreen.screens.first(where: {
        CaptureCoordinates.flip($0.frame, primaryHeight: primaryHeight).contains(center)
      }),
      let covered = InsertionTrace.coverage(
        field: field, first: first,
        display: CaptureCoordinates.flip(screen.frame, primaryHeight: primaryHeight),
        margin: Self.margin)
    else { return false }
    origin = covered.origin
    let window = Self.makeWindow()
    window.setFrame(CaptureCoordinates.flip(covered, primaryHeight: primaryHeight), display: false)
    let view = NSView(frame: NSRect(origin: .zero, size: covered.size))
    view.layer = canvas
    view.wantsLayer = true
    canvas.frame = view.bounds
    stage.frame = canvas.bounds
    stage.isGeometryFlipped = true
    canvas.addSublayer(stage)
    window.contentView = view
    buildGlow(scale: screen.backingScaleFactor)
    window.orderFrontRegardless()
    self.window = window
    return true
  }

  private static func makeWindow() -> NSPanel {
    let window = NSPanel(
      contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered,
      defer: true)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = false
    window.ignoresMouseEvents = true
    window.level = .popUpMenu
    window.hidesOnDeactivate = false
    window.isReleasedWhenClosed = false
    window.collectionBehavior = [
      .canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle,
    ]
    return window
  }

  /// The glow, as the film draws its caret: a rounded coral bar shading to the deep coral, a tight
  /// glow and a wide bloom around it, and a tail of the wash behind it that shows only while it
  /// moves.
  private func buildGlow(scale: CGFloat) {
    glow.anchorPoint = CGPoint(x: 0.5, y: 0)
    glow.opacity = 0
    halo.type = .radial
    halo.colors = [Coral.glow, Coral.wash, Coral.clear]
    halo.locations = [0, 0.45, 1]
    halo.startPoint = CGPoint(x: 0.5, y: 0.5)
    halo.endPoint = CGPoint(x: 1, y: 1)
    tail.startPoint = CGPoint(x: 0, y: 0.5)
    tail.endPoint = CGPoint(x: 1, y: 0.5)
    tail.colors = [Coral.clear, Coral.wash]
    tail.cornerRadius = 3
    tail.opacity = 0
    core.colors = [Coral.caret, Coral.deep]
    core.cornerRadius = Self.coreWidth / 2
    core.shadowColor = Coral.glow
    core.shadowOpacity = 1
    core.shadowRadius = 4
    core.shadowOffset = .zero
    for layer in [halo, tail, core] as [CALayer] {
      layer.contentsScale = scale
      glow.addSublayer(layer)
    }
    stage.addSublayer(glow)
  }

  private func fade(_ layer: CALayer) {
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = layer.presentation()?.opacity ?? layer.opacity
    fade.toValue = 0
    fade.duration = Self.glowFade
    layer.opacity = 0
    layer.add(fade, forKey: "fade")
  }

  private func addWash(_ rect: CGRect, at now: CFTimeInterval) {
    let layer = CALayer()
    layer.frame = rect
    layer.cornerRadius = 3
    let strong = NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast
    layer.backgroundColor = strong ? Coral.washStrong : Coral.wash
    layer.opacity = 0
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 1
    fade.toValue = 0
    fade.duration = Self.washFade
    fade.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.6, 0.3, 1)
    layer.add(fade, forKey: "fade")
    stage.insertSublayer(layer, below: glow)
    washes.append((layer, now + Self.washFade))
  }

  /// Moves the glow to the end of `rect` (window points) on a spring with no bounce; a move to
  /// another line jumps there instead of crossing the text.
  private func moveGlow(to rect: CGRect) {
    let height = rect.height
    let target = CGPoint(x: rect.maxX, y: rect.minY)
    let sameLine = glowLine.map { abs($0 - rect.minY) <= height / 2 } ?? false
    let from = glow.presentation()?.position ?? glow.position
    let mid = Self.coreWidth / 2
    glow.bounds = CGRect(x: 0, y: 0, width: Self.coreWidth, height: height)
    core.frame = glow.bounds
    halo.frame = CGRect(x: mid - 28, y: -0.45 * height, width: 56, height: 1.9 * height)
    tail.frame = CGRect(x: mid - 60, y: 0.14 * height, width: 60, height: 0.72 * height)
    glow.position = target
    if sameLine {
      let spring = CASpringAnimation(
        perceptualDuration: Self.move.duration, bounce: Self.move.bounce)
      spring.keyPath = "position"
      spring.fromValue = NSValue(point: from)
      spring.toValue = NSValue(point: target)
      glow.add(spring, forKey: "move")
      let streak = CABasicAnimation(keyPath: "opacity")
      streak.fromValue = 1
      streak.toValue = 0
      streak.duration = Self.tailFade
      tail.add(streak, forKey: "streak")
    } else {
      glow.removeAnimation(forKey: "move")
      tail.removeAnimation(forKey: "streak")
    }
    if glowLine == nil {
      glow.opacity = 1
      let appear = CABasicAnimation(keyPath: "opacity")
      appear.fromValue = 0
      appear.toValue = 1
      appear.duration = 0.12
      glow.add(appear, forKey: "fade")
    }
    glowLine = rect.minY
  }
}

/// The release film's caret colours, from its world tokens
/// (`apps/promo-video/src/release/world/release.css`, `--r08-coral…`): the caret, its deep end,
/// its glow and its wash, which the film also selects text with. Fixed colours, as in the film:
/// the trace is Atd's mark over another app, not a colour of that app's.
private enum Coral {
  static let caret = color(255, 106, 61)
  static let deep = color(226, 71, 28)
  static let glow = color(255, 106, 61, 0.55)
  static let wash = color(255, 106, 61, 0.3)
  /// The wash under Increase Contrast.
  static let washStrong = color(255, 106, 61, 0.4)
  static let clear = color(255, 106, 61, 0)

  private static func color(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat = 1)
    -> CGColor
  {
    CGColor(srgbRed: red / 255, green: green / 255, blue: blue / 255, alpha: alpha)
  }
}
