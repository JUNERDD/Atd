import AICore
import AppKit

/// The control bar's second row: one glass capsule (``AnnotationGlassBar``) saying what to do or
/// what went wrong (``LongScreenshotMessage``), a glyph and one line on the labelled button's
/// metrics, hidden while there is nothing to say. At the page's end, when the scroll area goes on
/// below the selection, a toggle after a hairline adds that part to the image (``onTail``): the
/// image ends where the selection does until the user asks for more. The row hugs what it shows;
/// its owner keeps the widest message's room for it (``reservedSize``), so the control bar never
/// moves as messages come and go. Its surface moves the bar and the row together (``onDrag``).
///
/// VoiceOver hears each new message once, as the prototype's `role="status"` row announces it,
/// and the toggle as a checkbox.
final class LongScreenshotStatusRow: NSView {
  var onDrag: ((AnnotationGlassBar.Drag) -> Void)? {
    get { bar.onDrag }
    set { bar.onDrag = newValue }
  }
  /// The toggle for the scroll area's part below the selection was clicked.
  var onTail: (() -> Void)?

  private let line = LongScreenshotBarText(style: LongScreenshotBarText.message)
  private let tailButton: AnnotationToolbarButton
  private let tailGlyph: NSImage
  private let bar: AnnotationGlassBar
  private var message: LongScreenshotMessage?
  /// The glyphs by Lucide name, made once each, so showing the same message draws nothing anew.
  private var glyphs: [String: NSImage] = [:]

  /// The size of the row around the widest message in the current language
  /// (``applyStrings()``).
  private(set) var reservedSize = CGSize.zero

  init() {
    let glyph = AnnotationIcons.glyph(LongScreenshotChromeIcons.tail, label: "")
    tailGlyph = glyph
    // Its label and width come with the copy (``applyStrings()``).
    tailButton = AnnotationToolbarButton(
      label: "", image: glyph, width: 0, selection: .toggle, action: #selector(tailClicked))
    bar = AnnotationGlassBar(groups: [[line], [tailButton]], blending: .withinWindow)
    super.init(frame: .zero)
    tailButton.target = self
    bar.setGroup(1, hidden: true)
    addSubview(bar)
    isHidden = true
    setAccessibilityElement(true)
    setAccessibilityRole(.group)
    applyStrings()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var fittingSize: NSSize { bar.fittingSize }

  override func layout() {
    super.layout()
    bar.frame = bounds
  }

  /// Reads the copy in the current shell language: measures the row around every message for
  /// ``reservedSize`` and shows the current one again.
  func applyStrings() {
    let copy = LongScreenshotChromeCopy.self
    setAccessibilityLabel(copy.text(.statusRow))
    let name = copy.text(.includeTail)
    tailButton.setLabel(
      name, image: tailGlyph,
      width: AnnotationToolbarButton.Label.width(text: name, hasImage: true))
    tailButton.toolTip = copy.text(.includeTailTooltip)
    let current = message
    reservedSize = copy.messages.reduce(CGSize.zero) { room, message in
      lay(message)
      let size = bar.fittingSize
      return CGSize(width: max(room.width, size.width), height: max(room.height, size.height))
    }
    message = nil
    show(current, announce: false)
  }

  /// Shows `message`, or hides the row for nil; the row's frame then hugs it, keeping its origin.
  func show(_ message: LongScreenshotMessage?, announce: Bool = true) {
    guard message != self.message else { return }
    let said = self.message.map(LongScreenshotChromeCopy.message)?.text
    self.message = message
    guard let message else {
      isHidden = true
      return
    }
    let text = lay(message)
    frame.size = bar.fittingSize
    isHidden = false
    // The toggle's own state is VoiceOver's to read; only new words are announced.
    if announce, text != said { Self.announce(text) }
  }

  /// Puts `message` in the row: its glyph and line, and the toggle when the end offers the part
  /// below the selection. Returns the line's text.
  @discardableResult
  private func lay(_ message: LongScreenshotMessage) -> String {
    let copy = LongScreenshotChromeCopy.message(message)
    let tint = copy.attention ? LongScreenshotChromeCopy.attention : NSColor.secondaryLabelColor
    line.width = line.naturalWidth(of: copy.text, glyph: true)
    line.show(copy.text, glyph: (glyph(copy.glyph), tint))
    let tail: LongScreenshotTail = if case .end(let tail) = message { tail } else { .none }
    bar.setGroup(1, hidden: tail == .none)
    tailButton.isSelected = tail == .included
    return copy.text
  }

  @objc private func tailClicked() { onTail?() }

  private func glyph(_ name: String) -> NSImage {
    if let image = glyphs[name] { return image }
    let image = AnnotationIcons.glyph(name, label: "")
    glyphs[name] = image
    return image
  }

  /// Says `text` to VoiceOver without moving its focus.
  private static func announce(_ text: String) {
    NSAccessibility.post(
      element: NSApplication.shared, notification: .announcementRequested,
      userInfo: [
        .announcement: text, .priority: NSAccessibilityPriorityLevel.medium.rawValue,
      ])
  }
}
