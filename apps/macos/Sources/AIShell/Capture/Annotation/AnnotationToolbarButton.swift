import AppKit

/// One control of the annotation toolbar. Every tool, colour, stroke width and action is this
/// button, so they share one geometry and one set of states: a circle of ``side`` points (the
/// glass capsule around them is ``side`` / 2 + its padding in radius, so the shapes nest
/// concentrically), a wash on hover and a deeper one while pressed, the selected state, a
/// dimmed disabled glyph, and the keyboard focus ring drawn inside the toolbar's padding.
///
/// A choice among several (tools, colours, strokes) reads as a selected radio button to
/// VoiceOver, an on/off control (the text background) as a checkbox; the bars set
/// ``isSelected`` from the editor's state after every change.
final class AnnotationToolbarButton: NSButton {
  /// How the selected state shows: an accent fill under a white glyph (tools, stroke widths),
  /// or an accent ring around the glyph (colour swatches, which a fill would hide). `toggle` is
  /// an on/off control that shows "on" like `fill`.
  enum Selection {
    case fill, ring, toggle
  }

  static let side: CGFloat = 28

  private let selection: Selection?
  private var hovering = false
  private var trackingArea: NSTrackingArea?

  var isSelected = false {
    didSet {
      guard isSelected != oldValue else { return }
      updateTint()
      needsDisplay = true
    }
  }

  /// `selection` is nil for a plain action (undo, confirm…); `tint` colours an action's glyph.
  /// The owner sets `target` once it exists.
  init(selection: Selection?, tint: NSColor? = nil, action: Selector) {
    self.selection = selection
    super.init(frame: CGRect(x: 0, y: 0, width: Self.side, height: Self.side))
    isBordered = false
    imagePosition = .imageOnly
    imageScaling = .scaleNone
    title = ""
    focusRingType = .exterior
    contentTintColor = tint
    self.action = action
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: Self.side),
      heightAnchor.constraint(equalToConstant: Self.side),
    ])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isEnabled: Bool {
    didSet { needsDisplay = true }
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  // MARK: Drawing

  override func draw(_ dirtyRect: NSRect) {
    let circle = NSBezierPath(ovalIn: bounds)
    if selection == .fill || selection == .toggle, isSelected {
      NSColor.controlAccentColor.withAlphaComponent(isHighlighted ? 0.8 : 1).setFill()
      circle.fill()
    } else if let wash {
      NSColor.labelColor.withAlphaComponent(wash).setFill()
      circle.fill()
    }
    if selection == .ring, isSelected {
      let ring = NSBezierPath(ovalIn: bounds.insetBy(dx: 2, dy: 2))
      ring.lineWidth = 2
      NSColor.controlAccentColor.setStroke()
      ring.stroke()
    }
    super.draw(dirtyRect)
  }

  /// The neutral wash: none at rest, light on hover, deeper while pressed; never when disabled.
  private var wash: CGFloat? {
    guard isEnabled else { return nil }
    if isHighlighted { return 0.16 }
    return hovering ? 0.09 : nil
  }

  override var isHighlighted: Bool {
    didSet { needsDisplay = true }
  }

  private func updateTint() {
    guard selection == .fill || selection == .toggle else { return }
    contentTintColor = isSelected ? .white : nil
  }

  // MARK: Hover

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    // `.activeAlways`: the overlay panel is non-activating, so hover must not wait for key.
    let area = NSTrackingArea(
      rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseEntered(with event: NSEvent) {
    hovering = true
    needsDisplay = true
  }

  override func mouseExited(with event: NSEvent) {
    hovering = false
    needsDisplay = true
  }

  override func resetCursorRects() {
    addCursorRect(bounds, cursor: .arrow)
  }

  // MARK: Focus and accessibility

  override var focusRingMaskBounds: NSRect { bounds }

  override func drawFocusRingMask() {
    NSBezierPath(ovalIn: bounds).fill()
  }

  override func accessibilityRole() -> NSAccessibility.Role? {
    switch selection {
    case nil: super.accessibilityRole()
    case .toggle: .checkBox
    case .fill, .ring: .radioButton
    }
  }

  override func accessibilityValue() -> Any? {
    selection == nil ? super.accessibilityValue() : NSNumber(value: isSelected)
  }
}
