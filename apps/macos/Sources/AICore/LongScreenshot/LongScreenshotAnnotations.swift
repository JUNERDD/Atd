import CoreGraphics
import Foundation

// What a long screenshot's annotations (``LongScreenshotKept/annotations``, added in the card's
// lightbox or by its Cover Sensitive Info) mean for what its card sends: the image carries them,
// the text their mosaics hide stays out of what goes with it, and an ask about other annotations
// is another ask.

extension LongScreenshotKept {
  /// The areas the annotations' mosaics hide, in image points: every mosaic whatever its
  /// redaction, since pixelation and blur keep only what they average, as a screenshot's context
  /// counts them (``ScreenContext/redactedAreas(of:selection:)``). Without area, a mosaic hides
  /// nothing. A recognized line or paragraph any of them touches is left out of what is sent as
  /// text, picked or copied (decision D6), so what the image hides is not sent beside it in words.
  public var redactedAreas: [CGRect] {
    annotations.annotations.compactMap { annotation in
      guard case .mosaic(let rect) = annotation.shape else { return nil }
      let area = rect.standardized
      return area.width > 0 && area.height > 0 ? area : nil
    }
  }

  /// A mosaic shows in the range: the screen around the image (its app and window) may repeat
  /// what it hides, as a screenshot's context assumes (``ScreenContext``).
  public var redacts: Bool { redactedAreas.contains { touches($0) } }
}

extension AnnotationDocument {
  /// The document as integers, exactly: two documents that draw the same image have the same
  /// key, and any difference in a shape, its geometry, its text, its style or the order makes
  /// another one. Ids are left out, so an annotation drawn again just as it was draws the same
  /// key. Each annotation is written as its shape's tag and fields, a list after its count, then
  /// its style, so the concatenation reads back one way only.
  var askKey: [Int] { annotations.flatMap(\.askKey) }
}

extension Annotation {
  fileprivate var askKey: [Int] {
    let shape: [Int] =
      switch self.shape {
      case .rectangle(let rect): [0] + rect.askKey
      case .ellipse(let rect): [1] + rect.askKey
      case .arrow(let from, let to): [2] + from.askKey + to.askKey
      case .line(let from, let to): [3] + from.askKey + to.askKey
      case .pen(let points): [4, points.count] + points.flatMap(\.askKey)
      case .highlighter(let points): [5, points.count] + points.flatMap(\.askKey)
      case .text(let string, let frame):
        [6, string.unicodeScalars.count] + string.unicodeScalars.map { Int($0.value) }
          + frame.askKey
      case .mosaic(let rect): [7] + rect.askKey
      case .step(let center, let tip): [8] + center.askKey + (tip.map { [1] + $0.askKey } ?? [0])
      case .spotlight(let rect): [9] + rect.askKey
      }
    let base: [Int] = [
      AnnotationColor.allCases.firstIndex(of: style.color) ?? 0, Self.bits(style.stroke.value),
      style.textBackground ? 1 : 0,
      AnnotationRedaction.allCases.firstIndex(of: style.redaction) ?? 0,
    ]
    let size: [Int] = style.fontSize.map { [1, Self.bits(Double($0))] } ?? [0]
    let text: [Int] = Self.askKey(style.plate) + Self.askKey(style.ink) + size
    return shape + base + text + [style.fixedWidth ? 1 : 0]
  }

  /// An exact colour as its four components' bits after a tag, or the tag alone without one.
  fileprivate static func askKey(_ color: AnnotationRGBA?) -> [Int] {
    guard let color else { return [0] }
    return [1, bits(color.red), bits(color.green), bits(color.blue), bits(color.alpha)]
  }

  /// A value's bits, with both zeros as one.
  fileprivate static func bits(_ value: Double) -> Int {
    value == 0 ? 0 : Int(truncatingIfNeeded: value.bitPattern)
  }
}

extension CGPoint {
  fileprivate var askKey: [Int] { [Annotation.bits(Double(x)), Annotation.bits(Double(y))] }
}

extension CGRect {
  fileprivate var askKey: [Int] {
    origin.askKey + [size.width, size.height].map(Double.init).map(Annotation.bits)
  }
}
