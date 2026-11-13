import AICore
import AppKit

/// Draws annotations with Core Graphics. The live canvas and the export both call ``draw``, so
/// what the user sees is what the image gets. The context is in the overlay's view points with
/// y down (the flipped canvas, whose bounds are view points, or the export context after
/// ``CaptureCoordinates/cropTransform(selection:scale:)``); Retina sharpness comes from the
/// context's own pixel density.
///
/// Nonisolated, so an image too large to draw on the main actor (a long screenshot's kept range
/// and its preview, ``CaptureExport/longScreenshotKept(_:kept:cover:)``) is drawn off it with a
/// renderer of its own; one instance is still used from one context at a time.
nonisolated final class AnnotationRenderer {
  private let mosaic = AnnotationMosaic()

  /// Highlighter ink: translucent and multiplied, so text under it stays readable and
  /// overlapping strokes of one path do not stack up.
  static let highlighterAlpha: CGFloat = 0.45
  /// How dark the screenshot outside the spotlights gets (E11).
  static let spotlightDim: CGFloat = 0.5

  /// The attributes text annotations draw with; the text editor types with the same ones, so
  /// committing an edit does not move or reflow the text.
  static func textAttributes(_ style: AnnotationStyle) -> [NSAttributedString.Key: Any] {
    [
      .font: NSFont.systemFont(ofSize: style.textFontSize, weight: .semibold),
      .foregroundColor: textColor(style),
    ]
  }

  /// The glyph colour: an exact ink, else the style's, or on a plate black or white for
  /// contrast, like a step badge's number (E9).
  static func textColor(_ style: AnnotationStyle) -> NSColor {
    if let ink = style.ink { return ink.nsColor }
    guard style.textBackground else { return style.color.nsColor }
    return style.color.isLight ? .black : .white
  }

  /// The size `text` takes drawn in `style` and wrapped at `width`, as ``draw`` lays it out: what
  /// a command's text in place is fitted with (``CaptureTextMarks/Measure``) and what a text box
  /// grows to when a grip narrows it.
  static func measure(_ text: String, style: AnnotationStyle, width: CGFloat) -> CGSize {
    let bounds = NSAttributedString(string: text, attributes: textAttributes(style)).boundingRect(
      with: CGSize(width: width, height: .greatestFiniteMagnitude),
      options: [.usesLineFragmentOrigin])
    return CGSize(width: ceil(bounds.width), height: ceil(bounds.height))
  }

  /// ``measure(_:style:width:)`` for a semibold system font of `fontSize`, as the
  /// ``CaptureTextMarks`` builder measures.
  static func measure(_ text: String, fontSize: CGFloat, width: CGFloat) -> CGSize {
    measure(text, style: AnnotationStyle(fontSize: fontSize), width: width)
  }

  /// `annotation` with a text box's frame as tall as its text takes at the frame's width, or
  /// taller when it already was: a resize that narrowed it keeps every line. Other annotations
  /// come back as they are.
  static func fittingTextBox(_ annotation: Annotation) -> Annotation {
    guard annotation.style.fixedWidth, case .text(let string, var frame) = annotation.shape else {
      return annotation
    }
    let needed = measure(string, style: annotation.style, width: frame.width).height
    frame.size.height = max(frame.height, needed)
    var fitted = annotation
    fitted.shape = .text(string, frame: frame)
    return fitted
  }

  /// Draws `document` back to front, skipping `hidden` (the text being edited in place).
  /// Mosaic regions sample `backdrop`, the frozen pixels under the selection.
  ///
  /// Spotlights dim the screenshot first, under every annotation, so what is drawn over the
  /// dimmed area stays legible; a mosaic replaces screenshot pixels, so its blocks are dimmed
  /// again where they lie outside the spotlights and keep reading as part of the screenshot.
  func draw(
    _ document: AnnotationDocument, hiding hidden: UUID? = nil, in context: CGContext,
    backdrop: CaptureBackdrop?
  ) {
    let spotlights = document.annotations.compactMap { annotation -> CGRect? in
      if case .spotlight(let rect) = annotation.shape { return rect }
      return nil
    }
    if !spotlights.isEmpty {
      Self.dim(context.boundingBoxOfClipPath, except: spotlights, in: context)
    }
    for annotation in document.annotations where annotation.id != hidden {
      context.saveGState()
      draw(annotation, number: document.stepNumber(of: annotation.id), in: context) { rect in
        guard
          let backdrop,
          let (image, area) = self.mosaic.render(
            rect.offsetBy(dx: -backdrop.origin.x, dy: -backdrop.origin.y), style: annotation.style,
            backdrop: backdrop.image, scale: backdrop.scale, opaque: backdrop.isOpaque)
        else { return nil }
        let placed = area.offsetBy(dx: backdrop.origin.x, dy: backdrop.origin.y)
        return (image, placed, backdrop.frames, spotlights)
      }
      context.restoreGState()
    }
  }

  /// Draws a text command's answer under review (``CaptureTextPreview``, decision D12) over the
  /// annotations as it would land, but for `hidden` (translations whose originals show): each of
  /// its annotations outlined dashed in `edge` a little clear of it, all of it at 45% while another
  /// version is being made. It is never in the document, so the export never draws it.
  func draw(
    _ preview: CaptureTextPreview, hiding hidden: Set<UUID>, edge: CGColor, in context: CGContext
  ) {
    let shown = preview.ids.filter { !hidden.contains($0) }.compactMap { preview.document[$0] }
    guard !shown.isEmpty else { return }
    context.saveGState()
    if preview.pending {
      // One layer, so a plate and its text fade together rather than through each other.
      context.setAlpha(0.45)
      context.beginTransparencyLayer(auxiliaryInfo: nil)
    }
    for annotation in shown {
      context.saveGState()
      draw(annotation, number: preview.document.stepNumber(of: annotation.id), in: context) { _ in
        nil
      }
      context.restoreGState()
    }
    context.setStrokeColor(edge)
    context.setLineWidth(1.5)
    context.setLineDash(phase: 0, lengths: [4, 3])
    for annotation in shown { context.addPath(Self.previewOutline(of: annotation)) }
    context.strokePath()
    if preview.pending { context.endTransparencyLayer() }
    context.restoreGState()
  }

  /// The dashed outline around an annotation a review previews: its text plate, its step badge's
  /// circle, or a mark's bounds, 1.75 points out.
  private static func previewOutline(of annotation: Annotation) -> CGPath {
    let gap: CGFloat = 1.75
    switch annotation.shape {
    case .step(let center, _):
      let radius = annotation.style.stroke.stepDiameter / 2 + gap
      return CGPath(
        ellipseIn: CGRect(
          x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2),
        transform: nil)
    case .text where annotation.style.hasTextPlate:
      let box = annotation.bounds.insetBy(dx: -gap, dy: -gap)
      let radius = AnnotationPath.textPlateRadius(fontSize: annotation.style.textFontSize) + gap
      return rounded(box, radius: radius)
    default:
      return rounded(annotation.bounds.insetBy(dx: -gap, dy: -gap), radius: 3)
    }
  }

  /// A rounded rectangle whose corners never pass half a side, which `CGPath` would not draw.
  private static func rounded(_ rect: CGRect, radius: CGFloat) -> CGPath {
    let corner = max(min(radius, rect.width / 2, rect.height / 2), 0)
    return CGPath(roundedRect: rect, cornerWidth: corner, cornerHeight: corner, transform: nil)
  }

  /// Draws text's rounded plate around `frame` in the style's colour (E9), or its exact plate
  /// colour, with the step badge's hairline edge on light swatches so a white plate still shows
  /// on white. An exact plate matches what it covers, so it has no edge.
  static func drawTextPlate(around frame: CGRect, style: AnnotationStyle, in context: CGContext) {
    let fontSize = style.textFontSize
    let plate = AnnotationPath.textPlate(around: frame, fontSize: fontSize)
    let radius = AnnotationPath.textPlateRadius(fontSize: fontSize)
    let path = CGPath(roundedRect: plate, cornerWidth: radius, cornerHeight: radius, transform: nil)
    context.saveGState()
    context.setFillColor((style.plate?.nsColor ?? style.color.nsColor).cgColor)
    context.addPath(path)
    context.fillPath()
    if style.plate == nil, style.color.isLight {
      context.setStrokeColor(NSColor.black.withAlphaComponent(0.35).cgColor)
      context.setLineWidth(1)
      let edge = plate.insetBy(dx: 0.5, dy: 0.5)
      context.addPath(
        CGPath(roundedRect: edge, cornerWidth: radius, cornerHeight: radius, transform: nil))
      context.strokePath()
    }
    context.restoreGState()
  }

  /// Darkens `area` except inside `spotlights`. The cut-outs are cleared from a transparency
  /// layer rather than clipped with even-odd, so overlapping spotlights stay bright where they
  /// overlap: the bright part is their union.
  private static func dim(_ area: CGRect, except spotlights: [CGRect], in context: CGContext) {
    context.saveGState()
    context.clip(to: area)
    context.beginTransparencyLayer(auxiliaryInfo: nil)
    context.setFillColor(NSColor.black.withAlphaComponent(spotlightDim).cgColor)
    context.fill(area)
    context.setBlendMode(.clear)
    for spotlight in spotlights { context.fill(spotlight) }
    context.endTransparencyLayer()
    context.restoreGState()
  }

  /// `pixelate` answers a mosaic's blocks or blur, the area they cover, the displays they may
  /// paint (``CaptureBackdrop/frames``) and the spotlights to keep bright over them.
  private func draw(
    _ annotation: Annotation, number: Int?, in context: CGContext,
    pixelate: (CGRect) -> (CGImage, CGRect, [CGRect], [CGRect])?
  ) {
    let color = annotation.style.color.nsColor.cgColor
    context.setStrokeColor(color)
    context.setFillColor(color)
    context.setLineWidth(annotation.paintedWidth)
    context.setLineCap(.round)
    context.setLineJoin(.round)
    switch annotation.shape {
    case .rectangle(let rect):
      context.stroke(rect)
    case .ellipse(let rect):
      context.strokeEllipse(in: rect)
    case .line(let from, let to):
      context.strokeLineSegments(between: [from, to])
    case .arrow(let from, let to):
      guard let arrow = AnnotationPath.arrow(from: from, to: to, lineWidth: annotation.paintedWidth)
      else { return }
      context.strokeLineSegments(between: [from, arrow.shaftEnd])
      context.addLines(between: arrow.head)
      context.closePath()
      context.drawPath(using: .fillStroke)
    case .pen(let points):
      context.addPath(Self.path(AnnotationPath.smoothed(points)))
      context.strokePath()
    case .highlighter(let points):
      context.setBlendMode(.multiply)
      context.setLineCap(.butt)
      context.setStrokeColor(
        annotation.style.color.nsColor.withAlphaComponent(Self.highlighterAlpha).cgColor)
      context.addPath(Self.path(AnnotationPath.smoothed(points)))
      context.strokePath()
    case .text(let string, let frame):
      if annotation.style.hasTextPlate {
        Self.drawTextPlate(around: frame, style: annotation.style, in: context)
      }
      Self.withAppKit(context) {
        NSAttributedString(string: string, attributes: Self.textAttributes(annotation.style))
          .draw(with: frame, options: [.usesLineFragmentOrigin])
      }
    case .mosaic(let rect) where annotation.style.redaction == .solid:
      context.setFillColor(NSColor.black.cgColor)
      context.fill(rect)
    case .mosaic(let rect):
      // Without a backdrop (never in practice) the region still reads as redacted.
      guard let (image, area, frames, spotlights) = pixelate(rect)
      else {
        context.setFillColor(NSColor.gray.cgColor)
        context.fill(rect)
        return
      }
      // The image covers whole blocks around the region; only the region shows, and none of it
      // in a gap between displays, which the export keeps transparent.
      context.clip(to: rect)
      context.clip(to: frames)
      context.interpolationQuality = .none
      Self.drawImage(image, in: area, context: context)
      if !spotlights.isEmpty { Self.dim(area, except: spotlights, in: context) }
    case .step(let center, let tip):
      drawStep(center: center, tip: tip, number: number ?? 0, style: annotation.style, in: context)
    case .spotlight:
      // Drawn as the dimming around it, before every annotation.
      break
    }
  }

  private func drawStep(
    center: CGPoint, tip: CGPoint?, number: Int, style: AnnotationStyle, in context: CGContext
  ) {
    let diameter = style.stroke.stepDiameter
    let badge = CGRect(
      x: center.x - diameter / 2, y: center.y - diameter / 2, width: diameter, height: diameter)
    if let tip { drawStepTail(from: center, to: tip, style: style, in: context) }
    context.fillEllipse(in: badge)
    if style.color.isLight {
      context.setStrokeColor(NSColor.black.withAlphaComponent(0.35).cgColor)
      context.setLineWidth(1)
      context.strokeEllipse(in: badge.insetBy(dx: 0.5, dy: 0.5))
    }
    let label = NSAttributedString(
      string: String(number),
      attributes: [
        .font: NSFont.monospacedDigitSystemFont(ofSize: diameter * 0.55, weight: .bold),
        .foregroundColor: style.color.isLight ? NSColor.black : NSColor.white,
      ])
    let size = label.size()
    Self.withAppKit(context) {
      label.draw(at: CGPoint(x: center.x - size.width / 2, y: center.y - size.height / 2))
    }
  }

  /// The tail of a step badge: a shaft from the badge's edge to a small arrowhead at `tip`, in
  /// the badge's colour, drawn under the badge. Nothing when the tip is not clear of the badge.
  private func drawStepTail(
    from center: CGPoint, to tip: CGPoint, style: AnnotationStyle, in context: CGContext
  ) {
    let width = style.stroke.stepTailWidth
    guard
      let start = AnnotationPath.stepTailStart(
        center: center, tip: tip, diameter: style.stroke.stepDiameter),
      let arrow = AnnotationPath.arrow(
        from: start, to: tip, lineWidth: width, headLength: style.stroke.stepTailHeadLength)
    else { return }
    context.setLineWidth(width)
    context.strokeLineSegments(between: [start, arrow.shaftEnd])
    context.addLines(between: arrow.head)
    context.closePath()
    context.drawPath(using: .fillStroke)
  }

  /// Text drawing goes through AppKit, which needs a current graphics context that knows the
  /// CTM is flipped, or glyphs come out upside down.
  private static func withAppKit(_ context: CGContext, _ body: () -> Void) {
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)
    body()
    NSGraphicsContext.restoreGraphicsState()
  }

  /// `CGContext.draw` puts an image's first row at the bottom of `rect`; in a y-down context
  /// that is upside down, so the image is drawn through a local flip.
  static func drawImage(_ image: CGImage, in rect: CGRect, context: CGContext) {
    context.saveGState()
    context.translateBy(x: rect.minX, y: rect.maxY)
    context.scaleBy(x: 1, y: -1)
    context.draw(image, in: CGRect(origin: .zero, size: rect.size))
    context.restoreGState()
  }

  static func path(_ segments: [AnnotationPath.Segment]) -> CGPath {
    let path = CGMutablePath()
    for segment in segments {
      switch segment {
      case .move(let point): path.move(to: point)
      case .line(let point): path.addLine(to: point)
      case .quad(let point, let control): path.addQuadCurve(to: point, control: control)
      }
    }
    return path
  }
}
