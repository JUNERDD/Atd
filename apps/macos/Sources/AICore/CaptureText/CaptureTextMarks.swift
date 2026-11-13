import CoreGraphics
import Foundation

/// How a text command's answer lands on the image (decision D2, the plan's 「截图上只有标记」): as
/// ordinary annotations the editor draws with its own tools, so they select, move, resize, restyle
/// and delete like any other, and never as pixels the model drew. A replacement is text on a plate
/// over its paragraph, sampled in the paragraph's colours and fitted to its box; a step is a
/// numbered badge at the paragraph's leading edge; a highlight is a highlighter mark along each
/// line it covers. All points are the paragraphs' space (``CaptureTextParagraph``).
///
/// A phrase's span within a line is estimated from character offsets, the line's width shared out
/// evenly between its characters, since recognition gives boxes per line only: on proportional
/// type a mark can start or end a few characters off.
public enum CaptureTextMarks {
  /// The size a line of `text` set at `fontSize` points takes wrapped at `width` points, laid out
  /// as the renderer draws text annotations (the shell measures with AppKit).
  public typealias Measure = (_ text: String, _ fontSize: CGFloat, _ width: CGFloat) -> CGSize

  /// What drawing an answer needs from its surface.
  public struct Context {
    /// The styles new steps and highlighter marks start from (the editor's remembered ones); their
    /// size is fitted to each paragraph's lines.
    public var stepStyle: AnnotationStyle
    public var highlightStyle: AnnotationStyle
    /// Where steps must stay: the selection, or the kept image.
    public var bounds: CGRect
    /// The colours under a paragraph (``CaptureTextColors/sample(_:region:)``).
    public var colors: (CaptureTextParagraph) -> CaptureTextColors
    public var measure: Measure

    public init(
      stepStyle: AnnotationStyle, highlightStyle: AnnotationStyle, bounds: CGRect,
      colors: @escaping (CaptureTextParagraph) -> CaptureTextColors, measure: @escaping Measure
    ) {
      self.stepStyle = stepStyle
      self.highlightStyle = highlightStyle
      self.bounds = bounds
      self.colors = colors
      self.measure = measure
    }
  }

  /// The smallest a replacement's type is fitted down to; a longer text grows its plate instead.
  public static let minimumFontSize: CGFloat = 7
  /// How far a replacement's plate reaches past its paragraph's box, so no glyph edge shows.
  public static let coverMargin: CGFloat = 2
  /// The gap between a step badge and the text it numbers.
  public static let stepGap: CGFloat = 4

  /// `document` without what another version of `run` put there (``CaptureTextRun/superseded``)
  /// and with every item of `run` that should be on the image and is not yet
  /// (``CaptureTextRun/unapplied``) drawn in front, and the annotations each item produced.
  public static func applying(
    _ run: CaptureTextRun, to document: AnnotationDocument, context: Context
  ) -> (document: AnnotationDocument, produced: [(item: Int, ids: [UUID])]) {
    var base = document
    for id in run.superseded { base.remove(id) }
    return drawing(run.unapplied, of: run, on: base, context: context)
  }

  /// What the version of `run` under review (``CaptureTextRun/previewed``) would draw over
  /// `document` were it applied now, as ``applying(_:to:context:)`` would land it (decision D12);
  /// nil when nothing previews.
  public static func preview(
    _ run: CaptureTextRun, over document: AnnotationDocument, context: Context
  ) -> CaptureTextPreview? {
    let (next, produced) = drawing(run.previewed, of: run, on: document, context: context)
    let ids = produced.flatMap(\.ids)
    guard !ids.isEmpty else { return nil }
    let replacements = produced.filter { run.items[$0.item].tool == .replace }.flatMap(\.ids)
    return CaptureTextPreview(
      document: next, ids: ids, replacements: Set(replacements),
      pending: run.review?.pending != nil || run.phase.running)
  }

