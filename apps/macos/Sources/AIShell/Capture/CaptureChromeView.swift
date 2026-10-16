import AICore
import AppKit

/// The dim over the frozen display with one undimmed area: the detected area under the pointer
/// or the selection, outlined in the accent colour, with its "W × H" size label and, on a
/// committed selection, its eight handles. Its points are desktop points, like the overlay's; an
/// area spanning displays is drawn by each display's chrome, clipped to it, and labelled on one.
/// Redraws only the region an update touches, so a mouse move does not repaint a whole Retina
/// display.
final class CaptureChromeView: NSView {
  /// An area with its size label, placed once per update.
  private struct Placement {
    let area: CGRect
    let label: String?
    let labelFrame: CGRect
  }

  private var placement: Placement?
  private var handles = false
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
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  /// Shows `area` (nil: everything dim) with `label` above it (nil: none).
  func update(area: CGRect?, handles: Bool, label: String?) {
    guard area != placement?.area || handles != self.handles || label != placement?.label
    else { return }
    let before = placement.map(extent(of:))
    placement = area.map { place($0, label: label) }
    self.handles = handles
    if let before, let after = placement.map(extent(of:)) {
      setNeedsDisplay(before.union(after))
    } else {
      needsDisplay = true
    }
  }

  override func draw(_ dirtyRect: NSRect) {
    let dim = NSBezierPath(rect: bounds)
    dim.windingRule = .evenOdd
    if let area = placement?.area { dim.appendRect(area) }
    Self.dim.setFill()
    dim.fill()
    guard let placement else { return }
    let area = placement.area
    let outline = NSBezierPath(rect: area.insetBy(dx: -0.75, dy: -0.75))
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
      CaptureBadge.draw(label, font: Self.labelFont, in: placement.labelFrame)
    }
  }

  /// What a placement occupies on screen: its area, outline and handles, and its size label.
  private func extent(of placement: Placement) -> CGRect {
    let reach = Self.handleRadius + 2
    let area = placement.area.insetBy(dx: -reach, dy: -reach)
    return placement.label == nil ? area : area.union(placement.labelFrame)
  }

  /// The size label above the area's top-left corner (the part of it on this display), or just
  /// inside it when the display's top edge is in the way; always within the display.
  private func place(_ area: CGRect, label: String?) -> Placement {
    guard let label else { return Placement(area: area, label: nil, labelFrame: .zero) }
    let visible = area.intersection(bounds).isNull ? area : area.intersection(bounds)
    let size = CaptureBadge.size(of: label, font: Self.labelFont)
    let above = visible.minY - size.height - 6
    let y = above >= bounds.minY + 4 ? above : visible.minY + 6
    let x = min(max(visible.minX, bounds.minX + 4), bounds.maxX - size.width - 4)
    return Placement(
      area: area, label: label,
      labelFrame: CGRect(origin: CGPoint(x: x, y: y), size: size).integral)
  }
}

/// A short white text on a dark rounded plate: the size label and the hints.
final class CaptureBadge: NSView {
  private let text: String
  private let font: NSFont
  private static let padding = CGSize(width: 8, height: 4)

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

  static func draw(_ text: String, font: NSFont, in frame: CGRect) {
    NSColor(white: 0, alpha: 0.72).setFill()
    NSBezierPath(roundedRect: frame, xRadius: 6, yRadius: 6).fill()
    NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: NSColor.white])
      .draw(at: CGPoint(x: frame.minX + padding.width, y: frame.minY + padding.height))
  }
}
