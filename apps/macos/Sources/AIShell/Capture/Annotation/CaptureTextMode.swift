import AICore
import AppKit
import NaturalLanguage

/// Text mode over a capture selection's recognized text (the plan's 「选取文字」, decision D4): the
/// paragraphs of the latest reading (``CaptureTextLayout``), the paragraphs picked in them
/// (``CaptureTextPicks``), the characters selected (``CaptureTextCharacters``), and the pointer
/// gesture in progress. Every point is a desktop point, as the recognized boxes are.
///
/// The pointer works as in the plan's prototype: a press picks on the press itself (only its
/// paragraph, ⌘ toggling it, ⇧ the run in reading order from the last paragraph clicked, ⌘⇧ adding
/// that run), and a plain press on empty space clears the picks. A drag that starts on the text of
/// a paragraph without ⌘ or ⇧ selects characters instead (the picks go); any other drag draws a
/// marquee that picks what it touches, added to the picks as they were before the press while ⌘
/// or ⇧ is held. A double-click on text selects the word under it (``NLTokenizer``, so CJK text
/// splits into words too).
///
/// A paragraph any mosaic touches (``mask(_:)``) can be neither picked nor selected, and gives
/// nothing to a copy, a command or a launch (decision D6); a pick it hid comes back once the
/// mosaic moves away.
final class CaptureTextMode {
  /// A press in text mode that has not moved far enough to be a drag.
  struct Press {
    let start: CGPoint
    /// It began on the text of an available paragraph without ⌘ or ⇧: a drag selects characters.
    let onText: Bool
    /// ⌘ or ⇧ was held: a marquee adds to ``base``.
    let adding: Bool
    /// The picks as they were before the press.
    let base: CaptureTextPicks
  }

  enum Gesture {
    case idle
    case pressed(Press)
    /// A marquee from the press's start to the pointer (the rect).
    case marquee(Press, CGRect)
    case characters
    /// Escape dropped the gesture: the rest of the drag does nothing.
    case cancelled
  }

  /// How far a press travels before it is a drag, as the prototype's.
  static let dragThreshold: CGFloat = 4

  private(set) var isOn = false
  private(set) var layout = CaptureTextLayout.empty
  private(set) var glyphs = CaptureTextGlyphs.empty
  /// The picks as made; ``picks`` leaves out the paragraphs a mosaic touches now.
  private var made = CaptureTextPicks()
  private(set) var characters: CaptureTextCharacters?
  private(set) var gesture = Gesture.idle
  /// The available paragraph under the pointer.
  private(set) var hovered: Int?
  /// The paragraphs no mosaic touches, in reading order, and the same as a set.
  private(set) var available: [Int] = []
  private(set) var availableSet: Set<Int> = []
  private var masks: [CGRect] = []

  /// The picks among the paragraphs no mosaic touches.
  var picks: CaptureTextPicks { made.filtered(availableSet) }

  /// A new reading of the selection's text; nil (still being read) keeps the last one. Picks carry
  /// over to the paragraphs that read the same in about the same place; selected characters go.
  func read(_ text: CaptureText?) {
    guard let text else { return }
    let next = CaptureTextLayout(lines: text.boxes)
    guard next != layout || text.glyphs != glyphs else { return }
    made = made.revalidated(from: layout, to: next, available: Set(next.indices))
    layout = next
    glyphs = text.glyphs
    characters = nil
    hovered = nil
    gesture = .idle
    refreshAvailable()
  }

  /// The mosaics' rects now.
  func mask(_ areas: [CGRect]) {
    guard areas != masks else { return }
    masks = areas
    refreshAvailable()
  }

  private func refreshAvailable() {
    available = layout.available(hiding: masks)
    availableSet = Set(available)
    if let hovered, !availableSet.contains(hovered) { self.hovered = nil }
  }

  /// Turns text mode on or off; either way it starts with nothing picked or selected.
  func set(on: Bool) {
    isOn = on
    made.clear()
    characters = nil
    gesture = .idle
    hovered = nil
  }

  // MARK: What is selected

