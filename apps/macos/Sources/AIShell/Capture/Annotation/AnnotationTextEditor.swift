import AICore
import AppKit

/// In-place text entry for the text tool: a transparent `NSTextView` on the canvas, so IME
/// marked text and candidate windows work as in any text field. It types with the renderer's
/// attributes and the same line layout (no inset, no line fragment padding), so the committed
/// annotation draws exactly where the text was. Esc or a click elsewhere ends the edit and
/// keeps the text; an edit left empty removes the annotation. With a text background the canvas
/// draws the plate behind the text view (the view itself stays transparent). The finished edit
/// is one undo step in the document; keystrokes have their own history while the editor is open.
/// Text that is a box (``AnnotationStyle/fixedWidth``, a command's text in place) keeps its frame's
/// width while it is edited and never gets shorter than it was, so its plate keeps covering what
/// it covered.
final class AnnotationTextEditor: NSObject, NSTextViewDelegate {
  private struct Session {
    let view: AnnotationEditorTextView
    let id: UUID
    let existing: Bool
    var style: AnnotationStyle
    /// A box's frame as the edit began: its width and the least height it keeps.
    var box: CGRect?
  }

  private let store: AnnotationStore
  private var session: Session?

  /// Typing history of the open editor, kept apart from the document's.
  let typingUndo = UndoManager()
  /// The edit ended; the canvas takes the keyboard back.
  var onEnd: (() -> Void)?

  init(store: AnnotationStore) {
    self.store = store
  }

  var isEditing: Bool { session != nil }

  /// The text view's frame in canvas (view) points, for the canvas's editing outline.
  var frame: CGRect? { session?.view.frame }
  /// The style of the text being edited; nil when no edit is open.
  var style: AnnotationStyle? { session?.style }

  /// Whether the open text is typed on `canvas` (it opens on one canvas of several).
  func isHosted(in canvas: NSView) -> Bool { session?.view.superview === canvas }

  /// Opens the editor on `existing`, or for new text with its first line centred on `point`
  /// (or at top-left with `boxWidth` when dragged into a fixed-width box).
  func begin(
    at point: CGPoint, boxWidth: CGFloat? = nil, editing existing: Annotation?,
    style: AnnotationStyle, in canvas: NSView
  ) {
    end()
    let view = AnnotationEditorTextView.make()
    var origin = point
    var text = ""
    var style = style
    var box: CGRect?
    if let existing, case .text(let string, let frame) = existing.shape {
      (origin, text, style) = (frame.origin, string, existing.style)
      if style.fixedWidth { box = frame }
    } else if let boxWidth {
      style.fixedWidth = true
      box = CGRect(origin: origin, size: CGSize(width: max(boxWidth, 24), height: 0))
    } else {
      origin.y -= Self.lineHeight(style, in: view) / 2
    }
    let area = canvas.bounds
    if box == nil {
      origin.x = min(max(origin.x, area.minX), max(area.maxX - 24, area.minX))
      origin.y = max(origin.y, area.minY)
    }
    configure(view, style: style, width: box?.width ?? area.maxX - origin.x)
    view.textStorage?.setAttributedString(
      NSAttributedString(string: text, attributes: AnnotationRenderer.textAttributes(style)))
    view.frame = CGRect(origin: origin, size: CGSize(width: 2, height: 2))
    canvas.addSubview(view)
    let id = existing?.id ?? UUID()
    session = Session(view: view, id: id, existing: existing != nil, style: style, box: box)
    view.onLayoutNeeded = { [weak self] in self?.fit() }
    store.selectedID = nil
    store.editingID = id
    fit()
    view.selectAll(nil)
    canvas.window?.makeFirstResponder(view)
  }

  /// A key that reached another canvas while text is open: a press on the bars or the
  /// selection's handles on another display made that overlay key. The text's window takes the
  /// keyboard back and the key is typed, so letters, Return and arrows act on the text as they
  /// would had the keyboard stayed with it.
  func type(_ event: NSEvent) {
    guard let view = session?.view, let window = view.window else { return }
    window.makeKey()
    window.makeFirstResponder(view)
    view.keyDown(with: event)
  }

