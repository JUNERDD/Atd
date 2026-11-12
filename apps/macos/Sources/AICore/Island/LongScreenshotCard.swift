import CoreGraphics

/// The built-in asks under the long screenshot card's field, each sent as its localized question.
public enum LongScreenshotQuickAsk: String, CaseIterable, Sendable {
  case summary, table, keyInfo
}

/// Asks about kept ranges equal to the whole point and with the same annotations
/// (``AnnotationDocument/askKey``) are about the same range: other annotations send another
/// image, and another text with it.
extension LongScreenshotKept: CardAskRange {
  public var askKey: [Int] {
    [Int(top.rounded()), Int(bottom.rounded())] + annotations.askKey
  }

  /// The kept height in points.
  public var height: CGFloat { bottom - top }

  /// `box` (image points) counts as kept when its centre is inside the range, as Atd's pages and
  /// the recognized text are cut.
  public func keeps(_ box: CGRect) -> Bool {
    box.midY >= top && box.midY < bottom
  }

  /// `box` (image points) shows in the range at all, however little of it: what covering must
  /// hide, since half a number cut by a handle can still be read.
  public func touches(_ box: CGRect) -> Bool {
    box.maxY > top && box.minY < bottom
  }

  /// This range with only the parts named replaced.
  func with(
    top: CGFloat? = nil, bottom: CGFloat? = nil, annotations: AnnotationDocument? = nil
  ) -> Self {
    Self(
      top: top ?? self.top, bottom: bottom ?? self.bottom,
      annotations: annotations ?? self.annotations)
  }
}

extension LongScreenshotAsk: CardAsk {
  public init(id: String, question: String, range: LongScreenshotKept, replacing: String?) {
    self.init(id: id, question: question, kept: range, replacing: replacing)
  }
}

/// One answer page of the long screenshot card's answer slot (``CardAnswer``).
public typealias LongScreenshotAnswer = CardAnswer<LongScreenshotKept, LongScreenshotQuickAsk>

/// The long screenshot card's one answer slot (``CardAnswers``).
public typealias LongScreenshotAnswers = CardAnswers<LongScreenshotAsk, LongScreenshotQuickAsk>

/// One page Atd reads of the kept range (``LongScreenshotPages``): its rows in image points and
/// the first recognized lines on it, in reading order.
public struct LongScreenshotCardPage: Equatable, Sendable {
  public let top: CGFloat
  public let bottom: CGFloat
  public let lines: [String]
}

/// How many sensitive items of one kind lie in the kept range.
public struct LongScreenshotSensitiveCount: Equatable, Sendable {
  public let kind: SensitiveText.Kind
  public let count: Int
}

/// The long screenshot card's own state, apart from asking (decision D11): the range it keeps
/// between its two handles and what is on the image (``LongScreenshotKept``), and what follows
/// from them for the card to show: the pages Atd reads, their recognized lines and the sensitive
/// items found, and which of those no mosaic hides yet. It lives with the source while the card
/// is shown again (the panel taking the keyboard) and goes with it.
public struct LongScreenshotCardState: Sendable {
  public let source: LongScreenshotCardSource
  public private(set) var kept: LongScreenshotKept

  public enum Edge: Sendable { case top, bottom }

  /// The kept range is never shorter than this (or the whole image, when shorter).
  public static let minKept: CGFloat = 60
  /// The handle nudge a press of an arrow key moves, as the prototype's: 20 pt, 100 pt with ⇧.
  public static func nudge(shift: Bool) -> CGFloat { shift ? 100 : 20 }
  /// The recognized lines a page's row shows, at most.
  public static let pageLines = 3

  public init(source: LongScreenshotCardSource) {
    self.source = source
    kept = LongScreenshotKept(top: 0, bottom: source.shot.pointSize.height)
  }

  /// The whole image's height in points.
  public var height: CGFloat { source.shot.pointSize.height }

  public var shortest: CGFloat { min(Self.minKept, height) }

  /// Moves one end of the kept range to `y` (image points), within the image and at least
  /// ``shortest`` from the other end; answers what it became.
  @discardableResult
  public mutating func setTrim(_ edge: Edge, to y: CGFloat) -> CGFloat {
    switch edge {
    case .top:
      let top = min(max(y, 0), kept.bottom - shortest).rounded()
      kept = kept.with(top: top)
      return top
    case .bottom:
      let bottom = min(max(y, kept.top + shortest), height).rounded()
      kept = kept.with(bottom: bottom)
      return bottom
    }
  }

