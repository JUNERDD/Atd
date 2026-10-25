import AICore
import AppKit
import QuartzCore

/// One key's mark: the target ring, the input or scroll bar, the click ripple, the arrow and
/// its label (the Atd sign, the phase and, for concurrent tasks, the task's
/// badge). ``root`` sits at the arrow's tip in its overlay's canvas and holds the rest relative
/// to it, so a glide moves the whole mark at once. Nothing here is interactive.
final class PointerMark {
  /// What the mark shows, apart from where.
  struct Appearance: Equatable {
    var phase: PointerPhase
    var action: PointerAction
    var label: String
    /// The task's badge; nil while only one task has marks on screen.
    var badge: String?
    var reduceMotion: Bool
    var increaseContrast: Bool
  }

  let root = CALayer()
  private let ringEdge = CAShapeLayer()
  private let ring = CAShapeLayer()
  private let fieldBar = CAShapeLayer()
  private let scrollBar = CAShapeLayer()
  private let ripple = CAShapeLayer()
  private let arrow = CAShapeLayer()
  private let pill = CALayer()
  private let sign = CALayer()
  private let signMask = CALayer()
  private let text = CATextLayer()
  private let badge = CALayer()
  private let badgeText = CATextLayer()

  /// The display the mark is on; nil before its first placement.
  private(set) var displayID: CGDirectDisplayID?
  /// The target as last drawn, in its display's view space.
  private(set) var target: CGRect?
  private var appearance: Appearance?
  /// The arrow's tip in view space, and the size of its display.
  private var anchor = CGPoint.zero
  private var displaySize = CGSize.zero
  private var fadeTask: Task<Void, Never>?

  init() {
    for layer in [ringEdge, ring, fieldBar, scrollBar, ripple, arrow, pill] as [CALayer] {
      root.addSublayer(layer)
    }
    pill.addSublayer(sign)
    sign.mask = signMask
    pill.addSublayer(text)
    pill.addSublayer(badge)
    badge.addSublayer(badgeText)
    ringEdge.fillColor = nil
    ripple.fillColor = nil
    ripple.lineWidth = 2
    let side = PointerStyle.rippleRadius * 2
    ripple.path = CGPath(
      ellipseIn: CGRect(x: -side / 2, y: -side / 2, width: side, height: side), transform: nil)
    ripple.opacity = 0
    arrow.path = PointerStyle.arrowPath
    arrow.shadowOffset = CGSize(width: 0, height: -1)
    signMask.contentsGravity = .resizeAspect
    for label in [text, badgeText] { label.isWrapped = false }
  }

