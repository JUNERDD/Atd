import AICore
import AppKit

/// The dim over the frozen display with one undimmed area: the detected area under the pointer
/// or the selection, outlined in the accent colour, with its "W × H" size label and, on a
/// committed selection, its eight handles. Its points are desktop points, like the overlay's; an
/// area spanning displays is drawn by each display's chrome, clipped to it, and labelled on one.
/// Redraws only the region an update touches, so a mouse move does not repaint a whole Retina
/// display.
final class CaptureChromeView: NSView {
  private enum BadgeKind { case size, corner }

  /// An area with its size label and optional companion corner-radius badge, placed once per update.
  private struct Placement {
    let area: CGRect
    let label: String?
    let labelFrame: CGRect
    let cornerLabel: String?
    let cornerBadgeFrame: CGRect?
  }

  private var placement: Placement?
  private var handles = false
  var selectionCornerRadius: CGFloat = 0 {
    didSet {
      if selectionCornerRadius != oldValue { recalculatePlacement() }
    }
  }
  var showsCornerBadge = false {
    didSet {
      if showsCornerBadge != oldValue { recalculatePlacement() }
    }
  }
  private(set) var cornerBadgeFrame: CGRect?
  var onClickBadge: ((NSEvent) -> Void)?
  var onCornerBadgeClick: ((NSEvent) -> Void)?
  var canClickBadge: (() -> Bool)?
  private static let dim = NSColor(white: 0, alpha: 0.4)
  private static let handleRadius: CGFloat = 4
  private static let labelFont = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .medium)

  /// `frame` is the display's area of the desktop, which also becomes this view's bounds.
  override init(frame: CGRect) {
    super.init(frame: frame)
    setBoundsOrigin(frame.origin)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  func isInteractiveBadge(at localPoint: CGPoint) -> Bool {
    badgeKind(at: localPoint) != nil
  }

  private func badgeKind(at localPoint: CGPoint) -> BadgeKind? {
    guard handles, canClickBadge?() ?? true else { return nil }
    if let labelFrame, labelFrame.contains(localPoint) { return .size }
    if let cornerBadgeFrame, cornerBadgeFrame.contains(localPoint) { return .corner }
    if let labelFrame, labelFrame.insetBy(dx: -4, dy: -4).contains(localPoint) { return .size }
    if let cornerBadgeFrame, cornerBadgeFrame.insetBy(dx: -4, dy: -4).contains(localPoint) {
      return .corner
    }
    return nil
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    let local = convert(point, from: superview)
    return isInteractiveBadge(at: local) ? self : nil
  }

  override func mouseDown(with event: NSEvent) {
    let local = convert(event.locationInWindow, from: nil)
    switch badgeKind(at: local) {
    case .corner:
      onCornerBadgeClick?(event)
      return
    case .size:
      onClickBadge?(event)
      return
    case nil:
      super.mouseDown(with: event)
    }
  }

  /// Shows `area` (nil: everything dim) with `label` above it (nil: none).
  func update(area: CGRect?, handles: Bool, label: String?) {
    guard area != placement?.area || handles != self.handles || label != placement?.label
    else { return }
    applyPlacement(area: area, handles: handles, label: label)
  }

  private func recalculatePlacement() {
    guard let area = placement?.area else {
      cornerBadgeFrame = nil
      return
    }
    applyPlacement(area: area, handles: handles, label: placement?.label)
  }

  private func applyPlacement(area: CGRect?, handles: Bool, label: String?) {
    let before = placement.map(extent(of:))
    self.handles = handles
    placement = area.map { place($0, label: label, handles: handles) }
    cornerBadgeFrame = placement?.cornerBadgeFrame
    if let before, let after = placement.map(extent(of:)) {
      setNeedsDisplay(before.union(after))
    } else {
      needsDisplay = true
    }
  }

  private func clampedCornerRadius(for rect: CGRect) -> CGFloat {
    min(max(0, selectionCornerRadius), min(rect.width, rect.height) / 2)
  }

  override func draw(_ dirtyRect: NSRect) {
    let dim = NSBezierPath(rect: bounds)
    dim.windingRule = .evenOdd
    if let area = placement?.area {
      let r = clampedCornerRadius(for: area)
      if r > 0 {
        dim.append(NSBezierPath(roundedRect: area, xRadius: r, yRadius: r))
      } else {
        dim.appendRect(area)
      }
    }
    Self.dim.setFill()
    dim.fill()
    guard let placement else { return }
    let area = placement.area
    let r = clampedCornerRadius(for: area)
    let outline =
      r > 0
      ? NSBezierPath(
        roundedRect: area.insetBy(dx: -0.5, dy: -0.5), xRadius: r + 0.5, yRadius: r + 0.5)
      : NSBezierPath(rect: area.insetBy(dx: -0.75, dy: -0.75))
    outline.lineWidth = 1.5
    NSColor.controlAccentColor.setStroke()
    outline.stroke()
    if handles {
      for handle in SelectionHandle.allCases {
        let center = handle.point(on: area)
        let dot = NSBezierPath(
          ovalIn: CGRect(x: center.x, y: center.y, width: 0, height: 0)
            .insetBy(dx: -Self.handleRadius, dy: -Self.handleRadius))
        NSColor.white.setFill()
        dot.fill()
        dot.lineWidth = 1
        dot.stroke()
      }
    }
    if let label = placement.label {
      CaptureBadge.draw(
        label, font: Self.labelFont, in: placement.labelFrame, interactive: handles)
    }
    if let cornerLabel = placement.cornerLabel, let cornerFrame = placement.cornerBadgeFrame {
      CaptureBadge.drawCorner(
        cornerLabel, font: Self.labelFont, in: cornerFrame, interactive: handles)
    }
  }

  /// What a placement occupies on screen: its area, outline and handles, and its badges.
  private func extent(of placement: Placement) -> CGRect {
    let reach = Self.handleRadius + 2
    var rect = placement.area.insetBy(dx: -reach, dy: -reach)
    if placement.label != nil { rect = rect.union(placement.labelFrame) }
    if let cornerFrame = placement.cornerBadgeFrame { rect = rect.union(cornerFrame) }
    return rect
  }

  /// The size label's frame while one shows (desktop points), which the bars beside the
  /// selection keep clear of.
  var labelFrame: CGRect? {
    placement?.label == nil ? nil : placement?.labelFrame
  }

  /// The size label and optional companion corner badge on this display.
  private func place(_ area: CGRect, label: String?, handles: Bool) -> Placement {
    guard let label else {
      return Placement(
        area: area, label: nil, labelFrame: .zero, cornerLabel: nil, cornerBadgeFrame: nil)
    }
    let size = CaptureBadge.size(of: label, font: Self.labelFont)
    let labelFrame = CaptureSizeLabelLayout.frame(area: area, size: size, display: bounds)
    guard handles, showsCornerBadge else {
      return Placement(
        area: area, label: label, labelFrame: labelFrame, cornerLabel: nil, cornerBadgeFrame: nil)
    }
    let rounded = Int(max(0, selectionCornerRadius).rounded())
    let valueText =
      rounded == 0
      ? ShellStrings.shared.text(CaptureToolsStringKey.cornerSharpBadge)
      : ShellStrings.shared.text(CaptureToolsStringKey.cornerRadiusShort, count: rounded)
    let cornerLabel = "\(valueText) ▾"
    let cornerSize = CaptureBadge.cornerSize(of: cornerLabel, font: Self.labelFont)
    let trailingX = labelFrame.maxX + 6
    let cornerX =
      trailingX + cornerSize.width <= bounds.maxX - 4
      ? trailingX
      : max(bounds.minX + 4, labelFrame.minX - 6 - cornerSize.width)
    let cornerFrame = CGRect(
      x: cornerX, y: labelFrame.minY, width: cornerSize.width, height: labelFrame.height)
    return Placement(
      area: area, label: label, labelFrame: labelFrame, cornerLabel: cornerLabel,
      cornerBadgeFrame: cornerFrame)
  }
}

