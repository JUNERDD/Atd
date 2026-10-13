import AICore
import AppKit

/// A row of the selection toolbar's menus: the More menu's commands and the options menus' values
/// and options. It keeps the toolbar's labelled button metrics (``AnnotationToolbarButton/Label``:
/// a capsule ``AnnotationToolbarButton/side`` tall, the same padding, font and washes) and adds
/// what a menu row needs: a trailing slot (``slotSide``) for a value's or a toggle's checkmark or
/// the chevron of a row that opens a submenu, as a pop-up menu marks its choice at the trailing
/// edge, and a detail in the secondary colour right before it (a choice's current value, the Run
/// row's values, Fill in Atd). Rows whose siblings use the slot keep it empty (``Mark/blank``),
/// so every mark and chevron shares one column and every detail ends at the same edge. A title
/// keeps ``detailGap`` from the slot, as from a detail, so a checkmark reads as the column's
/// rather than the title's. The title and the detail are cut with
/// an ellipsis past their caps; the full text is the tooltip. The title's cap
/// (``maxTitleWidth``) is wider than a capsule button's, since a menu stacks its rows and an
/// answer destination's name runs longer than a command's.
///
/// Like the toolbar's buttons it never tracks the pointer itself: ``SelectionToolbarHover`` sets
/// ``isHovered``. ``isActive`` keeps the hover wash while the row's submenu is open.
final class ToolbarOptionsRow: NSButton, ToolbarHoverable {
  struct Content: Equatable {
    enum Mark: Equatable {
      /// No trailing slot unless the row opens a submenu: the More menu's rows.
      case none
      /// The slot, empty: rows aligned with marked siblings.
      case blank
      case check
    }

    var title: String
    var detail: String?
    /// Details the row may switch to (a choice's other values), measured with ``detail`` so the
    /// menu keeps its width as values change.
    var reserved: [String] = []
    var mark: Mark = .none
    var submenu = false
    /// An on/off option: VoiceOver reads a checkbox whose value is the mark.
    var toggle = false
  }

  static let maxTitleWidth: CGFloat = 240
  /// The trailing slot a checkmark or a submenu chevron takes, centred in it.
  static let slotSide = AnnotationToolbarButton.Label.iconSide
  static let maxDetailWidth: CGFloat = 160
  static let detailGap: CGFloat = 16
  static let detailFont = NSFont.systemFont(ofSize: 13)

  var content: Content {
    didSet {
      guard content != oldValue else { return }
      describe()
      needsDisplay = true
    }
  }

  var isHovered = false {
    didSet { if isHovered != oldValue { needsDisplay = true } }
  }

  /// The row's submenu is open.
  var isActive = false {
    didSet { if isActive != oldValue { needsDisplay = true } }
  }

