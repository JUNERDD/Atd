import CoreGraphics
import Foundation

/// The four corners of a text line on a photo, as fractions of the upright image's width and
/// height with the origin at the top leading corner (UIKit's orientation, not Vision's).
public struct CameraQuad: Sendable, Equatable, Hashable {
  public var topLeft: CGPoint
  public var topRight: CGPoint
  public var bottomRight: CGPoint
  public var bottomLeft: CGPoint

  public init(topLeft: CGPoint, topRight: CGPoint, bottomRight: CGPoint, bottomLeft: CGPoint) {
    self.topLeft = topLeft
    self.topRight = topRight
    self.bottomRight = bottomRight
    self.bottomLeft = bottomLeft
  }

  /// A quad from Vision's normalized corners, whose origin is the bottom leading corner.
  public init(
    visionTopLeft topLeft: CGPoint, topRight: CGPoint, bottomRight: CGPoint, bottomLeft: CGPoint
  ) {
    self.init(
      topLeft: Self.flipped(topLeft), topRight: Self.flipped(topRight),
      bottomRight: Self.flipped(bottomRight), bottomLeft: Self.flipped(bottomLeft))
  }

  /// An upright box as a quad.
  public init(_ rect: CGRect) {
    self.init(
      topLeft: CGPoint(x: rect.minX, y: rect.minY), topRight: CGPoint(x: rect.maxX, y: rect.minY),
      bottomRight: CGPoint(x: rect.maxX, y: rect.maxY),
      bottomLeft: CGPoint(x: rect.minX, y: rect.maxY))
  }

  public var corners: [CGPoint] { [topLeft, topRight, bottomRight, bottomLeft] }

  /// The smallest upright box around the corners.
  public var bounds: CGRect {
    let xs = corners.map(\.x)
    let ys = corners.map(\.y)
    let minX = xs.min() ?? 0
    let minY = ys.min() ?? 0
    return CGRect(x: minX, y: minY, width: (xs.max() ?? 0) - minX, height: (ys.max() ?? 0) - minY)
  }

  private static func flipped(_ point: CGPoint) -> CGPoint {
    CGPoint(x: point.x, y: 1 - point.y)
  }
}

/// A line of text found on a photo before it is numbered.
public struct CameraRecognizedText: Sendable, Equatable {
  public var text: String
  /// Vision's confidence, 0…1.
  public var confidence: Float
  public var quad: CameraQuad

  public init(text: String, confidence: Float, quad: CameraQuad) {
    self.text = text
    self.confidence = confidence
    self.quad = quad
  }
}

/// A line of text on a photo, numbered in reading order from 1. The numbers are how the model
/// says which lines a translation or a part of a card came from, so the camera can mark them.
public struct CameraTextLine: Sendable, Equatable, Hashable, Identifiable {
  public var id: Int
  public var text: String
  public var quad: CameraQuad

  public init(id: Int, text: String, quad: CameraQuad) {
    self.id = id
    self.text = text
    self.quad = quad
  }
}

/// Turns what Vision recognized into the numbered lines the camera sends with the photo.
public enum CameraText {
  /// At most this many lines are numbered, the rest left out (a dense page would crowd the
  /// prompt and the photo alike).
  public static let lineLimit = 120
  /// A longer line is cut to this many characters.
  public static let characterLimit = 200
  /// Lines Vision is less sure of are dropped.
  public static let minimumConfidence: Float = 0.3

  /// Numbers `recognized` in reading order: rows top to bottom, where lines that overlap
  /// vertically by at least half the shorter height share a row, then leading to trailing within
  /// a row. Unsure and blank lines are dropped; the first `lineLimit` are kept.
  public static func lines(from recognized: [CameraRecognizedText]) -> [CameraTextLine] {
    let kept = recognized.compactMap { item -> CameraRecognizedText? in
      let text = item.text.trimmingCharacters(in: .whitespacesAndNewlines)
      guard item.confidence >= minimumConfidence, !text.isEmpty else { return nil }
      var item = item
      item.text = String(text.prefix(characterLimit))
      return item
    }
    var rows: [[CameraRecognizedText]] = []
    for item in kept.sorted(by: { $0.quad.bounds.midY < $1.quad.bounds.midY }) {
      if let last = rows.indices.last, sharesRow(item, with: rows[last]) {
        rows[last].append(item)
      } else {
        rows.append([item])
      }
    }
    let ordered = rows.flatMap { row in row.sorted { $0.quad.bounds.minX < $1.quad.bounds.minX } }
    return ordered.prefix(lineLimit).enumerated().map { index, item in
      CameraTextLine(id: index + 1, text: item.text, quad: item.quad)
    }
  }

  /// The lines as the person's turn lists them for the model, one per line: `[1] 居酒屋 ひなた`.
  public static func listing(_ lines: [CameraTextLine]) -> String {
    guard !lines.isEmpty else { return CameraPrompts.string("camera.lines.none") }
    return lines.map { "[\($0.id)] \($0.text)" }.joined(separator: "\n")
  }

  /// The ids in `ids` that name one of `lineCount` lines, each once, in the order given.
  public static func valid(_ ids: [Int], lineCount: Int) -> [Int] {
    guard lineCount > 0 else { return [] }
    var seen = Set<Int>()
    return ids.filter { (1...lineCount).contains($0) && seen.insert($0).inserted }
  }

  private static func sharesRow(_ item: CameraRecognizedText, with row: [CameraRecognizedText])
    -> Bool
  {
    let box = item.quad.bounds
    let rowBox = row.dropFirst().reduce(row[0].quad.bounds) { $0.union($1.quad.bounds) }
    let overlap = min(rowBox.maxY, box.maxY) - max(rowBox.minY, box.minY)
    return overlap > 0 && overlap >= 0.5 * min(rowBox.height, box.height)
  }
}

/// The camera's prompt strings, in AtdAI's `Camera` table and in the app's language like every
/// prompt.
enum CameraPrompts {
  static func string(_ key: String.LocalizationValue) -> String {
    String(localized: key, table: "Camera", bundle: .module)
  }
}
