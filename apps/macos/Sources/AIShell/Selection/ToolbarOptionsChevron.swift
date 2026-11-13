import AppKit

/// The options half of a split command button on the toolbar's capsule: a narrow capsule with a
/// down chevron right after the command's own button, washed like it, and held in its pressed
/// wash while its options menu is open (``isActive``). One that ends the capsule
/// (``endsCapsule``) is as wide as the toolbar's square buttons, so its wash is a circle that
/// nests in the capsule's round end like More's; a narrow capsule's tighter corners would not.
final class ToolbarOptionsChevron: NSButton, ToolbarPointerTracking {
  static let width: CGFloat = 20
  /// The width of one that ends the capsule.
  static let endingWidth = AnnotationToolbarButton.side

  var endsCapsule = false {
    didSet {
      guard endsCapsule != oldValue else { return }
      widthConstraint.constant = endsCapsule ? Self.endingWidth : Self.width
      needsDisplay = true
    }
  }

  var isHovered = false {
    didSet { if isHovered != oldValue { needsDisplay = true } }
  }

  var isActive = false {
    didSet { if isActive != oldValue { needsDisplay = true } }
  }

  override var isEnabled: Bool {
    didSet { window?.invalidateCursorRects(for: self) }
  }

  /// Capture uses native tracking; the inactive selection toolbar takes over after presenting.
  var followsPointer = true {
    didSet {
      guard followsPointer != oldValue else { return }
      isHovered = false
      updateTrackingAreas()
      window?.invalidateCursorRects(for: self)
    }
  }

  private var widthConstraint: NSLayoutConstraint!
  private var trackingArea: NSTrackingArea?

  init(action: Selector) {
    let side = AnnotationToolbarButton.side
    super.init(frame: NSRect(x: 0, y: 0, width: Self.width, height: side))
    isBordered = false
    title = ""
    self.action = action
    translatesAutoresizingMaskIntoConstraints = false
    widthConstraint = widthAnchor.constraint(equalToConstant: Self.width)
    NSLayoutConstraint.activate([widthConstraint, heightAnchor.constraint(equalToConstant: side)])
    setAccessibilityRole(.menuButton)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override var isHighlighted: Bool {
    didSet { needsDisplay = true }
  }

  override func draw(_ dirtyRect: NSRect) {
    if isEnabled, let wash = isHighlighted || isActive ? 0.16 : (isHovered ? 0.09 : nil) {
      let radius = min(bounds.width, bounds.height) / 2
      NSColor.labelColor.withAlphaComponent(wash).setFill()
      NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius).fill()
    }
    guard let chevron = ToolbarOptionsGlyphs.options else { return }
    let color = isEnabled ? NSColor.labelColor : AnnotationToolbarButton.disabledColor
    ToolbarOptionsGlyphs.draw(chevron, color: color, centeredIn: bounds)
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let trackingArea { removeTrackingArea(trackingArea) }
    trackingArea = nil
    guard followsPointer else { return }
    let area = NSTrackingArea(
      rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
    addTrackingArea(area)
    trackingArea = area
  }

  override func mouseEntered(with event: NSEvent) {
    guard followsPointer else { return }
    isHovered = true
  }

  override func mouseExited(with event: NSEvent) {
    guard followsPointer else { return }
    isHovered = false
  }

  override func resetCursorRects() {
    guard followsPointer else { return }
    addCursorRect(bounds, cursor: PointerRole(button: self).cursor)
  }
}
