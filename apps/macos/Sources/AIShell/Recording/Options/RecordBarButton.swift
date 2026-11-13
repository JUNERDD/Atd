import AppKit

/// A labelled control of the record bar, on the annotation toolbar's labelled-button metrics
/// (``AnnotationToolbarButton/Label``: a 28 pt capsule, 10 pt padding, a 14 pt glyph, 13 pt
/// medium text). Two looks share it:
/// - ``Style/menu``, Sound ⌄ and Options ⌄: glyph, a fixed title and a down chevron, washed on
///   hover and while pressed or while its menu is open (``isActive``). Its glyph can change
///   (Sound's shows what will be heard); its title never does, so its width is fixed.
/// - ``Style/primary``, Start Recording: white glyph and text on the system red, darker while
///   hovered or pressed.
///
/// The capture overlay's app is active, so the button follows the pointer itself, like the
/// annotation toolbar's buttons.
final class RecordBarButton: NSButton {
  enum Style {
    case menu, primary
  }

  /// Between the title and the chevron, and the chevron's box.
  static let chevronGap: CGFloat = 6
  static let chevronBox: CGFloat = 14

  /// The glyph before the title; a template image.
  var glyph: NSImage? {
    didSet { needsDisplay = true }
  }

  var isHovered = false {
    didSet { if isHovered != oldValue { needsDisplay = true } }
  }

  /// The button's menu is open: it keeps its pressed wash.
  var isActive = false {
    didSet { if isActive != oldValue { needsDisplay = true } }
  }

  private let style: Style
  private let text: String
  private var trackingArea: NSTrackingArea?

  init(style: Style, title: String, glyph: NSImage?, action: Selector) {
    self.style = style
    text = title
    self.glyph = glyph
    let width = Self.width(style: style, title: title)
    super.init(frame: NSRect(x: 0, y: 0, width: width, height: AnnotationToolbarButton.side))
    isBordered = false
    self.title = ""
    focusRingType = .exterior
    self.action = action
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: width),
      heightAnchor.constraint(equalToConstant: AnnotationToolbarButton.side),
    ])
    setAccessibilityLabel(title)
    if style == .menu { setAccessibilityRole(.menuButton) }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  /// The width a button of `style` titled `title` takes: the labelled button's, plus the chevron
  /// of a menu button.
  static func width(style: Style, title: String) -> CGFloat {
    let label = AnnotationToolbarButton.Label.width(text: title, hasImage: true)
    return style == .menu ? label + chevronGap + chevronBox : label
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override var isHighlighted: Bool {
    didSet { needsDisplay = true }
  }

  override var isEnabled: Bool {
    didSet {
      needsDisplay = true
      window?.invalidateCursorRects(for: self)
    }
  }

  // MARK: Drawing

  override func draw(_ dirtyRect: NSRect) {
    let radius = bounds.height / 2
    let capsule = NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius)
    switch style {
    case .menu:
      drawMenu(in: capsule)
    case .primary:
      let shade: CGFloat = isHighlighted ? 0.2 : (isHovered ? 0.12 : 0)
      NSColor.systemRed.blended(withFraction: shade, of: .black)?.setFill()
      capsule.fill()
      AnnotationToolbarButton.Label.draw(
        text: text, image: glyph, in: bounds, enabled: isEnabled,
        textColor: .white, imageColor: .white)
    }
  }

  private func drawMenu(in capsule: NSBezierPath) {
    if isEnabled, let wash = isHighlighted || isActive ? 0.16 : (isHovered ? 0.09 : nil) {
      NSColor.labelColor.withAlphaComponent(wash).setFill()
      capsule.fill()
    }
    let label = AnnotationToolbarButton.Label.self
    // The chevron's box sits inside the trailing padding the label keeps for itself.
    let box = NSRect(
      x: bounds.maxX - label.padding - Self.chevronBox, y: bounds.minY,
      width: Self.chevronBox, height: bounds.height)
    var text = bounds
    text.size.width -= Self.chevronGap + Self.chevronBox
    label.draw(text: self.text, image: glyph, in: text, enabled: isEnabled)
    let chevron = AnnotationIcons.glyph("chevron-down", label: "")
    let tint =
      isEnabled ? NSColor.labelColor.withAlphaComponent(0.7) : AnnotationToolbarButton.disabledColor
    let rect = NSRect(
      x: box.minX, y: box.midY - Self.chevronBox / 2,
      width: Self.chevronBox, height: Self.chevronBox)
    label.tinted(chevron, tint, size: rect.size).draw(in: rect)
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

  override func mouseEntered(with event: NSEvent) { isHovered = true }
  override func mouseExited(with event: NSEvent) { isHovered = false }

  override func resetCursorRects() {
    addCursorRect(bounds, cursor: PointerRole(button: self).cursor)
  }

  // MARK: Focus

  override var focusRingMaskBounds: NSRect { bounds }

  override func drawFocusRingMask() {
    let radius = bounds.height / 2
    NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius).fill()
  }
}
