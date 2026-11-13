import CoreGraphics
import Foundation

extension AnnotationDocument {
  /// How far an auto-redact mosaic reaches past the sensitive text it covers, on every side.
  public static let redactionMargin: CGFloat = 3

  /// The document with a mosaic in `style` over each of `items`, ``redactionMargin`` points past
  /// it and on whole points, in front of everything else: what Cover sensitive items adds (the
  /// mosaic tool's style bar and its shortcuts in the capture editor and the long screenshot's
  /// full-screen preview), committed by the caller as one undo step. The mosaics are ordinary
  /// annotations: they move, resize, restyle and delete like any other.
  public func redacting(_ items: [SensitiveText.Box], style: AnnotationStyle) -> AnnotationDocument
  {
    var next = self
    for item in items {
      let area = item.box.insetBy(dx: -Self.redactionMargin, dy: -Self.redactionMargin).integral
      next.add(Annotation(shape: .mosaic(area), style: style))
    }
    return next
  }
}