  /// Restyles the whole text being edited (colour, size, font, or plate from the style bar).
  func setStyle(_ style: AnnotationStyle) {
    guard let view = session?.view, let storage = view.textStorage else { return }
    session?.style = style
    let savedRange = view.selectedRange()
    let attributes = AnnotationRenderer.textAttributes(style)
    let markedKeys: [NSAttributedString.Key] = [
      .underlineStyle, .underlineColor, .markedClauseSegment,
    ]
    var preservedMarked: [(NSRange, [NSAttributedString.Key: Any])] = []
    if view.hasMarkedText() {
      let marked = view.markedRange()
      if marked.location != NSNotFound, marked.length > 0,
        marked.location <= storage.length, marked.length <= storage.length - marked.location
      {
        storage.enumerateAttributes(in: marked, options: []) { attrs, range, _ in
          var kept: [NSAttributedString.Key: Any] = [:]
          for key in markedKeys {
            if let value = attrs[key] { kept[key] = value }
          }
          if !kept.isEmpty { preservedMarked.append((range, kept)) }
        }
      }
    }
    storage.beginEditing()
    storage.setAttributes(attributes, range: NSRange(location: 0, length: storage.length))
    for (range, kept) in preservedMarked {
      storage.addAttributes(kept, range: range)
    }
    storage.endEditing()
    let clampedLoc = min(savedRange.location, storage.length)
    let clampedLen = min(savedRange.length, storage.length - clampedLoc)
    view.setSelectedRange(NSRange(location: clampedLoc, length: clampedLen))
    view.typingAttributes = attributes
    view.font = attributes[.font] as? NSFont
    view.insertionPointColor = AnnotationRenderer.textColor(style)
    fit()
  }

  /// Updates the open editor's fixed wrapping width during east/west box drags and reflows lines.
  func resizeBoxWidth(to width: CGFloat) {
    guard var active = session else { return }
    let clamped = max(width, 24)
    active.style.fixedWidth = true
    if var box = active.box {
      box.size.width = clamped
      active.box = box
    } else {
      active.box = CGRect(
        origin: active.view.frame.origin, size: CGSize(width: clamped, height: 0))
    }
    session = active
    active.view.textContainer?.containerSize.width = clamped
    fit()
  }

  /// Recomputes font attributes and line layout for open text (e.g. after a web font loads).
  func refreshLayout() {
    guard let style = session?.style else { return }
    setStyle(style)
  }

  /// The selection moved or resized under open text: the text keeps its place on the screen
  /// and wraps at the selection's new right edge; a box keeps its own width.
  func selectionDidChange() {
    guard let view = session?.view, session?.box == nil, let canvas = view.superview else { return }
    view.textContainer?.containerSize.width = max(canvas.bounds.maxX - view.frame.minX, 24)
    fit()
  }

  /// Ends the edit, committing its text.
  func end() {
    guard let session else { return }
    close()
    let annotation = Annotation(
      id: session.id, shape: .text(session.view.string, frame: session.view.frame),
      style: session.style)
    let keep = AnnotationPath.isSubstantial(annotation.shape)
    var document = store.document
    if session.existing {
      if keep { document.update(annotation) } else { document.remove(session.id) }
    } else if keep {
      document.add(annotation)
    }
    store.commit(document)
    // Finished text stays selected like any new annotation, so its colour and size can change.
    if keep { store.selectedID = session.id }
    onEnd?()
  }

  /// Ends the edit without touching the document (the editor is hiding).
  func cancel() {
    guard session != nil else { return }
    close()
  }

  private func close() {
    if session?.view.hasMarkedText() == true {
      session?.view.inputContext?.discardMarkedText()
    }
    session?.view.onLayoutNeeded = nil
    session?.view.removeFromSuperview()
    session = nil
    typingUndo.removeAllActions()
    store.editingID = nil
  }