  /// `document` with items `indices` of `run` drawn in front, in order, and what each drew: an
  /// item Reapply lands again keeps the ids it drew before (``CaptureTextRun/redrawn``) when it
  /// draws as many annotations as then.
  private static func drawing(
    _ indices: [Int], of run: CaptureTextRun, on document: AnnotationDocument, context: Context
  ) -> (document: AnnotationDocument, produced: [(item: Int, ids: [UUID])]) {
    var next = document
    var produced: [(item: Int, ids: [UUID])] = []
    for index in indices {
      let item = run.items[index]
      var marks: [Annotation] =
        if let id = item.paragraph, let paragraph = run[paragraph: id] {
          annotations(for: item, on: paragraph, in: next, context: context)
        } else {
          visualAnnotations(for: item, context: context)
        }
      if let ids = run.redrawn[index], ids.count == marks.count {
        marks = zip(ids, marks).map { Annotation(id: $0, shape: $1.shape, style: $1.style) }
      }
      for mark in marks { next.add(mark) }
      produced.append((index, marks.map(\.id)))
    }
    return (next, produced)
  }

  /// What `item` draws on `paragraph`, given what `document` holds already.
  public static func annotations(
    for item: CaptureTextRun.Item, on paragraph: CaptureTextParagraph,
    in document: AnnotationDocument, context: Context
  ) -> [Annotation] {
    switch item.tool {
    case .replace:
      let text = item.text.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !text.isEmpty else { return [] }
      return [
        translation(
          text, over: paragraph, colors: context.colors(paragraph), measure: context.measure)
      ]
    case .step:
      return [step(on: paragraph, style: context.stepStyle, within: context.bounds)]
    case .highlight:
      let whole = isReplaced(paragraph, in: document)
      return highlights(whole ? nil : item.phrase, in: paragraph, style: context.highlightStyle)
    case .mosaic:
      let whole = isReplaced(paragraph, in: document)
      return mosaics(whole ? nil : item.phrase, in: paragraph, style: context.stepStyle)
    case .box, .ellipse, .arrow, .spotlight:
      return visualAnnotations(for: item, context: context)
    }
  }

  /// `text` on a plate in `colors` over `paragraph`: the plate covers the paragraph's box (a few
  /// points past it), the text wraps at the plate's inner width, and its size is the largest from
  /// about the paragraph's own type size down to ``minimumFontSize`` that fits the plate's height
  /// (at the smallest, a longer text grows the plate downwards). The text is a box
  /// (``AnnotationStyle/fixedWidth``) and its stroke the nearest the size slider shows.
  public static func translation(
    _ text: String, over paragraph: CaptureTextParagraph, colors: CaptureTextColors,
    measure: Measure
  ) -> Annotation {
    let cover = paragraph.box.insetBy(dx: -coverMargin, dy: -coverMargin)
    var size = min(max((paragraph.lineHeight * 0.85 * 2).rounded() / 2, minimumFontSize), 43)
    var frame = CGRect.zero
    while true {
      let margins = AnnotationPath.textPlateMargins(fontSize: size)
      let width = max(cover.width - margins.width * 2, size * Annotation.minimumTextBoxWidth)
      let room = cover.height - margins.height * 2
      let height = ceil(measure(text, size, width).height)
      frame = CGRect(
        x: cover.minX + margins.width, y: cover.minY + margins.height, width: width,
        height: max(height, room))
      if height <= room || size <= minimumFontSize { break }
      size = max(size - 0.5, minimumFontSize)
    }
    let style = AnnotationStyle(
      color: colors.background.luminance > 0.5 ? .white : .black,
      stroke: AnnotationStroke(Double(size - 13) / 30), textBackground: true,
      plate: colors.background, ink: colors.ink, fontSize: size, fixedWidth: true)
    return Annotation(shape: .text(text, frame: frame), style: style)
  }

