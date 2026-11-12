import CoreGraphics
import Foundation

/// One paragraph of text recognized in a screenshot: the lines grouped into it, top to bottom,
/// and the text they read as together. Every box is in the space the recognized boxes came in, a
/// top-left point space with y down: the capture editor's desktop points or a long screenshot's
/// image points.
public struct CaptureTextParagraph: Equatable, Sendable {
  /// One recognized line of the paragraph (fragments of one row already joined): its text, its
  /// box, and where its text lies in the paragraph's ``CaptureTextParagraph/text``, as character
  /// offsets, which a highlighter over a phrase maps back to the line.
  public struct Line: Equatable, Sendable {
    public let text: String
    public let box: CGRect
    public let range: Range<Int>

    public init(text: String, box: CGRect, range: Range<Int>) {
      self.text = text
      self.box = box
      self.range = range
    }
  }

  public let lines: [Line]
  /// The lines' text, joined with a space, or with nothing next to CJK text.
  public let text: String
  /// The union of the lines' boxes.
  public let box: CGRect

  /// A paragraph of `lines`, given top to bottom with their text; none empty.
  public init(lines texts: [(text: String, box: CGRect)]) {
    var text = ""
    var lines: [Line] = []
    for line in texts {
      if let last = text.last, let first = line.text.first, !Self.joinsTight(last, first) {
        text.append(" ")
      }
      let start = text.count
      text += line.text
      lines.append(Line(text: line.text, box: line.box, range: start..<text.count))
    }
    self.lines = lines
    self.text = text
    box = texts.map(\.box).reduce(CGRect.null) { $0.union($1) }
  }

  /// The median height of its lines: about the size its type is set in.
  public var lineHeight: CGFloat {
    let heights = lines.map(\.box.height).sorted()
    guard !heights.isEmpty else { return 0 }
    return heights[heights.count / 2]
  }

  /// Whether text runs on from `last` to `first` without a space: next to a CJK character.
  static func joinsTight(_ last: Character, _ first: Character) -> Bool {
    isCJK(last) || isCJK(first)
  }

  /// Han, kana, Hangul, CJK punctuation and full-width forms.
  static func isCJK(_ character: Character) -> Bool {
    guard let scalar = character.unicodeScalars.first?.value else { return false }
    return (0x3000...0x303F).contains(scalar) || (0x3040...0x30FF).contains(scalar)
      || (0x3400...0x4DBF).contains(scalar) || (0x4E00...0x9FFF).contains(scalar)
      || (0xAC00...0xD7AF).contains(scalar) || (0xF900...0xFAFF).contains(scalar)
      || (0xFF00...0xFFEF).contains(scalar)
  }
}

/// The paragraphs of a screenshot's recognized text in reading order (``init(lines:)``), and
/// what the text interactions ask of them: which one is under the pointer, which ones a marquee
/// touches, the run of paragraphs between two in reading order, and which ones a mosaic hides.
/// A paragraph's index is its place in reading order; indexes stay valid for the layout they came
/// from only (a new reading makes a new layout; ``CaptureTextPicks/revalidated(from:to:available:)``
/// carries picks across).
public struct CaptureTextLayout: Equatable, Sendable {
  public let paragraphs: [CaptureTextParagraph]
  /// Each paragraph's index, by ``CaptureTextParagraph/readingKey``.
  private let positions: [String: Int]

  /// Groups recognized `lines` (any order, any top-left point space) into paragraphs in reading
  /// order (``CaptureTextGrouping``).
  public init(lines: [ScreenContext.TextBox]) {
    self.init(paragraphs: CaptureTextGrouping.paragraphs(lines))
  }

  /// A layout of paragraphs already in reading order.
  public init(paragraphs: [CaptureTextParagraph]) {
    self.paragraphs = paragraphs
    positions = Dictionary(
      paragraphs.enumerated().map { ($1.readingKey, $0) }, uniquingKeysWith: { first, _ in first })
  }

  /// Where `paragraph` stands in the layout: how a run's paragraphs, whichever of its versions
  /// read them, find their place again.
  public func index(of paragraph: CaptureTextParagraph) -> Int? {
    positions[paragraph.readingKey]
  }

  public static let empty = CaptureTextLayout(paragraphs: [])

  public var isEmpty: Bool { paragraphs.isEmpty }
  public var indices: Range<Int> { paragraphs.indices }

  public subscript(index: Int) -> CaptureTextParagraph { paragraphs[index] }

  /// The paragraph under `point`: one with a line within `slack` points of it, else the smallest
  /// whose box is, so a press between two lines of a paragraph still picks it.
  public func paragraph(at point: CGPoint, slack: CGFloat = 2) -> Int? {
    let near = { (box: CGRect) in box.insetBy(dx: -slack, dy: -slack).contains(point) }
    if let index = paragraphs.firstIndex(where: { $0.lines.contains { near($0.box) } }) {
      return index
    }
    return paragraphs.indices.filter { near(paragraphs[$0].box) }
      .min { paragraphs[$0].box.area < paragraphs[$1].box.area }
  }

  /// The paragraphs a marquee over `rect` touches with any of their lines, in reading order.
  public func paragraphs(touching rect: CGRect) -> [Int] {
    let area = rect.standardized
    return paragraphs.indices.filter { index in
      paragraphs[index].lines.contains { $0.box.intersects(area) }
    }
  }

  /// Every paragraph from `first` to `last` in reading order, whichever comes first.
  public func range(from first: Int, to last: Int) -> ClosedRange<Int> {
    min(first, last)...max(first, last)
  }

  /// The paragraphs any of `areas` (mosaics) touches with area: they leave picks, copy and
  /// command input whole, as a line a mosaic touches leaves the screen context
  /// (``ScreenContext/unredacted(_:hiding:)``). Moving the mosaic away brings them back.
  public func masked(by areas: [CGRect]) -> Set<Int> {
    guard !areas.isEmpty else { return [] }
    let covers = areas.map(\.standardized)
    return Set(
      paragraphs.indices.filter { index in
        paragraphs[index].lines.contains { line in
          covers.contains { cover in
            let overlap = line.box.standardized.intersection(cover)
            return !overlap.isNull && overlap.width > 0 && overlap.height > 0
          }
        }
      })
  }

  /// The paragraphs no area in `areas` touches, in reading order.
  public func available(hiding areas: [CGRect]) -> [Int] {
    let masked = masked(by: areas)
    return paragraphs.indices.filter { !masked.contains($0) }
  }

  /// The text of `indices` in reading order, a blank line between paragraphs: the selection a
  /// screenshot command or ask reads, and what Copy text copies of picked paragraphs.
  public func selection(_ indices: some Sequence<Int>) -> String {
    Set(indices).sorted().filter { paragraphs.indices.contains($0) }
      .map { paragraphs[$0].text }.joined(separator: "\n\n")
  }
}

extension CGRect {
  /// Width times height; zero for a null rect.
  var area: CGFloat { isNull ? 0 : width * height }
}
