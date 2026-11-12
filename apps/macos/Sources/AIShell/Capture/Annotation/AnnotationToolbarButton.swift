import AppKit

/// One control of the annotation toolbar. Every tool, colour, stroke width and action is this
/// button, so they share one geometry and one set of states: a circle of ``side`` points (the
/// glass capsule around them is ``side`` / 2 + its padding in radius, so the shapes nest
/// concentrically), a wash on hover and a deeper one while pressed, the selected state, a
/// dimmed disabled glyph, and the keyboard focus ring drawn inside the toolbar's padding.
///
/// The selection toolbar uses the same control with a label
/// (``init(label:image:width:selection:action:)``): a capsule ``side`` points tall around a
/// leading glyph and its text, with the same washes; its More menu stretches such buttons to one
/// width as its rows. A labelled button can say something else in place (``setLabel(_:image:)``)
/// at the width it was given, so the row around it never shifts.
///
/// A choice among several (tools, colours, strokes) reads as a selected radio button to
/// VoiceOver, an on/off control (the text background) as a checkbox; the bars set
/// ``isSelected`` from the editor's state after every change.
final class AnnotationToolbarButton: NSButton {
  /// How the selected state shows: an accent fill under a white glyph (tools, stroke widths),
  /// or an accent ring around the glyph (colour swatches, which a fill would hide). `toggle` is
  /// an on/off control that shows "on" like `fill`; `wash` one of a choice whose selected one
  /// keeps the pressed wash (the capture bar's mode pair, which leaves the accent to the toolbar).
  enum Selection {
    case fill, ring, toggle, wash
  }

  /// Capture-only faces; other toolbar consumers keep the standard appearance. Feedback is
  /// independent of `isEnabled`, so a successful, disabled action stays legible without repeating.
  /// `primary` is a capsule's primary action (the ask bar's Send, the toolbar's confirm) in the
  /// command cards' colours (the island's send buttons): filled with the label colour, its glyph
  /// in the opposite one.
  enum Presentation {
    case standard, captureMode, primary, success, muted
  }

  var presentation: Presentation = .standard {
    didSet { needsDisplay = true }
  }

  static let side: CGFloat = 28

  /// A disabled glyph or label: the system's disabled form of the label colour, as AppKit
  /// dims a disabled button in a key window (about 42% in dark, 30% in light), clearly off yet
  /// still legible.
  static let disabledColor = NSColor.labelColor.withSystemEffect(.disabled)

  private let selection: Selection?
  /// The text and leading glyph of a labelled button, which draws them itself.
  private var label: (text: String, image: NSImage?)?
  private var widthConstraint: NSLayoutConstraint?
  private var trackingArea: NSTrackingArea?

  /// Whether the button follows the pointer itself, through a tracking area and cursor rects.
  /// The selection toolbar turns it off: its app stays inactive, where tracking events arrive
  /// late or not at all, so the toolbar reads the pointer on every frame instead. Ownership may
  /// change after presentation; remove already-installed tracking and cursor rects as well.
  var followsPointer = true {
    didSet {
      guard followsPointer != oldValue else { return }
      isHovered = false
      updateTrackingAreas()
      window?.invalidateCursorRects(for: self)
    }
  }

  /// Set for a button that can also be moved (the selection toolbar's small icon): a press that
  /// travels ``dragThreshold`` or more reports a drag here, as a press on the bar's surface does
  /// (``AnnotationGlassBar/Drag``), and clicks nothing; one released sooner clicks.
  var onDrag: ((AnnotationGlassBar.Drag) -> Void)?
  /// How far a press travels, in points, before it drags rather than clicks.
  static let dragThreshold: CGFloat = 4
  /// Where the press went down, on screen, and whether it has become a drag (``onDrag``).
  private var press: (start: CGPoint, dragging: Bool)?

  /// The pointer is over the button: a light wash, unless it is pressed or disabled.
  var isHovered = false {
    didSet {
      guard isHovered != oldValue else { return }
      needsDisplay = true
    }
  }

  var isSelected = false {
    didSet {
      guard isSelected != oldValue else { return }
      updateTint()
      needsDisplay = true
    }
  }

