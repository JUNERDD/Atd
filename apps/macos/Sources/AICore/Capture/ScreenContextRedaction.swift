import Foundation

/// What a capture's mosaics hide must not reach its screen context. Text recognition reads the
/// raw selection, so it finds the text under a mosaic too, and Accessibility describes the picked
/// element without knowing about annotations; both are cut back here before the file is written.
extension ScreenContext {
  /// The areas `document`'s mosaics cover, as fractions of a selection of `size` points (origin
  /// at the top-left, y down, like a ``TextBox``'s box), cut to the selection. A mosaic counts
  /// whatever its redaction, since pixelation and blur keep only what they average. Empty for a
  /// selection without area.
  public static func redactedAreas(of document: AnnotationDocument, selection size: CGSize)
    -> [CGRect]
  {
    guard size.width > 0, size.height > 0 else { return [] }
    let selection = CGRect(origin: .zero, size: size)
    return document.annotations.compactMap { annotation in
      guard case .mosaic(let rect) = annotation.shape else { return nil }
      let covered = rect.standardized.intersection(selection)
      guard Self.hasArea(covered) else { return nil }
      return CGRect(
        x: covered.minX / size.width, y: covered.minY / size.height,
        width: covered.width / size.width, height: covered.height / size.height)
    }
  }

  /// `boxes` without every box a redacted area overlaps at all. A recognized box is often a whole
  /// line, so a line with one hidden word is left out entirely rather than shown in part.
  public static func unredacted(_ boxes: [TextBox], hiding areas: [CGRect]) -> [TextBox] {
    guard !areas.isEmpty else { return boxes }
    return boxes.filter { box in
      !areas.contains { Self.hasArea(box.box.standardized.intersection($0)) }
    }
  }

  private static func hasArea(_ rect: CGRect) -> Bool {
    !rect.isNull && rect.width > 0 && rect.height > 0
  }
}

extension ScreenContext.Element {
  /// The element's role alone. A picked element is the whole selection, so a mosaic in the
  /// selection lies on it, and its title, value or help may repeat the text the mosaic hides.
  public var withoutText: Self { Self(role: role, title: nil, value: nil, help: nil) }
}
