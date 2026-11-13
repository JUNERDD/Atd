import CoreGraphics
import Foundation

// MARK: Visual coordinates and mosaic redactions

extension CaptureTextMarks {
  ///Normalized coordinate ceiling used by visual markup items (`0...1_000`).
  private static let coordinateScale: CGFloat = 1_000

  /// Mosaic annotations in `style` covering `phrase` in `paragraph` (or the whole paragraph when
  /// `phrase` is nil or absent), grown by ``AnnotationDocument/redactionMargin`` on whole points
  /// like auto-redact so no glyph edge shows.
  public static func mosaics(
    _ phrase: String?, in paragraph: CaptureTextParagraph, style: AnnotationStyle
  ) -> [Annotation] {
    let span = phrase.flatMap { Self.span(of: $0, in: paragraph.text) } ?? 0..<paragraph.text.count
    let margin = AnnotationDocument.redactionMargin
    return paragraph.lines.compactMap { line in
      let start = max(span.lowerBound, line.range.lowerBound)
      let end = min(span.upperBound, line.range.upperBound)
      guard start < end, !line.range.isEmpty else { return nil }
      let share = line.box.width / CGFloat(line.range.count)
      let from =
        start == line.range.lowerBound
        ? line.box.minX : line.box.minX + CGFloat(start - line.range.lowerBound) * share
      let to =
        end == line.range.upperBound
        ? line.box.maxX : line.box.minX + CGFloat(end - line.range.lowerBound) * share
      let box = CGRect(x: from, y: line.box.minY, width: max(to - from, 1), height: line.box.height)
      let area = box.insetBy(dx: -margin, dy: -margin).integral
      return Annotation(shape: .mosaic(area), style: style)
    }
  }

  /// Native annotations drawn from normalized `0...1_000` visual coordinates inside
  /// `context.bounds`, using the editor's remembered shared style.
  public static func visualAnnotations(
    for item: CaptureTextRun.Item, context: Context
  ) -> [Annotation] {
    let area = context.bounds.standardized
    let minExtent = AnnotationPath.minimumExtent
    guard area.width >= minExtent, area.height >= minExtent else { return [] }
    var style = context.stepStyle
    style.stroke = AnnotationStroke(min(style.stroke.value, AnnotationStroke.default.value))

    func mapPoint(_ x: Int, _ y: Int) -> CGPoint {
      let nx = CGFloat(min(max(x, 0), 1_000)) / coordinateScale
      let ny = CGFloat(min(max(y, 0), 1_000)) / coordinateScale
      return CGPoint(x: area.minX + nx * area.width, y: area.minY + ny * area.height)
    }

    func mapRect(_ coords: CaptureTextRun.Item.Coords) -> CGRect {
      let first = mapPoint(coords.x1, coords.y1)
      let second = mapPoint(coords.x2, coords.y2)
      var rect = CGRect(
        x: min(first.x, second.x), y: min(first.y, second.y),
        width: abs(second.x - first.x), height: abs(second.y - first.y))
      if rect.width < minExtent {
        rect.origin.x = min(max(rect.midX - minExtent / 2, area.minX), area.maxX - minExtent)
        rect.size.width = minExtent
      }
      if rect.height < minExtent {
        rect.origin.y = min(max(rect.midY - minExtent / 2, area.minY), area.maxY - minExtent)
        rect.size.height = minExtent
      }
      return rect
    }

    func clampedStepCenter(_ raw: CGPoint) -> CGPoint {
      let radius = style.stroke.stepDiameter / 2
      guard area.width > radius * 2, area.height > radius * 2 else {
        return CGPoint(x: area.midX, y: area.midY)
      }
      let inside = area.insetBy(dx: radius, dy: radius)
      return CGPoint(
        x: min(max(raw.x, inside.minX), inside.maxX),
        y: min(max(raw.y, inside.minY), inside.maxY))
    }

    switch item.tool {
    case .box:
      guard let coords = item.coords else { return [] }
      return [Annotation(shape: .rectangle(mapRect(coords)), style: style)]
    case .ellipse:
      guard let coords = item.coords else { return [] }
      return [Annotation(shape: .ellipse(mapRect(coords)), style: style)]
    case .spotlight:
      guard let coords = item.coords else { return [] }
      return [Annotation(shape: .spotlight(mapRect(coords)), style: style)]
    case .mosaic:
      guard let coords = item.coords else { return [] }
      var rect = mapRect(coords).integral
      if rect.width < minExtent { rect.size.width = minExtent }
      if rect.height < minExtent { rect.size.height = minExtent }
      return [Annotation(shape: .mosaic(rect), style: style)]
    case .arrow:
      guard let coords = item.coords else { return [] }
      var tail = mapPoint(coords.x1, coords.y1)
      let tip = mapPoint(coords.x2, coords.y2)
      let length = AnnotationMath.distance(tail, tip)
      if length < minExtent {
        if length > 0 {
          let ux = (tail.x - tip.x) / length
          let uy = (tail.y - tip.y) / length
          tail = CGPoint(x: tip.x + ux * minExtent, y: tip.y + uy * minExtent)
        } else {
          let dx: CGFloat = tip.x - minExtent >= area.minX ? -minExtent : minExtent
          tail = CGPoint(x: tip.x + dx, y: tip.y)
        }
      }
      return [Annotation(shape: .arrow(from: tail, to: tip), style: style)]
    case .step:
      if let coords = item.coords {
        let center = clampedStepCenter(mapPoint(coords.x1, coords.y1))
        let rawTip = mapPoint(coords.x2, coords.y2)
        let tip =
          AnnotationPath.stepTailStart(
            center: center, tip: rawTip, diameter: style.stroke.stepDiameter) != nil
          ? rawTip : nil
        return [Annotation(shape: .step(center: center, tip: tip), style: style)]
      }
      guard let point = item.point else { return [] }
      return [
        Annotation(
          shape: .step(center: clampedStepCenter(mapPoint(point.x, point.y))), style: style)
      ]
    case .replace, .highlight:
      return []
    }
  }
}