  private func configure(_ view: NSTextView, style: AnnotationStyle, width: CGFloat) {
    view.delegate = self
    view.drawsBackground = false
    view.isRichText = false
    view.importsGraphics = false
    view.allowsUndo = true
    view.isAutomaticQuoteSubstitutionEnabled = false
    view.isAutomaticDashSubstitutionEnabled = false
    view.isAutomaticTextReplacementEnabled = false
    view.isContinuousSpellCheckingEnabled = false
    view.focusRingType = .none
    view.textContainerInset = .zero
    view.isHorizontallyResizable = false
    view.isVerticallyResizable = false
    let attributes = AnnotationRenderer.textAttributes(style)
    view.typingAttributes = attributes
    view.font = attributes[.font] as? NSFont
    view.insertionPointColor = AnnotationRenderer.textColor(style)
    // The text wraps at the selection's right edge (``selectionDidChange()`` keeps it there), a
    // box at its own width; ``fit`` sizes the view to what is typed.
    view.textContainer?.lineFragmentPadding = 0
    view.textContainer?.widthTracksTextView = false
    view.textContainer?.heightTracksTextView = false
    view.textContainer?.containerSize = CGSize(
      width: max(width, 24), height: .greatestFiniteMagnitude)
  }

  /// Sizes the view to the laid-out text (one empty line at least). The width keeps 4 pt for
  /// the caret and marked text; lines never get wider than the container, so the renderer, wrapping
  /// at this width, breaks lines where the editor did. A box stays its width and at least its
  /// height.
  private func fit() {
    guard let session, let container = session.view.textContainer,
      let layout = session.view.layoutManager
    else { return }
    layout.ensureLayout(for: container)
    if let storage = session.view.textStorage, storage.length > 0 {
      layout.ensureLayout(forCharacterRange: NSRange(location: 0, length: storage.length))
      layout.ensureLayout(for: container)
    }
    var rect = layout.usedRect(for: container)
    if layout.extraLineFragmentTextContainer === container {
      rect = rect.union(layout.extraLineFragmentUsedRect)
    }
    let width =
      session.box?.width ?? min(max(ceil(rect.maxX) + 4, 8), container.containerSize.width)
    let height = max(
      ceil(rect.maxY), Self.lineHeight(session.style, in: session.view),
      session.box?.height ?? 0)
    session.view.setFrameSize(CGSize(width: width, height: height))
    session.view.superview?.needsDisplay = true
  }

  private static func lineHeight(_ style: AnnotationStyle, in view: NSTextView) -> CGFloat {
    let font = CaptureFontCatalog.shared.font(
      family: style.fontFamily, size: style.textFontSize, weight: .semibold)
    return ceil(view.layoutManager?.defaultLineHeight(for: font) ?? style.textFontSize * 1.2)
  }

  // MARK: NSTextViewDelegate

  func textDidChange(_ notification: Notification) {
    fit()
  }

  /// Esc reaches the text view as `cancelOperation:`; it ends the edit (keeping the text)
  /// rather than going on to cancel the capture.
  func textView(_ textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
    guard commandSelector == #selector(NSResponder.cancelOperation(_:)) else { return false }
    end()
    return true
  }

  func undoManager(for view: NSTextView) -> UndoManager? {
    typingUndo
  }
}

/// TextKit 1 text view that notifies the editor immediately on IME composition changes
/// (`setMarkedText` / `unmarkText` do not emit `NSTextViewDelegate.textDidChange`).
private final class AnnotationEditorTextView: NSTextView {
  var onLayoutNeeded: (() -> Void)?

  static func make() -> AnnotationEditorTextView {
    let storage = NSTextStorage()
    let layout = NSLayoutManager()
    let container = NSTextContainer()
    storage.addLayoutManager(layout)
    layout.addTextContainer(container)
    return AnnotationEditorTextView(frame: .zero, textContainer: container)
  }

  override init(frame frameRect: NSRect, textContainer container: NSTextContainer?) {
    super.init(frame: frameRect, textContainer: container)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  override func setMarkedText(
    _ string: Any, selectedRange: NSRange, replacementRange: NSRange
  ) {
    super.setMarkedText(string, selectedRange: selectedRange, replacementRange: replacementRange)
    onLayoutNeeded?()
  }

  override func unmarkText() {
    super.unmarkText()
    onLayoutNeeded?()
  }

  override func insertText(_ string: Any, replacementRange: NSRange) {
    super.insertText(string, replacementRange: replacementRange)
    onLayoutNeeded?()
  }

  override func didChangeText() {
    super.didChangeText()
    onLayoutNeeded?()
  }
}
