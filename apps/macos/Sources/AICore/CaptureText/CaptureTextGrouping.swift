import CoreGraphics
import Foundation

/// How recognized lines become paragraphs in reading order (``CaptureTextLayout/init(lines:)``).
/// Recognition reports roughly one box per line, sometimes a line in fragments, never paragraphs,
/// so the grouping goes by geometry alone, in three passes:
///
/// 1. Fragments of one row join into a line: their vertical centres agree within half the smaller
///    height and the gap between them is at most ``wordGap`` heights (a wider gap is another
///    column or a table's next cell).
/// 2. Lines join the paragraph above when the gap from its last line is at most ``lineGap``
///    heights, their heights differ by at most ``heightRatio``, and the line lines up with the
///    paragraph (left edges within ``edgeSlack`` heights, or centred on it) while overlapping it
///    across; a line that opens with a list marker, or that follows a line ending well short of
///    the paragraph's right edge (a paragraph's last line), starts a new one.
/// 3. Paragraphs are put in reading order by recursive cuts (XY-cut): columns first, split where no
///    paragraph crosses a vertical gap of at least ``columnGap`` heights, then bands top to bottom
///    where no paragraph crosses a horizontal gap; what neither splits reads top to bottom, then
///    left to right. A heading over two columns therefore comes first, then the left column whole,
///    then the right one.
///
/// It is a heuristic: unusual layouts (tables without row gaps, text set around images) may group
/// or order differently from how a person reads them.
public enum CaptureTextGrouping {
  /// The widest gap between fragments of one line, in line heights.
  public static let wordGap: CGFloat = 1
  /// The widest gap between the lines of one paragraph, in line heights.
  public static let lineGap: CGFloat = 0.8
  /// The most two lines of one paragraph may differ in height.
  public static let heightRatio: CGFloat = 1.4
  /// How far a line's left edge may sit from its paragraph's, in line heights (a first-line
  /// indent, a hanging punctuation mark).
  public static let edgeSlack: CGFloat = 1.5
  /// The narrowest vertical gap that separates two columns, in line heights.
  public static let columnGap: CGFloat = 0.8

  /// The paragraphs of `boxes`, in reading order.
  public static func paragraphs(_ boxes: [ScreenContext.TextBox]) -> [CaptureTextParagraph] {
    let lines = joinedRows(boxes)
    guard !lines.isEmpty else { return [] }
    let groups = grouped(lines)
    let heights = lines.map(\.box.height).sorted()
    let gap = max(heights[heights.count / 2] * columnGap, 4)
    let paragraphs = groups.map { CaptureTextParagraph(lines: $0.lines.map { ($0.text, $0.box) }) }
    return ordered(paragraphs, gap: gap)
  }

  /// A line in the making.
  struct Piece {
    var text: String
    var box: CGRect
  }

  // MARK: 1. Rows

  /// The fragments as lines: each row's fragments that sit close together, joined left to right.
  static func joinedRows(_ boxes: [ScreenContext.TextBox]) -> [Piece] {
    let fragments = boxes.compactMap { box -> Piece? in
      let text = box.text.trimmingCharacters(in: .whitespacesAndNewlines)
      let rect = box.box.standardized
      guard !text.isEmpty, !rect.isNull, rect.width > 0, rect.height > 0 else { return nil }
      return Piece(text: text, box: rect)
    }
    .sorted { ($0.box.minX, $0.box.minY) < ($1.box.minX, $1.box.minY) }
    var lines: [Piece] = []
    for fragment in fragments {
      let height = fragment.box.height
      let row = lines.lastIndex { line in
        let small = min(line.box.height, height)
        let gap = fragment.box.minX - line.box.maxX
        return abs(line.box.midY - fragment.box.midY) <= small / 2
          && max(line.box.height, height) / small <= heightRatio
          && gap >= -small / 2 && gap <= small * wordGap
      }
      if let row {
        let tight =
          lines[row].text.last.flatMap { last in
            fragment.text.first.map { CaptureTextParagraph.joinsTight(last, $0) }
          } ?? true
        lines[row].text += (tight ? "" : " ") + fragment.text
        lines[row].box = lines[row].box.union(fragment.box)
      } else {
        lines.append(fragment)
      }
    }
    return lines.sorted { ($0.box.minY, $0.box.minX) < ($1.box.minY, $1.box.minX) }
  }

  // MARK: 2. Paragraphs