  /// The selected characters while any of them is available.
  var selectedCharacters: CaptureTextCharacters? {
    guard let characters, !characters.isEmpty,
      !characters.parts(in: layout, available: availableSet).isEmpty
    else { return nil }
    return characters
  }

  /// The paragraphs a command reads now, in reading order: every one the selected characters
  /// touch (whole), else the picked ones, else every available one.
  var reading: [Int] {
    if let selected = selectedCharacters {
      return selected.paragraphs(in: layout, available: availableSet)
    }
    return picks.reading(available: available)
  }

  /// ``reading`` as far as one run takes it (``CaptureTextRun/capacity(of:)``), in order.
  var runReading: [Int] {
    let reading = reading
    return Array(
      reading.prefix(CaptureTextRun.capacity(of: reading.lazy.map { self.layout[$0].text })))
  }

  /// What a command reads, as its scope chip and its run say it.
  var scope: CaptureTextScope {
    guard selectedCharacters != nil else { return picks.scope(available: available) }
    return CaptureTextScope(kind: .picked, count: reading.count)
  }

  /// How many characters (white space aside) are selected; nil while none are.
  var selectedCount: Int? {
    selectedCharacters.map { characters in
      characters.text(in: layout, available: availableSet).filter { !$0.isWhitespace }.count
    }
  }

  /// What a launch from the capture and ⌘C take from the text: the selected characters, else the
  /// picked paragraphs (a blank line apart); nil while nothing is picked or text mode is off.
  var selection: String? {
    guard isOn else { return nil }
    if let selected = selectedCharacters {
      return selected.text(in: layout, available: availableSet)
    }
    let picks = picks
    guard !picks.isEmpty else { return nil }
    return layout.selection(picks.reading(available: available))
  }

  /// What a launch from the text row that ends the capture (the Fill in Atd intent, an ask) reads
  /// (``AnnotationEditing/pickedText``): the selected characters, else what a run would read now
  /// (``runReading``: the picked paragraphs, or every available one), a blank line apart; nil
  /// while text mode is off or there is no text.
  var launchSelection: String? {
    guard isOn else { return nil }
    if let selected = selectedCharacters?.text(in: layout, available: availableSet),
      selected.utf16.count <= CaptureTextRun.maxSelectionLength
    {
      return selected
    }
    let text = layout.selection(runReading)
    return text.isEmpty ? nil : text
  }

  /// What the text row's Copy copies: the selection, or all the available text without one; nil
  /// when there is none.
  var copyText: String? {
    let text = selection ?? layout.selection(available)
    return text.isEmpty ? nil : text
  }

  // MARK: Keys

  /// ⌘A: every available paragraph.
  func selectAll() {
    characters = nil
    made.selectAll(availableSet)
  }

  /// Escape's first steps: drops a marquee (the picks go back to what they were before it) or a
  /// character drag in progress. False when no gesture was in progress.
  func cancelGesture() -> Bool {
    switch gesture {
    case .marquee(let press, _):
      made = press.base
    case .characters:
      characters = nil
    case .pressed, .idle, .cancelled:
      return false
    }
    gesture = .cancelled
    return true
  }

  /// Escape's next step (and the scope chip's ×): the selected characters go, else the picks.
  /// False when neither was there.
  func clearSelection() -> Bool {
    if characters != nil {
      characters = nil
      return true
    }
    guard !made.isEmpty else { return false }
    made.clear()
    return true
  }

  // MARK: Pointer

  /// The available paragraph under `point`.
  func paragraph(at point: CGPoint) -> Int? {
    guard let index = layout.paragraph(at: point), availableSet.contains(index) else { return nil }
    return index
  }

  /// Hover over `point` (nil: away); true when the paragraph under it changed.
  func hover(_ point: CGPoint?) -> Bool {
    let next = point.flatMap(paragraph(at:))
    guard next != hovered else { return false }
    hovered = next
    return true
  }