  /// `selection` is nil for a plain action (undo, confirm…); `side` is the circle's diameter (a
  /// smaller one fits a control inside a chip). The owner sets `target` once it exists.
  init(selection: Selection?, side: CGFloat = AnnotationToolbarButton.side, action: Selector) {
    self.selection = selection
    label = nil
    super.init(frame: CGRect(x: 0, y: 0, width: side, height: side))
    configure(width: side, height: side, action: action)
  }

  /// A labelled action: `image` (a template glyph drawn at ``Label/iconSide``) then `text`, cut
  /// with an ellipsis past ``Label/maxTextWidth``, ``Label/padding`` in from each end. `width`
  /// stretches it past its natural width (``Label/width(text:hasImage:)``) with the label still
  /// leading, as a menu row as wide as its longest sibling; nil keeps the natural width.
  /// `selection` is nil for an action, `wash` for one of a choice.
  init(
    label text: String, image: NSImage?, width: CGFloat? = nil, selection: Selection? = nil,
    action: Selector
  ) {
    self.selection = selection
    label = (text, image)
    let width = width ?? Label.width(text: text, hasImage: image != nil)
    super.init(frame: CGRect(x: 0, y: 0, width: width, height: Self.side))
    configure(width: width, height: Self.side, action: action)
    setAccessibilityLabel(text)
  }

  private func configure(width: CGFloat, height: CGFloat, action: Selector) {
    isBordered = false
    imagePosition = .imageOnly
    imageScaling = .scaleNone
    title = ""
    focusRingType = .exterior
    self.action = action
    translatesAutoresizingMaskIntoConstraints = false
    let widthConstraint = widthAnchor.constraint(equalToConstant: width)
    self.widthConstraint = widthConstraint
    NSLayoutConstraint.activate([
      widthConstraint, heightAnchor.constraint(equalToConstant: height),
    ])
  }

