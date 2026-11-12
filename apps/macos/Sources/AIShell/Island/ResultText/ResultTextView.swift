import AppKit

/// The text view a result text shows in (``ResultText``): read-only and selectable, transparent,
/// without a focus ring or a scroll view of its own (the card's scrolls it), on TextKit 1, whose
/// text blocks draw code, quotes and tables. One view holds the whole text, so a selection runs
/// across its blocks. It takes the first click as the island's content does, copies plain text
/// (the label colour pasted elsewhere would be white on white in a dark scheme), opens web and
/// mail links, and reads to VoiceOver as static text.
final class ResultTextView: NSTextView {
  /// Takes a clicked link first; true when it handled it.
  var openLink: ((URL) -> Bool)?
  /// The rendering the storage shows (``ResultTextEdit``).
  private var shown = NSAttributedString()

  static func make() -> ResultTextView {
    let view = ResultTextView(usingTextLayoutManager: false)
    view.textContainer?.replaceLayoutManager(ResultLayoutManager())
    view.configure()
    return view
  }

  private func configure() {
    isEditable = false
    isSelectable = true
    importsGraphics = false
    allowsUndo = false
    usesFontPanel = false
    usesRuler = false
    usesFindBar = false
    drawsBackground = false
    backgroundColor = .clear
    focusRingType = .none
    textContainerInset = .zero
    isVerticallyResizable = false
    isHorizontallyResizable = false
    textContainer?.lineFragmentPadding = 0
    textContainer?.widthTracksTextView = true
    textContainer?.heightTracksTextView = false
    textContainer?.size = NSSize(width: bounds.width, height: .greatestFiniteMagnitude)
    linkTextAttributes = [
      .foregroundColor: ResultTextStyle.link, .cursor: NSCursor.pointingHand,
    ]
  }

  /// Shows `text` in place of the rendering shown, from the first character that changed; a
  /// selection before it stays, one reaching into it ends there.
  func show(_ text: NSAttributedString) {
    guard let storage = textStorage, let start = ResultTextEdit.firstChange(from: shown, to: text)
    else { return }
    let selection = selectedRanges.map(\.rangeValue)
    ResultTextEdit.apply(text, from: start, to: storage)
    shown = text
    var kept = ResultTextEdit.clamp(selection, before: start)
    if kept.isEmpty { kept = [NSRange(location: min(start, text.length), length: 0)] }
    guard kept != selectedRanges.map(\.rangeValue) else { return }
    setSelectedRanges(
      kept.map { NSValue(range: $0) }, affinity: .downstream, stillSelecting: false)
  }

  /// Whether a link is under `point` (the view's coordinates).
  func hasLink(at point: CGPoint) -> Bool {
    guard let manager = layoutManager, let container = textContainer,
      let storage = textStorage, storage.length > 0
    else { return false }
    let local = CGPoint(x: point.x - textContainerOrigin.x, y: point.y - textContainerOrigin.y)
    let glyph = manager.glyphIndex(for: local, in: container)
    let glyphRect = manager.boundingRect(
      forGlyphRange: NSRange(location: glyph, length: 1), in: container)
    guard glyphRect.contains(local) else { return false }
    let index = manager.characterIndexForGlyph(at: glyph)
    return index < storage.length && storage.attribute(.link, at: index, effectiveRange: nil) != nil
  }

  override func clicked(onLink link: Any, at charIndex: Int) {
    guard let url = link as? URL ?? (link as? String).flatMap(URL.init(string:)) else { return }
    if openLink?(url) == true { return }
    guard ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") else { return }
    NSWorkspace.shared.open(url)
  }

  override var writablePasteboardTypes: [NSPasteboard.PasteboardType] { [.string] }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  override func accessibilityRole() -> NSAccessibility.Role? { .staticText }

  override func accessibilityRoleDescription() -> String? {
    NSAccessibility.Role.staticText.description(with: nil)
  }
}