  /// Draws the mark for `target` (view space, cut to the canvas) on `overlay`. `glide` moves it
  /// there from where it is as a short hint; otherwise a mark that appears or changes target fades
  /// in there. `dispatched` plays the ripple of a sent click.
  func place(
    target: CGRect, on overlay: any PointerCanvas, appearance: Appearance, glide: Bool,
    dispatched: Bool
  ) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    fadeTask?.cancel()
    root.removeAnimation(forKey: "fade")
    root.opacity = 1
    let appearing = root.superlayer !== overlay.canvas
    if appearing {
      root.removeFromSuperlayer()
      overlay.canvas.addSublayer(root)
      setScale(overlay.scale)
    }
    let move = layOut(target: target, on: overlay, action: appearance.action)
    if glide {
      glideFrom(move.from, to: move.position, ring: move.ring, bar: move.bar)
    } else {
      for layer in [root, ring, ringEdge, fieldBar] { layer.removeAnimation(forKey: "glide") }
      if appearing || self.target != target { fadeIn() }
    }
    self.target = target
    apply(appearance)
    if dispatched { playRipple(reduceMotion: appearance.reduceMotion) }
  }

  /// Moves the mark already on `overlay` to `target` and draws it again, with none of ``place``'s
  /// fade-in, glide or ripple, and without touching a fade-out under way: for a canvas that was
  /// resized under the same operation, where every step has to land at once.
  func reposition(target: CGRect, on overlay: any PointerCanvas) {
    guard let appearance, root.superlayer === overlay.canvas else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    _ = layOut(target: target, on: overlay, action: appearance.action)
    self.target = target
    apply(appearance)
  }

  /// Where the mark was and went, for a glide between two targets.
  private struct Move {
    let from: CGPoint
    let position: CGPoint
    let ring: CGPath?
    let bar: CGPath?
  }

  /// Sets the geometry for `target` on `overlay`: the arrow's position and the ring, field bar and
  /// scroll bar around the target. Their paths are relative to the arrow's tip.
  private func layOut(target: CGRect, on overlay: any PointerCanvas, action: PointerAction)
    -> Move
  {
    displayID = overlay.displayID
    displaySize = overlay.bounds.size
    anchor = PointerGeometry.anchor(for: target)
    let position = overlay.layer(anchor)
    let outset = -PointerStyle.ringOutset
    let ringRect = overlay.layer(target.insetBy(dx: outset, dy: outset))
      .offsetBy(dx: -position.x, dy: -position.y)
    let radius = PointerStyle.ringRadius
    let ringPath = CGPath(
      roundedRect: ringRect, cornerWidth: radius, cornerHeight: radius, transform: nil)
    let bar = CGRect(
      x: target.minX + 4, y: target.maxY - 5, width: max(target.width - 8, 2), height: 3)
    let barPath = CGPath(
      roundedRect: overlay.layer(bar).offsetBy(dx: -position.x, dy: -position.y),
      cornerWidth: 1.5, cornerHeight: 1.5, transform: nil)
    let move = Move(
      from: root.presentation()?.position ?? root.position, position: position,
      ring: ring.path, bar: fieldBar.path)
    root.position = position
    ring.path = ringPath
    ringEdge.path = ringPath
    fieldBar.path = barPath
    scrollBar.path = PointerStyle.scrollBar(for: action, in: target).map {
      CGPath(
        roundedRect: overlay.layer($0).offsetBy(dx: -position.x, dy: -position.y),
        cornerWidth: 1.5, cornerHeight: 1.5, transform: nil)
    }
    return move
  }

  /// Restyles the mark in place: phase, label, badge and the accessibility settings.
  func apply(_ appearance: Appearance) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    self.appearance = appearance
    let strong = appearance.increaseContrast
    let dash = PointerStyle.isDashed(appearance.phase) ? PointerStyle.ringDash : nil
    // The ring and bar use the deep coral over an edge (light by default, dark with Increase
    // Contrast), so they keep 3:1 over any page; the arrow keeps the brighter coral inside its
    // white outline.
    ring.fillColor = strong ? PointerPalette.fillStrong : PointerPalette.fill
    ring.strokeColor = PointerPalette.deep
    ring.lineWidth = strong ? 3 : 2
    ring.lineDashPattern = dash
    ringEdge.strokeColor = strong ? PointerPalette.ink : PointerPalette.halo
    ringEdge.lineWidth = strong ? 5 : 4
    ringEdge.lineDashPattern = dash
    fieldBar.isHidden =
      appearance.phase != .typingField || (target?.width ?? 0) < 12
      || (target?.height ?? 0) < 12
    fieldBar.fillColor = PointerPalette.deep
    fieldBar.strokeColor = strong ? PointerPalette.ink : PointerPalette.halo
    fieldBar.lineWidth = 1
    scrollBar.isHidden = appearance.phase != .dispatching || scrollBar.path == nil
    scrollBar.fillColor = PointerPalette.deep
    scrollBar.strokeColor = strong ? PointerPalette.ink : PointerPalette.halo
    scrollBar.lineWidth = 1
    arrow.fillColor = strong ? PointerPalette.deep : PointerPalette.coral
    arrow.strokeColor = PointerPalette.white
    arrow.lineWidth = strong ? 2 : 1.5
    arrow.lineJoin = .round
    arrow.shadowColor = strong ? PointerPalette.ink : PointerPalette.shadow
    arrow.shadowOpacity = 1
    arrow.shadowRadius = strong ? 1 : 2
    ripple.strokeColor = PointerPalette.deep
    if appearance.action != .click || appearance.phase != .dispatching {
      ripple.removeAllAnimations()
    }
    layOutLabel(appearance)
  }

  /// Removes the mark now.
  func remove() {
    fadeTask?.cancel()
    root.removeAllAnimations()
    root.removeFromSuperlayer()
  }

  /// Fades the mark out, then removes it and calls `done`. A fade, so it stays under Reduce
  /// Motion: the completion is feedback, and only movement is what that setting removes.
  func fadeOut(done: @escaping () -> Void) {
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = root.presentation()?.opacity ?? root.opacity
    fade.toValue = 0
    fade.duration = PointerStyle.fadeDuration
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    root.opacity = 0
    root.add(fade, forKey: "fade")
    CATransaction.commit()
    fadeTask?.cancel()
    fadeTask = Task {
      try? await Task.sleep(for: .seconds(PointerStyle.fadeDuration + 0.05))
      guard !Task.isCancelled else { return }
      done()
    }
  }

  /// The pill: padding, the Atd sign, the phase, the badge, padding; beside the arrow's tail and
  /// kept on the display.
  private func layOutLabel(_ appearance: Appearance) {
    let strong = appearance.increaseContrast
    let height = PointerStyle.labelHeight
    let padding = PointerStyle.labelPadding
    let gap = PointerStyle.labelGap
    var x = padding
    sign.isHidden = PointerStyle.mark == nil
    if !sign.isHidden {
      let side = PointerStyle.markSide
      sign.frame = CGRect(x: x, y: (height - side) / 2, width: side, height: side)
      signMask.frame = sign.bounds
      sign.backgroundColor = PointerPalette.white
      x += side + gap
    }
    let string = PointerStyle.text(
      appearance.label, font: PointerStyle.labelFont, color: PointerPalette.white)
    let size = Self.measure(string)
    text.string = string
    text.frame = CGRect(x: x, y: (height - size.height) / 2, width: size.width, height: size.height)
    x += size.width
    if let label = appearance.badge, !label.isEmpty {
      let string = PointerStyle.text(
        label, font: PointerStyle.badgeFont,
        color: strong ? PointerPalette.ink : PointerPalette.deep)
      let size = Self.measure(string)
      x += gap
      badge.frame = CGRect(x: x, y: 3, width: size.width + 8, height: height - 6)
      badge.cornerRadius = 4
      badge.backgroundColor = strong ? PointerPalette.white : PointerPalette.badgeFill
      badgeText.string = string
      badgeText.frame = CGRect(
        x: 4, y: (badge.bounds.height - size.height) / 2, width: size.width, height: size.height)
      badge.isHidden = false
      x += badge.frame.width
    } else {
      badge.isHidden = true
    }
    let pillSize = CGSize(width: x + padding, height: height)
    pill.cornerRadius = height / 2
    pill.backgroundColor = strong ? PointerPalette.ink : PointerPalette.labelFill
    pill.borderColor = PointerPalette.coral
    pill.borderWidth = strong ? 1.5 : 0
    let origin = PointerGeometry.labelOrigin(
      anchor: anchor, arrow: PointerStyle.arrowSize, label: pillSize,
      display: CGRect(origin: .zero, size: displaySize))
    // View space (y down) to the canvas (y up), then relative to the tip.
    pill.frame = CGRect(
      x: origin.x - root.position.x,
      y: displaySize.height - origin.y - pillSize.height - root.position.y,
      width: pillSize.width, height: pillSize.height)
  }

  /// The whole mark moves on one spring: the arrow and label, and the ring and bar reshaping to
  /// the new target.
  private func glideFrom(_ from: CGPoint, to position: CGPoint, ring old: CGPath?, bar: CGPath?) {
    root.add(
      PointerStyle.glide("position", from: NSValue(point: from), to: NSValue(point: position)),
      forKey: "glide")
    for (layer, old) in [(ring, old), (ringEdge, old), (fieldBar, bar)] {
      guard let old, let new = layer.path else { continue }
      layer.add(PointerStyle.glide("path", from: old, to: new), forKey: "glide")
    }
  }

  /// A mark appearing, or moving without a glide (a long jump, another display, Reduce Motion),
  /// fades in where it lands, so the eye catches the new place.
  private func fadeIn() {
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 0
    fade.toValue = 1
    fade.duration = PointerStyle.fadeInDuration
    fade.timingFunction = CAMediaTimingFunction(name: .easeOut)
    root.add(fade, forKey: "fadeIn")
  }

  /// A sent click: a ring that grows from the tip and fades, or under Reduce Motion the same
  /// ring fading at its full size.
  private func playRipple(reduceMotion: Bool) {
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 0.9
    fade.toValue = 0
    let group = CAAnimationGroup()
    if reduceMotion {
      group.animations = [fade]
    } else {
      let grow = CABasicAnimation(keyPath: "transform.scale")
      grow.fromValue = 0.35
      grow.toValue = 1.6
      group.animations = [grow, fade]
    }
    group.duration = PointerStyle.rippleDuration
    group.timingFunction = CAMediaTimingFunction(name: .easeOut)
    ripple.add(group, forKey: "ripple")
  }

  private func setScale(_ scale: CGFloat) {
    let layers: [CALayer] = [
      root, ringEdge, ring, fieldBar, scrollBar, ripple, arrow, pill, sign, signMask, text, badge,
      badgeText,
    ]
    for layer in layers { layer.contentsScale = scale }
    signMask.contents = PointerStyle.mark?.layerContents(forContentsScale: scale)
  }

  private static func measure(_ string: NSAttributedString) -> CGSize {
    let size = string.size()
    return CGSize(width: ceil(size.width), height: ceil(size.height))
  }
}