  /// A labelled button's new text and glyph, as wide as they are
  /// (``Label/width(text:hasImage:)``), so the button never shows room for a longer label it is
  /// not saying; its bar grows or shrinks with it, and an owner that must keep its place reserves
  /// the longer forms in its layout instead. `width` holds a steady width only for a live control
  /// pressed again and again while its bar must not move (the long screenshot's scroll toggle).
  func setLabel(_ text: String, image: NSImage?, width: CGFloat? = nil) {
    guard label != nil else { return }
    label = (text, image)
    widthConstraint?.constant = width ?? Label.width(text: text, hasImage: image != nil)
    setAccessibilityLabel(text)
    needsDisplay = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isEnabled: Bool {
    didSet {
      needsDisplay = true
      window?.invalidateCursorRects(for: self)
    }
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  // MARK: Dragging

  /// A button that can be moved tracks its own press instead of AppKit's click loop, which would
  /// keep the drag to itself.
  override func mouseDown(with event: NSEvent) {
    guard onDrag != nil, isEnabled else { return super.mouseDown(with: event) }
    press = (NSEvent.mouseLocation, false)
    isHighlighted = true
  }

  override func mouseDragged(with event: NSEvent) {
    guard let onDrag, let press else { return super.mouseDragged(with: event) }
    // Measured on screen, as the bar measures its drags: the window moves under the pointer.
    let point = NSEvent.mouseLocation
    if !press.dragging {
      guard hypot(point.x - press.start.x, point.y - press.start.y) >= Self.dragThreshold
      else { return }
      self.press?.dragging = true
      isHighlighted = false
      onDrag(.began)
    }
    onDrag(.moved(CGVector(dx: point.x - press.start.x, dy: press.start.y - point.y)))
    PointerRole.grabbing.cursor.set()
  }

  override func mouseUp(with event: NSEvent) {
    guard onDrag != nil, let press else { return super.mouseUp(with: event) }
    self.press = nil
    isHighlighted = false
    if press.dragging {
      // Still over the button, where the toolbar's hover shows the pointing hand.
      PointerRole.action.cursor.set()
    } else {
      sendAction(action, to: target)
    }
  }

  // MARK: Drawing

  override func draw(_ dirtyRect: NSRect) {
    let circle = capsule
    if presentation == .primary {
      // Lighter while hovered and pressed, as the island's send buttons; dimmed while disabled.
      NSGraphicsContext.saveGraphicsState()
      NSGraphicsContext.current?.cgContext.setAlpha(
        !isEnabled ? 0.4 : isHighlighted ? 0.7 : isHovered ? 0.85 : 1)
      NSColor.labelColor.setFill()
      circle.fill()
      NSGraphicsContext.restoreGraphicsState()
    } else if selection == .wash, isSelected, isEnabled {
      let dark = effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
      let opacity: CGFloat = presentation == .captureMode ? (dark ? 0.14 : 0.08) : 0.16
      NSColor.labelColor.withAlphaComponent(opacity).setFill()
      circle.fill()
    } else if selection == .fill || selection == .toggle, isSelected {
      NSColor.controlAccentColor.withAlphaComponent(isHighlighted ? 0.8 : 1).setFill()
      circle.fill()
    } else if let wash {
      NSColor.labelColor.withAlphaComponent(wash).setFill()
      circle.fill()
    }
    if selection == .ring, isSelected {
      let ring = NSBezierPath(ovalIn: bounds.insetBy(dx: 3, dy: 3))
      ring.lineWidth = 2
      NSColor.controlAccentColor.setStroke()
      ring.stroke()
    }
    if let label {
      // On the accent fill a label takes the white a lone glyph takes (``updateTint()``).
      let onAccent = isSelected && (selection == .fill || selection == .toggle)
      Label.draw(
        text: label.text, image: label.image, in: bounds, enabled: isEnabled,
        textColor: onAccent ? .white : presentation == .standard ? nil : colors.text,
        imageColor: onAccent ? .white : presentation == .standard ? nil : colors.image)
    } else if let image, image.isTemplate {
      // Drawn here rather than tinted by AppKit, which dims a template image whenever the window
      // is not key (the selection toolbar's app never activates): glyphs take the label colour
      // of the toolbar's text in either toolbar, or the button's own tint.
      let rect = NSRect(
        x: bounds.midX - image.size.width / 2, y: bounds.midY - image.size.height / 2,
        width: image.size.width, height: image.size.height)
      Label.tinted(image, colors.image, size: image.size).draw(in: rect)
    } else {
      super.draw(dirtyRect)
    }
  }

  private var colors: (text: NSColor, image: NSColor) {
    switch presentation {
    case .success: return (.labelColor, .controlAccentColor)
    case .muted: return (.secondaryLabelColor, .secondaryLabelColor)
    case .captureMode where isEnabled:
      let color: NSColor = isSelected ? .labelColor : .secondaryLabelColor
      return (color, color)
    case .primary:
      let dark = effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
      let opposite: NSColor = dark ? .black : .white
      return (opposite, opposite)
    default:
      return (
        isEnabled ? .labelColor : Self.disabledColor,
        isEnabled ? contentTintColor ?? .labelColor : Self.disabledColor
      )
    }
  }

  /// A circle for a square button, a capsule for a labelled one.
  private var capsule: NSBezierPath {
    let radius = min(bounds.width, bounds.height) / 2
    return NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius)
  }

  /// The neutral wash: none at rest, light on hover, deeper while pressed; never when disabled.
  private var wash: CGFloat? {
    guard isEnabled else { return nil }
    if isHighlighted { return 0.16 }
    return isHovered ? 0.09 : nil
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
    trackingArea = nil
    guard followsPointer else { return }
    // `.activeAlways`: the overlay panel is non-activating, so hover must not wait for key.
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

  // MARK: Focus and accessibility

  override var focusRingMaskBounds: NSRect { bounds }

  override func drawFocusRingMask() {
    capsule.fill()
  }

  override func accessibilityRole() -> NSAccessibility.Role? {
    switch selection {
    case nil: super.accessibilityRole()
    case .toggle: .checkBox
    case .fill, .ring, .wash: .radioButton
    }
  }

  override func accessibilityValue() -> Any? {
    selection == nil ? super.accessibilityValue() : NSNumber(value: isSelected)
  }
}