  /// A paragraph in the making: its lines, top to bottom, and what joining it compares.
  struct Group {
    var lines: [Piece]
    var box: CGRect
    /// The right edge of every line but the last.
    var right: CGFloat?

    init(_ line: Piece) {
      lines = [line]
      box = line.box
    }

    mutating func append(_ line: Piece) {
      right = max(right ?? -.infinity, lines[lines.count - 1].box.maxX)
      lines.append(line)
      box = box.union(line.box)
    }

    var last: Piece { lines[lines.count - 1] }
  }

  /// The lines, top to bottom, gathered into paragraphs, each top to bottom. Only paragraphs whose
  /// last line is near enough above the line are compared, so the pass stays about linear.
  static func grouped(_ lines: [Piece]) -> [Group] {
    var groups: [Group] = []
    var open: [Int] = []
    for line in lines {
      open.removeAll { line.box.minY - groups[$0].last.box.maxY > groups[$0].last.box.height * 2 }
      let fit =
        startsItem(line.text)
        ? nil
        : open.filter { continues(groups[$0], with: line) }
          .min { groups[$0].last.box.maxY > groups[$1].last.box.maxY }
      if let fit {
        groups[fit].append(line)
      } else {
        groups.append(Group(line))
        open.append(groups.count - 1)
      }
    }
    return groups
  }

  /// Whether `line` reads on from the paragraph `group`.
  static func continues(_ group: Group, with line: Piece) -> Bool {
    let last = group.last
    let height = max(last.box.height, line.box.height)
    let small = min(last.box.height, line.box.height)
    let box = group.box
    let gap = line.box.minY - last.box.maxY
    guard line.box.minY > last.box.midY, gap >= -small * 0.4, gap <= height * lineGap,
      height / small <= heightRatio
    else { return false }
    let overlap = min(line.box.maxX, box.maxX) - max(line.box.minX, box.minX)
    guard overlap > min(line.box.width, box.width) * 0.3 else { return false }
    let aligned = abs(line.box.minX - box.minX) <= height * edgeSlack
    let centred = abs(line.box.midX - box.midX) <= height * edgeSlack
    guard aligned || centred else { return false }
    // A line ending well short of the lines above it ended its paragraph.
    if aligned, let right = group.right,
      last.box.maxX < right - max(height * 2, box.width * 0.15)
    {
      return false
    }
    return true
  }

  /// A bullet, a dash, a number or a CJK list marker opening the line.
  static func startsItem(_ text: String) -> Bool {
    let range = NSRange(text.startIndex..., in: text)
    return itemMarker.firstMatch(in: text, range: range) != nil
  }

  private static let itemMarker = try! NSRegularExpression(
    pattern: "^(?:[•·◦▪‣●○■□✓✔※]|[-–—*]\\s|\\(?\\d{1,3}[.)、]\\s?|[①-⑳]|[一二三四五六七八九十]+、)")

  // MARK: 3. Reading order

  /// `paragraphs` in reading order: cut into columns, else bands, recursively.
  static func ordered(_ paragraphs: [CaptureTextParagraph], gap: CGFloat) -> [CaptureTextParagraph]
  {
    guard paragraphs.count > 1 else { return paragraphs }
    if let columns = split(paragraphs, along: \.minX, \.maxX, gap: gap) {
      return columns.flatMap { ordered($0, gap: gap) }
    }
    if let bands = split(paragraphs, along: \.minY, \.maxY, gap: 0) {
      return bands.flatMap { ordered($0, gap: gap) }
    }
    return paragraphs.sorted { ($0.box.minY, $0.box.minX) < ($1.box.minY, $1.box.minX) }
  }

  /// `paragraphs` in groups along one axis, where no paragraph crosses a gap wider than `gap`;
  /// nil when they do not split.
  private static func split(
    _ paragraphs: [CaptureTextParagraph], along start: KeyPath<CGRect, CGFloat>,
    _ end: KeyPath<CGRect, CGFloat>, gap: CGFloat
  ) -> [[CaptureTextParagraph]]? {
    let sorted = paragraphs.sorted { $0.box[keyPath: start] < $1.box[keyPath: start] }
    var groups: [[CaptureTextParagraph]] = []
    var reach = -CGFloat.infinity
    for paragraph in sorted {
      if groups.isEmpty || paragraph.box[keyPath: start] > reach + gap {
        groups.append([paragraph])
      } else {
        groups[groups.count - 1].append(paragraph)
      }
      reach = max(reach, paragraph.box[keyPath: end])
    }
    return groups.count > 1 ? groups : nil
  }
}
