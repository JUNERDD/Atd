import AppKit

/// A line of text on one of the long screenshot's glass bars: the control bar's count and the
/// status row's message. It is drawn rather than shown in a text field because it is not a
/// control: a press on it climbs the responder chain to its ``AnnotationGlassBar`` and moves the
/// bar, as a press on the bar's surface or grip does, and the overlay shows the open hand over it
/// (``AnnotationHostView/barCursor(at:)``). It is ``AnnotationToolbarButton/side`` tall and as
/// wide as its owner says (``width``), which reserves the widest text it may show so the bar never
/// resizes as the text changes; text past it is cut with an ellipsis. VoiceOver reads it as
/// static text.
final class LongScreenshotBarText: NSView {
  /// Its look: the font, the text's colour and the insets either side; a glyph, when shown,
  /// leads the text on the labelled button's metrics (``AnnotationToolbarButton/Label``).
  struct Style {
    let font: NSFont
    let color: NSColor
    let leading: CGFloat
    let trailing: CGFloat
  }

  /// The control bar's count: tabular digits in the secondary label colour, close to the
  /// auto-scroll button before it (`.lp-status` in the prototype).
  static let count = Style(
    font: .monospacedDigitSystemFont(ofSize: 13, weight: .medium), color: .secondaryLabelColor,
    leading: 4, trailing: 6)
  /// The status row's message, on the labelled button's metrics (`.lp-msg`).
  static let message = Style(
    font: AnnotationToolbarButton.Label.font, color: .labelColor,
    leading: AnnotationToolbarButton.Label.padding, trailing: AnnotationToolbarButton.Label.padding)

  private let style: Style
  private var widthConstraint: NSLayoutConstraint?

  private(set) var text = ""
  /// The leading glyph, a template image, and its colour.
  private(set) var glyph: (image: NSImage, color: NSColor)?

  init(style: Style) {
    self.style = style
    super.init(frame: CGRect(x: 0, y: 0, width: 0, height: AnnotationToolbarButton.side))
    translatesAutoresizingMaskIntoConstraints = false
    let width = widthAnchor.constraint(equalToConstant: 0)
    widthConstraint = width
    NSLayoutConstraint.activate([
      width, heightAnchor.constraint(equalToConstant: AnnotationToolbarButton.side),
    ])
    setAccessibilityElement(true)
    setAccessibilityRole(.staticText)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  /// The width given; the owner sets it from ``naturalWidth(of:glyph:)``.
  var width: CGFloat {
    get { widthConstraint?.constant ?? 0 }
    set { widthConstraint?.constant = newValue }
  }

  /// The width that shows `text` (after a glyph when `glyph`) whole.
  func naturalWidth(of text: String, glyph: Bool) -> CGFloat {
    let label = AnnotationToolbarButton.Label.self
    let lead = glyph ? label.iconSide + label.iconGap : 0
    return style.leading + lead + ceil(text.size(withAttributes: [.font: style.font]).width)
      + style.trailing
  }

  /// Shows `text` after `glyph` (none when nil).
  func show(_ text: String, glyph: (image: NSImage, color: NSColor)? = nil) {
    guard
      text != self.text || glyph?.image !== self.glyph?.image
        || glyph?.color != self.glyph?.color
    else { return }
    self.text = text
    self.glyph = glyph
    setAccessibilityValue(text)
    needsDisplay = true
  }

  override func draw(_ dirtyRect: NSRect) {
    let label = AnnotationToolbarButton.Label.self
    var x = bounds.minX + style.leading
    if let glyph {
      let icon = NSRect(
        x: x, y: bounds.midY - label.iconSide / 2, width: label.iconSide, height: label.iconSide)
      label.tinted(glyph.image, glyph.color, size: icon.size).draw(in: icon)
      x += label.iconSide + label.iconGap
    }
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byTruncatingTail
    let font = style.font
    let height = ceil(font.ascender - font.descender + font.leading)
    let rect = NSRect(
      x: x, y: bounds.midY - height / 2, width: max(0, bounds.maxX - style.trailing - x),
      height: height)
    NSAttributedString(
      string: text,
      attributes: [.font: font, .foregroundColor: style.color, .paragraphStyle: paragraph]
    ).draw(in: rect)
  }
}