  func pressDown(at point: CGPoint, flags: NSEvent.ModifierFlags, clicks: Int) {
    let command = flags.contains(.command)
    let shift = flags.contains(.shift)
    let index = paragraph(at: point)
    let onText = !command && !shift && index.map { layout.line(at: point, in: $0) != nil } == true
    if clicks >= 2, onText, let index, let word = word(at: point, in: index) {
      made.clear()
      characters = word
      gesture = .characters
      return
    }
    characters = nil
    let base = picks
    // The second press of a double-click off the text changes nothing more.
    if clicks == 1 { pick(index, command: command, shift: shift) }
    gesture = .pressed(Press(start: point, onText: onText, adding: command || shift, base: base))
  }

  func dragged(to point: CGPoint) {
    switch gesture {
    case .pressed(let press):
      let travel = hypot(point.x - press.start.x, point.y - press.start.y)
      guard travel > Self.dragThreshold else { return }
      guard press.onText else { return marquee(press, to: point) }
      made.clear()
      guard let anchor = layout.caret(at: press.start, glyphs: glyphs, available: availableSet)
      else {
        gesture = .cancelled
        return
      }
      characters = CaptureTextCharacters(anchor: anchor, focus: anchor)
      gesture = .characters
      extend(to: point)
    case .marquee(let press, _):
      marquee(press, to: point)
    case .characters:
      extend(to: point)
    case .idle, .cancelled:
      break
    }
  }

  /// The press was let go; it is returned when it was a click (it never travelled far enough to
  /// drag).
  @discardableResult
  func released() -> Press? {
    if case .characters = gesture, characters?.isEmpty == true { characters = nil }
    let click: Press? = if case .pressed(let press) = gesture { press } else { nil }
    gesture = .idle
    return click
  }

  /// A press on paragraph `index` (nil: empty space), as macOS lists pick.
  private func pick(_ index: Int?, command: Bool, shift: Bool) {
    guard let index else {
      if !command && !shift { made.clear() }
      return
    }
    if shift, command, let anchor = made.anchor, layout.indices.contains(anchor) {
      made = CaptureTextPicks.marquee(
        Array(layout.range(from: anchor, to: index)), over: picks, adding: true,
        available: availableSet)
    } else {
      made.click(
        index, shift ? .extend : command ? .toggle : .only, in: layout, available: availableSet)
    }
  }

  private func marquee(_ press: Press, to point: CGPoint) {
    let rect = CGRect(
      x: min(press.start.x, point.x), y: min(press.start.y, point.y),
      width: abs(point.x - press.start.x), height: abs(point.y - press.start.y))
    made = CaptureTextPicks.marquee(
      layout.paragraphs(touching: rect), over: press.base, adding: press.adding,
      available: availableSet)
    gesture = .marquee(press, rect)
  }

  private func extend(to point: CGPoint) {
    guard var selected = characters,
      let caret = layout.caret(at: point, glyphs: glyphs, available: availableSet)
    else { return }
    selected.focus = caret
    characters = selected
  }

  /// The word under `point` in paragraph `index`, as the system's word boundaries split its text;
  /// off a word (a space, punctuation) the character under it alone.
  private func word(at point: CGPoint, in index: Int) -> CaptureTextCharacters? {
    guard let lineIndex = layout.line(at: point, in: index) else { return nil }
    let line = layout[index].lines[lineIndex]
    guard !line.text.isEmpty else { return nil }
    let carets = glyphs.carets(for: line)
    let within = (0..<line.text.count).last { carets[$0] <= point.x } ?? 0
    let text = layout[index].text
    let offset = min(line.range.lowerBound + within, text.count - 1)
    let tokenizer = NLTokenizer(unit: .word)
    tokenizer.string = text
    let token = tokenizer.tokenRange(at: text.index(text.startIndex, offsetBy: offset))
    let range =
      token.isEmpty
      ? offset..<(offset + 1)
      : text.distance(
        from: text.startIndex, to: token.lowerBound)..<text.distance(
          from: text.startIndex, to: token.upperBound)
    return CaptureTextCharacters(
      anchor: CaptureTextCaret(paragraph: index, offset: range.lowerBound),
      focus: CaptureTextCaret(paragraph: index, offset: range.upperBound))
  }
}