  /// A numbered badge in `style`, sized to the paragraph's first line, beside it on the leading
  /// side; where `bounds` leave no room there, after the line, then above it, and only where none
  /// of those fit, inside at the line's start. Its number is its place among the document's
  /// steps, so it continues the steps already drawn.
  public static func step(
    on paragraph: CaptureTextParagraph, style: AnnotationStyle, within bounds: CGRect
  ) -> Annotation {
    let line = paragraph.lines.first?.box ?? paragraph.box
    let diameter = min(max(line.height * 1.1, 19), 30)
    var badge = style
    badge.stroke = AnnotationStroke(Double(diameter - 19) / 30)
    let radius = badge.stroke.stepDiameter / 2
    let candidates = [
      CGPoint(x: line.minX - stepGap - radius, y: line.midY),
      CGPoint(x: line.maxX + stepGap + radius, y: line.midY),
      CGPoint(x: line.minX + radius, y: line.minY - stepGap - radius),
    ]
    let room = bounds.standardized
    guard room.width > radius * 2, room.height > radius * 2 else {
      return Annotation(shape: .step(center: CGPoint(x: room.midX, y: room.midY)), style: badge)
    }
    let inside = room.insetBy(dx: radius, dy: radius)
    let center =
      candidates.first { inside.contains($0) }
      ?? CGPoint(
        x: min(max(line.minX + radius, inside.minX), inside.maxX),
        y: min(max(line.midY, inside.minY), inside.maxY))
    return Annotation(shape: .step(center: center), style: badge)
  }

  /// Highlighter marks in `style` over `phrase` in `paragraph` (the whole paragraph when it is
  /// nil or not found), one along each line it covers, as wide as the line is tall.
  public static func highlights(
    _ phrase: String?, in paragraph: CaptureTextParagraph, style: AnnotationStyle
  ) -> [Annotation] {
    let span = phrase.flatMap { Self.span(of: $0, in: paragraph.text) } ?? 0..<paragraph.text.count
    return paragraph.lines.compactMap { line in
      let start = max(span.lowerBound, line.range.lowerBound)
      let end = min(span.upperBound, line.range.upperBound)
      guard start < end, !line.range.isEmpty else { return nil }
      let share = line.box.width / CGFloat(line.range.count)
      let from = line.box.minX + CGFloat(start - line.range.lowerBound) * share
      let to = line.box.minX + CGFloat(end - line.range.lowerBound) * share
      var mark = style
      mark.stroke = AnnotationStroke(Double(line.box.height - 8) / 40)
      let points = [CGPoint(x: from, y: line.box.midY), CGPoint(x: to, y: line.box.midY)]
      return Annotation(shape: .highlighter(points), style: mark)
    }
  }

  /// Where `phrase` lies in `text`, as character offsets: exactly, then ignoring case and runs of
  /// white space; nil when it is not there.
  static func span(of phrase: String, in text: String) -> Range<Int>? {
    let wanted = phrase.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !wanted.isEmpty else { return nil }
    let found =
      text.range(of: wanted)
      ?? text.range(of: wanted, options: [.caseInsensitive, .diacriticInsensitive])
      ?? collapsed(wanted).flatMap {
        text.range(of: $0, options: [.caseInsensitive, .regularExpression])
      }
    guard let found else { return nil }
    let start = text.distance(from: text.startIndex, to: found.lowerBound)
    return start..<(start + text.distance(from: found.lowerBound, to: found.upperBound))
  }

  /// `phrase` as a pattern in which any run of white space matches any other.
  private static func collapsed(_ phrase: String) -> String? {
    let words = phrase.split(whereSeparator: \.isWhitespace).map {
      NSRegularExpression.escapedPattern(for: String($0))
    }
    return words.count > 1 ? words.joined(separator: "\\s+") : nil
  }

  /// Whether text a command put in place covers most of `paragraph`, so its own phrases no longer
  /// show and a highlight marks the whole of it.
  static func isReplaced(_ paragraph: CaptureTextParagraph, in document: AnnotationDocument) -> Bool
  {
    document.annotations.contains { annotation in
      guard annotation.style.fixedWidth, case .text = annotation.shape else { return false }
      return annotation.bounds.intersection(paragraph.box).area >= paragraph.box.area / 2
    }
  }
}

/// A text command's answer under review as it would land (``CaptureTextMarks/preview(_:over:context:)``,
/// decision D12): the surface draws it over the image, outlined dashed, and never stores, exports
/// or undoes it. It follows the version shown and dims while another one is being made.
public struct CaptureTextPreview: Equatable, Sendable {
  /// The image's annotations with the preview's in front of them, so its step badges number on
  /// from the image's.
  public let document: AnnotationDocument
  /// The preview's annotations in ``document``, in the answer's order.
  public let ids: [UUID]
  /// Those of them that replace a paragraph's text, which ⌥ hides to show the original.
  public let replacements: Set<UUID>
  /// Another version is being made: the preview dims.
  public let pending: Bool
}
