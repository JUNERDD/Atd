import CoreGraphics
import Foundation

/// Where the characters of a screenshot's recognized text sit, for selecting it by the character
/// (``CaptureTextCharacters``). Recognition boxes roughly a line at a time; while the capture
/// editor reads the selection it also asks the recognizer for the box of every character of each
/// piece it found (``Run/characters``), in the same space as the pieces. A paragraph line whose
/// pieces are found here gets its characters' real edges; any other line, or one whose
/// characters the recognizer could not box, shares its width out evenly between its characters
/// (``carets(for:)``), so a caret can sit a character off on proportional type.
public struct CaptureTextGlyphs: Equatable, Sendable {
  /// One recognized piece of text, as recognition gave it (untrimmed), its box, and one box per
  /// character of its text, ``CGRect/null`` where the recognizer gave none; empty when none was
  /// asked for.
  public struct Run: Equatable, Sendable {
    public let text: String
    public let box: CGRect
    public let characters: [CGRect]

    public init(text: String, box: CGRect, characters: [CGRect]) {
      self.text = text
      self.box = box
      self.characters = characters
    }
  }

  public let runs: [Run]

  public init(runs: [Run] = []) {
    self.runs = runs
  }

  public static let empty = Self()

  /// The edges between the characters of `line`, left to right: `line.text.count + 1` x
  /// positions, the first at its first character's leading edge and the last at its last
  /// character's trailing edge. Edges between two characters sit halfway across the gap between
  /// them.
  public func carets(for line: CaptureTextParagraph.Line) -> [CGFloat] {
    let count = line.text.count
    guard let spans = spans(for: line), spans.count == count, count > 0 else {
      let width = line.box.width / CGFloat(max(count, 1))
      return (0...count).map { line.box.minX + width * CGFloat($0) }
    }
    var carets = [spans[0].lowerBound]
    for index in 1..<count {
      let edge = (spans[index - 1].upperBound + spans[index].lowerBound) / 2
      carets.append(max(edge, carets[carets.count - 1]))
    }
    carets.append(max(spans[count - 1].upperBound, carets[carets.count - 1]))
    return carets
  }

  /// Each character's extent across `line`, from the pieces that make it up, joined left to right
  /// as ``CaptureTextGrouping`` joins a row's fragments (a space between them, none next to CJK
  /// text; an added space spans the gap between its neighbours); nil when the pieces found there
  /// do not spell the line's text.
  private func spans(for line: CaptureTextParagraph.Line) -> [ClosedRange<CGFloat>]? {
    let area = line.box.insetBy(dx: -1, dy: -1)
    let pieces = runs.compactMap { run -> (text: [Character], spans: [ClosedRange<CGFloat>])? in
      let box = run.box.standardized
      guard run.characters.count == run.text.count, area.contains(box),
        let piece = Self.trimmed(run)
      else { return nil }
      return piece
    }
    .sorted { ($0.spans.first?.lowerBound ?? 0) < ($1.spans.first?.lowerBound ?? 0) }
    var text: [Character] = []
    var spans: [ClosedRange<CGFloat>] = []
    for piece in pieces {
      if let last = text.last, let first = piece.text.first,
        !CaptureTextParagraph.joinsTight(last, first), let before = spans.last,
        let after = piece.spans.first
      {
        text.append(" ")
        spans.append(before.upperBound...max(before.upperBound, after.lowerBound))
      }
      text += piece.text
      spans += piece.spans
    }
    return String(text) == line.text ? spans : nil
  }

  /// `run`'s characters without the white space around them, as grouping trims its text, each
  /// with its extent across; one the recognizer gave no box for takes its even share of the
  /// run's box. Nil when nothing is left.
  private static func trimmed(_ run: Run) -> (text: [Character], spans: [ClosedRange<CGFloat>])? {
    let characters = Array(run.text)
    guard let first = characters.firstIndex(where: { !$0.isWhitespace }),
      let last = characters.lastIndex(where: { !$0.isWhitespace })
    else { return nil }
    let box = run.box.standardized
    let share = box.width / CGFloat(max(characters.count, 1))
    let spans = (first...last).map { index -> ClosedRange<CGFloat> in
      let rect = run.characters[index].standardized
      guard !rect.isNull, rect.width >= 0 else {
        let start = box.minX + share * CGFloat(index)
        return start...(start + share)
      }
      return rect.minX...rect.maxX
    }
    return (Array(characters[first...last]), spans)
  }
}