  init(_ content: Content, width: CGFloat, action: Selector) {
    self.content = content
    let side = AnnotationToolbarButton.side
    super.init(frame: NSRect(x: 0, y: 0, width: width, height: side))
    isBordered = false
    title = ""
    self.action = action
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: width),
      heightAnchor.constraint(equalToConstant: side),
    ])
    describe()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override var isHighlighted: Bool {
    didSet { needsDisplay = true }
  }

  /// The row's natural width: its parts at their measured widths, text up to its caps.
  static func width(_ content: Content) -> CGFloat {
    let label = AnnotationToolbarButton.Label.self
    let title = min(measure(content.title, label.font), maxTitleWidth)
    let detail = detailWidth(content)
    // The slot sits right after a detail, and as far from a bare title as a detail would.
    let slot = hasSlot(content) ? slotSide + (detail > 0 ? label.iconGap : detailGap) : 0
    return label.padding * 2 + title + (detail > 0 ? detailGap + detail : 0) + slot
  }

  /// Whether the row keeps the trailing slot: for its chevron, or a mark (shown or blank).
  private static func hasSlot(_ content: Content) -> Bool {
    content.submenu || content.mark != .none
  }

  private static func detailWidth(_ content: Content) -> CGFloat {
    let widths = ([content.detail].compactMap(\.self) + content.reserved).map {
      measure($0, detailFont)
    }
    return min(widths.max() ?? 0, maxDetailWidth)
  }

  private static func measure(_ text: String, _ font: NSFont) -> CGFloat {
    ceil(text.size(withAttributes: [.font: font]).width)
  }

  // MARK: Drawing

  override func draw(_ dirtyRect: NSRect) {
    let label = AnnotationToolbarButton.Label.self
    if isEnabled, let wash = isHighlighted ? 0.16 : (isHovered || isActive ? 0.09 : nil) {
      let radius = bounds.height / 2
      NSColor.labelColor.withAlphaComponent(wash).setFill()
      NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius).fill()
    }
    let color = isEnabled ? NSColor.labelColor : AnnotationToolbarButton.disabledColor
    let x = bounds.minX + label.padding
    var trailing = bounds.maxX - label.padding
    if Self.hasSlot(content) {
      let slot = NSRect(
        x: trailing - Self.slotSide, y: bounds.midY - Self.slotSide / 2, width: Self.slotSide,
        height: Self.slotSide)
      if content.submenu, let chevron = ToolbarOptionsGlyphs.submenu {
        ToolbarOptionsGlyphs.draw(chevron, color: .secondaryLabelColor, centeredIn: slot)
      } else if content.mark == .check, let check = ToolbarOptionsGlyphs.check {
        ToolbarOptionsGlyphs.draw(check, color: color, centeredIn: slot)
      }
      trailing -= Self.slotSide + label.iconGap
    }
    if let detail = content.detail, !detail.isEmpty {
      let width = min(Self.measure(detail, Self.detailFont), Self.maxDetailWidth)
      let room = max(0, min(width, trailing - x - Self.detailGap))
      text(detail, font: Self.detailFont, color: .secondaryLabelColor, alignment: .right)
        .draw(in: line(x: trailing - room, width: room, font: Self.detailFont))
      trailing -= room + Self.detailGap
    } else if Self.hasSlot(content) {
      trailing -= Self.detailGap - label.iconGap
    }
    text(content.title, font: label.font, color: color, alignment: .left)
      .draw(in: line(x: x, width: max(0, trailing - x), font: label.font))
  }

  private func text(
    _ string: String, font: NSFont, color: NSColor, alignment: NSTextAlignment
  ) -> NSAttributedString {
    let style = NSMutableParagraphStyle()
    style.lineBreakMode = .byTruncatingTail
    style.alignment = alignment
    return NSAttributedString(
      string: string,
      attributes: [.font: font, .foregroundColor: color, .paragraphStyle: style])
  }

  /// One line of `font` at `x`, centred on the row.
  private func line(x: CGFloat, width: CGFloat, font: NSFont) -> NSRect {
    let height = ceil(font.ascender - font.descender + font.leading)
    return NSRect(x: x, y: bounds.midY - height / 2, width: width, height: height)
  }

  // MARK: Accessibility

  private func describe() {
    let detail = content.detail.flatMap { $0.isEmpty ? nil : $0 }
    toolTip = detail.map { "\(content.title) — \($0)" } ?? content.title
    setAccessibilityLabel(detail.map { "\(content.title), \($0)" } ?? content.title)
    setAccessibilityRole(content.toggle ? .checkBox : .menuItem)
    setAccessibilitySelected(!content.toggle && content.mark == .check)
  }

  override func accessibilityValue() -> Any? {
    content.toggle ? NSNumber(value: content.mark == .check) : super.accessibilityValue()
  }
}

/// The hairline between an options menu's rows and its Run row.
final class ToolbarOptionsSeparator: NSView {
  init(width: CGFloat) {
    super.init(frame: NSRect(x: 0, y: 0, width: width, height: 0))
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: width),
      heightAnchor.constraint(equalToConstant: SelectionToolbarMenuLayout.separatorHeight),
    ])
    setAccessibilityElement(false)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func draw(_ dirtyRect: NSRect) {
    let inset = AnnotationToolbarButton.Label.padding
    NSColor.separatorColor.setFill()
    NSRect(x: inset, y: floor(bounds.midY), width: bounds.width - inset * 2, height: 1).fill()
  }
}

/// The options half of a split command button on the toolbar's capsule: a narrow capsule with a
/// down chevron right after the command's own button, washed like it, and held in its pressed
/// wash while its options menu is open (``isActive``). One that ends the capsule
/// (``endsCapsule``) is as wide as the toolbar's square buttons, so its wash is a circle that
/// nests in the capsule's round end like More's; a narrow capsule's tighter corners would not.
final class ToolbarOptionsChevron: NSButton, ToolbarHoverable {
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

  private var widthConstraint: NSLayoutConstraint!

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
}

/// The menus' glyphs: SF Symbols, which ship with the system, since the toolbar's Lucide asset
/// set has no chevrons; drawn tinted here rather than by AppKit, which dims a template image in
/// a window that is not key (the toolbar's never is).
enum ToolbarOptionsGlyphs {
  static let check = symbol("checkmark", size: 11, weight: .semibold)
  static let submenu = symbol("chevron.right", size: 10, weight: .semibold)
  static let options = symbol("chevron.down", size: 9, weight: .bold)

  private static func symbol(_ name: String, size: CGFloat, weight: NSFont.Weight) -> NSImage? {
    NSImage(systemSymbolName: name, accessibilityDescription: nil)?
      .withSymbolConfiguration(.init(pointSize: size, weight: weight))
  }

  /// `image` in `color` at its own size, centred in `box`.
  static func draw(_ image: NSImage, color: NSColor, centeredIn box: NSRect) {
    let size = image.size
    let rect = NSRect(
      x: box.midX - size.width / 2, y: box.midY - size.height / 2, width: size.width,
      height: size.height)
    AnnotationToolbarButton.Label.tinted(image, color, size: size).draw(in: rect)
  }
}