  /// Moves one end by `points` (an arrow key's nudge).
  @discardableResult
  public mutating func nudge(_ edge: Edge, by points: CGFloat) -> CGFloat {
    setTrim(edge, to: (edge == .top ? kept.top : kept.bottom) + points)
  }

  /// Either end moved off the image's own.
  public var isTrimmed: Bool { kept.top > 0.5 || kept.bottom < height - 0.5 }

  /// "还原" undoes the trim and everything on the image: what was drawn, the mosaics over the
  /// sensitive items and the text commands' results (decision D5).
  public var canRestore: Bool { isTrimmed || !kept.annotations.isEmpty }

  /// The whole image again, with nothing on it.
  public mutating func restore() {
    kept = LongScreenshotKept(top: 0, bottom: height)
  }

  /// What is on the image (``LongScreenshotKept/annotations``).
  public var annotations: AnnotationDocument { kept.annotations }

  /// Makes `document` (image points) what is on the image: the lightbox keeps every change here
  /// as it is made, with no step to confirm it.
  public mutating func setAnnotations(_ document: AnnotationDocument) {
    kept = kept.with(annotations: document)
  }

  /// The screens the kept range spans: its height over one screen of the capture.
  public var screens: Double { Double(kept.height / max(source.shot.screenHeight, 1)) }

  /// The sensitive parts that show in the kept range, also those a handle cuts through.
  public var keptSensitive: [SensitiveText.Box] {
    source.sensitive.filter { kept.touches($0.box) }
  }

  /// The kinds found in the kept range with their counts, in ``SensitiveText/Kind``'s order.
  public var sensitiveCounts: [LongScreenshotSensitiveCount] { Self.counts(keptSensitive) }

  /// The sensitive parts in the kept range that no mosaic on the image hides yet
  /// (``SensitiveText/uncovered(_:by:)``): what Cover Sensitive Info covers, and while there are
  /// any, the card and the lightbox offer it (decision D7). Nothing is covered by default.
  public var unmaskedSensitive: [SensitiveText.Box] {
    SensitiveText.uncovered(keptSensitive, by: kept.redactedAreas)
  }

  /// ``unmaskedSensitive`` by kind with their counts, in ``SensitiveText/Kind``'s order.
  public var unmaskedSensitiveCounts: [LongScreenshotSensitiveCount] {
    Self.counts(unmaskedSensitive)
  }

  private static func counts(_ found: [SensitiveText.Box]) -> [LongScreenshotSensitiveCount] {
    SensitiveText.Kind.allCases.compactMap { kind in
      let count = found.filter { $0.kind == kind }.count
      return count > 0 ? LongScreenshotSensitiveCount(kind: kind, count: count) : nil
    }
  }

  /// The recognized lines Atd reads with the image, top to bottom: those in the kept range, less
  /// every line a mosaic on the image touches (``LongScreenshotKept/redactedAreas``), as a
  /// screenshot's context leaves out a line with one hidden word rather than show it in part.
  public var keptLines: [LongScreenshotLine] {
    let hidden = kept.redactedAreas
    return source.lines
      .filter { line in
        kept.keeps(line.box) && !hidden.contains { !line.box.intersection($0).isEmpty }
      }
      .sorted { ($0.box.midY, $0.box.minX) < ($1.box.midY, $1.box.minX) }
  }

  /// The characters of ``keptLines`` that are not white space.
  public var characterCount: Int {
    keptLines.reduce(0) { sum, line in sum + line.text.filter { !$0.isWhitespace }.count }
  }

  /// The pages Atd reads the kept range as, top to bottom, each with its first lines.
  public var pages: [LongScreenshotCardPage] {
    let scale = max(source.shot.scale, 0.01)
    let pixelHeight = Int((kept.height * scale).rounded())
    let rows = LongScreenshotPages.rows(
      pixelWidth: source.shot.image.width, pixelHeight: pixelHeight)
    let lines = keptLines
    return rows.map { row in
      let top = kept.top + CGFloat(row.lowerBound) / scale
      // The last page ends where the range does, whatever the pixel rounding.
      let bottom =
        row.upperBound >= pixelHeight
        ? kept.bottom : min(kept.top + CGFloat(row.upperBound) / scale, kept.bottom)
      let inside = lines.filter { $0.box.midY >= top && $0.box.midY < bottom }
      return LongScreenshotCardPage(
        top: top, bottom: bottom, lines: inside.prefix(Self.pageLines).map(\.text))
    }
  }
}
