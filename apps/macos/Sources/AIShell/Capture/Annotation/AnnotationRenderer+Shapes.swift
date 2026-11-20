import AICore
import AppKit

nonisolated extension AnnotationStyle {
  var nsColor: NSColor { effectiveRGBA.nsColor }
}

nonisolated extension AnnotationRenderer {
  struct SpotlightCutout {
    let rect: CGRect
    let shape: AnnotationSpotlightShape
    let cornerRadius: CGFloat
  }

  /// Text drawing goes through AppKit, which needs a current graphics context that knows the
  /// CTM is flipped, or glyphs come out upside down.
  static func withAppKit(_ context: CGContext, _ body: () -> Void) {
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

  func spotlightCutouts(in document: AnnotationDocument) -> [SpotlightCutout] {
    document.annotations.compactMap { annotation in
      guard case .spotlight(let rect) = annotation.shape else { return nil }
      return SpotlightCutout(
        rect: rect,
        shape: annotation.style.spotlightShape,
        cornerRadius: annotation.style.cornerRadius(for: rect))
    }
  }

  /// Darkens `area` except inside `cutouts`. Cut-outs are cleared from a transparency layer
  /// rather than even-odd clipped, so overlapping spotlights combine into their union.
  static func dim(
    _ area: CGRect,
    cutouts: [SpotlightCutout],
    alpha: CGFloat,
    in context: CGContext
  ) {
    guard !cutouts.isEmpty else { return }
    context.saveGState()
    context.clip(to: area)
    context.beginTransparencyLayer(auxiliaryInfo: nil)
    context.setFillColor(NSColor.black.withAlphaComponent(alpha).cgColor)
    context.fill(area)
    context.setBlendMode(.clear)
    for c in cutouts {
      switch c.shape {
      case .ellipse: context.fillEllipse(in: c.rect)
      case .sharp:
        if c.cornerRadius > 0 {
          context.addPath(rounded(c.rect, radius: c.cornerRadius))
          context.fillPath()
        } else {
          context.fill(c.rect)
        }
      }
    }
    context.endTransparencyLayer()
    context.restoreGState()
  }

  static func drawSpotlightRims(_ cutouts: [SpotlightCutout], in context: CGContext) {
    context.saveGState()
    context.setStrokeColor(NSColor.white.withAlphaComponent(0.28).cgColor)
    context.setLineWidth(1)
    for c in cutouts {
      let inset = c.rect.insetBy(dx: 0.5, dy: 0.5)
      switch c.shape {
      case .ellipse: context.strokeEllipse(in: inset)
      case .sharp:
        if c.cornerRadius > 0 {
          context.addPath(rounded(inset, radius: max(0, c.cornerRadius - 0.5)))
          context.strokePath()
        } else {
          context.stroke(inset)
        }
      }
    }
    context.restoreGState()
  }

  func drawShape(
    _ annotation: Annotation,
    label: String?,
    cutouts: [SpotlightCutout],
    dimAlpha: CGFloat,
    backdrop: CaptureBackdrop?,
    in context: CGContext
  ) {
    let style = annotation.style
    let baseRGBA = style.effectiveRGBA
    let color = baseRGBA.nsColor
    let lw = annotation.paintedWidth
    context.setStrokeColor(color.cgColor)
    context.setFillColor(color.cgColor)
    context.setLineWidth(lw)
    context.setLineCap(.round)
    context.setLineJoin(.round)
    if style.isDashed {
      context.setLineDash(phase: 0, lengths: [max(6, lw * 2.4), max(4, lw * 1.8)])
    }

    switch annotation.shape {
    case .rectangle(let rect):
      let r = style.cornerRadius(for: rect)
      let p = r > 0 ? Self.rounded(rect, radius: r) : CGPath(rect: rect, transform: nil)
      drawBox(path: p, fillMode: style.fillMode, color: color, in: context)

    case .ellipse(let rect):
      let p = CGPath(ellipseIn: rect, transform: nil)
      drawBox(path: p, fillMode: style.fillMode, color: color, in: context)

    case .line(let from, let to, let bend):
      drawCurveOrSegment(from: from, to: to, bend: bend, in: context)

    case .arrow(let from, let to, let bend):
      drawStyledArrow(
        from: from, to: to, bend: bend, arrowStyle: style.arrowStyle, lineWidth: lw, color: color,
        in: context)

    case .pen(let points):
      context.addPath(Self.path(AnnotationPath.smoothed(points)))
      context.strokePath()

    case .highlighter(let points):
      context.setLineDash(phase: 0, lengths: [])
      context.setBlendMode(.multiply)
      context.beginTransparencyLayer(auxiliaryInfo: nil)
      context.setBlendMode(.normal)
      context.setLineCap(.butt)
      context.setStrokeColor(color.withAlphaComponent(Self.highlighterAlpha).cgColor)
      context.addPath(Self.path(AnnotationPath.smoothed(points)))
      context.strokePath()
      context.endTransparencyLayer()

    case .text(let string, let frame):
      drawText(string, frame: frame, style: style, rgba: baseRGBA, in: context)

    case .mosaic(let rect):
      drawMosaicRegion(
        rect, style: style, cutouts: cutouts, dimAlpha: dimAlpha, backdrop: backdrop, in: context)

    case .mosaicBrush(let points):
      drawMosaicBrush(
        points, style: style, cutouts: cutouts, dimAlpha: dimAlpha, backdrop: backdrop, in: context)

    case .step(let center, let tip):
      drawStep(
        center: center, tip: tip, label: label ?? "1", style: style, rgba: baseRGBA, in: context)

    case .spotlight:
      // Drawn as the dimming around it before every annotation.
      break
    }
  }

  private func drawBox(
    path: CGPath, fillMode: AnnotationFillMode, color: NSColor, in context: CGContext
  ) {
    switch fillMode {
    case .outline:
      context.addPath(path)
      context.strokePath()
    case .soft:
      context.saveGState()
      context.setFillColor(color.withAlphaComponent(0.16).cgColor)
      context.addPath(path)
      context.fillPath()
      context.restoreGState()
      context.addPath(path)
      context.strokePath()
    case .solid:
      context.setFillColor(color.cgColor)
      context.addPath(path)
      context.fillPath()
    }
  }

  private func drawCurveOrSegment(from: CGPoint, to: CGPoint, bend: CGPoint?, in context: CGContext)
  {
    if let bend {
      context.move(to: from)
      context.addQuadCurve(to: to, control: bend)
      context.strokePath()
    } else {
      context.strokeLineSegments(between: [from, to])
    }
  }

  private func drawStyledArrow(
    from: CGPoint,
    to: CGPoint,
    bend: CGPoint?,
    arrowStyle: AnnotationArrowStyle,
    lineWidth: CGFloat,
    color: NSColor,
    in context: CGContext
  ) {
    let headLen = AnnotationPath.arrowHeadLength(lineWidth: lineWidth)
    let tanEnd =
      bend.map { AnnotationMath.quadTangent(from: from, control: $0, to: to, t: 1) }
      ?? CGVector(dx: to.x - from.x, dy: to.y - from.y)
    let tanStart =
      bend.map { AnnotationMath.quadTangent(from: from, control: $0, to: to, t: 0) }
      ?? tanEnd
    let lenEnd = hypot(tanEnd.dx, tanEnd.dy)
    let lenStart = hypot(tanStart.dx, tanStart.dy)
    guard lenEnd > 0.5, lenStart > 0.5 else { return }
    let endTrimFrom = CGPoint(
      x: to.x - tanEnd.dx / lenEnd * max(headLen, 1), y: to.y - tanEnd.dy / lenEnd * max(headLen, 1)
    )
    let startTrimTo = CGPoint(
      x: from.x + tanStart.dx / lenStart * max(headLen, 1),
      y: from.y + tanStart.dy / lenStart * max(headLen, 1))

    guard let endArrow = AnnotationPath.arrow(from: endTrimFrom, to: to, lineWidth: lineWidth)
    else { return }
    let doubleStartArrow =
      arrowStyle == .doubleHeaded
      ? AnnotationPath.arrow(from: startTrimTo, to: from, lineWidth: lineWidth) : nil

    let shaftStart = doubleStartArrow?.shaftEnd ?? from
    let shaftEnd = arrowStyle == .classic ? to : endArrow.shaftEnd
    drawCurveOrSegment(from: shaftStart, to: shaftEnd, bend: bend, in: context)

    context.setLineDash(phase: 0, lengths: [])
    context.setFillColor(color.cgColor)
    if arrowStyle == .classic {
      context.strokeLineSegments(between: [
        endArrow.head[1], endArrow.head[0], endArrow.head[2], endArrow.head[0],
      ])
    } else {
      context.addLines(between: endArrow.head)
      context.closePath()
      context.drawPath(using: .fillStroke)
      if let startArrow = doubleStartArrow {
        context.addLines(between: startArrow.head)
        context.closePath()
        context.drawPath(using: .fillStroke)
      }
    }
  }
}