/// A short white text on a dark rounded plate: the size label and the hints.
final class CaptureBadge: NSView {
  private let text: String
  private let font: NSFont
  private static let padding = CGSize(width: 8, height: 4)
  private static let cornerGlyphSize: CGFloat = 12
  private static let cornerGlyphGap: CGFloat = 4
  private static let cornerGlyph: NSImage = {
    let icon = AnnotationIcons.glyph(AnnotationIcons.cornerRounded, label: "")
    let size = NSSize(width: cornerGlyphSize, height: cornerGlyphSize)
    return NSImage(size: size, flipped: false) { rect in
      icon.draw(in: rect)
      NSColor.white.set()
      rect.fill(using: .sourceAtop)
      return true
    }
  }()

  init(text: String, font: NSFont) {
    self.text = text
    self.font = font
    super.init(frame: CGRect(origin: .zero, size: Self.size(of: text, font: font)))
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override var fittingSize: NSSize { Self.size(of: text, font: font) }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func draw(_ dirtyRect: NSRect) { Self.draw(text, font: font, in: bounds) }

  static func size(of text: String, font: NSFont) -> CGSize {
    let size = NSAttributedString(string: text, attributes: [.font: font]).size()
    return CGSize(
      width: (size.width + padding.width * 2).rounded(.up),
      height: (size.height + padding.height * 2).rounded(.up))
  }

  static func cornerSize(of text: String, font: NSFont) -> CGSize {
    let base = size(of: text, font: font)
    return CGSize(width: base.width + cornerGlyphSize + cornerGlyphGap, height: base.height)
  }

  static func draw(
    _ text: String, font: NSFont, in frame: CGRect, interactive: Bool = false
  ) {
    drawPlate(in: frame, interactive: interactive)
    NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: NSColor.white])
      .draw(at: CGPoint(x: frame.minX + padding.width, y: frame.minY + padding.height))
  }

  static func drawCorner(
    _ text: String, font: NSFont, in frame: CGRect, interactive: Bool = false
  ) {
    drawPlate(in: frame, interactive: interactive)
    let iconY = frame.minY + ((frame.height - cornerGlyphSize) / 2).rounded()
    let iconRect = CGRect(
      x: frame.minX + padding.width, y: iconY, width: cornerGlyphSize, height: cornerGlyphSize)
    cornerGlyph.draw(
      in: iconRect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true,
      hints: nil)
    let textX = iconRect.maxX + cornerGlyphGap
    NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: NSColor.white])
      .draw(at: CGPoint(x: textX, y: frame.minY + padding.height))
  }

  private static func drawPlate(in frame: CGRect, interactive: Bool) {
    NSColor(white: 0, alpha: interactive ? 0.78 : 0.72).setFill()
    NSBezierPath(roundedRect: frame, xRadius: 6, yRadius: 6).fill()
    guard interactive else { return }
    NSColor.white.withAlphaComponent(0.24).setStroke()
    let rim = NSBezierPath(
      roundedRect: frame.insetBy(dx: 0.5, dy: 0.5), xRadius: 5.5, yRadius: 5.5)
    rim.lineWidth = 1
    rim.stroke()
  }
}
