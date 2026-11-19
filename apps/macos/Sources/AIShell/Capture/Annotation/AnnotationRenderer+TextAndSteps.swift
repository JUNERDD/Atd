import AICore
import AppKit
import CoreText

nonisolated extension AnnotationRenderer {
  func drawText(
    _ string: String,
    frame: CGRect,
    style: AnnotationStyle,
    rgba: AnnotationRGBA,
    in context: CGContext
  ) {
    let plateMode = style.resolvedTextPlate
    Self.drawTextPlate(around: frame, style: style, in: context)

    CaptureGoogleFontLoader.shared.withPinnedFamily(style.fontFamily) {
      let font = CaptureFontCatalog.shared.font(
        family: style.fontFamily, size: style.textFontSize, weight: .semibold)
      let fgColor = Self.textCGColor(style)

      switch plateMode {
      case .none:
        context.saveGState()
        context.setShadow(
          offset: CGSize(width: 0, height: -1.5),
          blur: 3.5,
          color: CGColor(gray: 0, alpha: 0.45))
        let attrs = Self.coreTextDictionary(
          objects: [font as CTFont, fgColor],
          keys: [kCTFontAttributeName, kCTForegroundColorAttributeName])
        Self.drawCoreText(string, in: frame, attributes: attrs, context: context)
        context.restoreGState()

      case .outlined:
        let outlineColor =
          rgba.isLight ? CGColor(gray: 0, alpha: 0.85) : CGColor(gray: 1, alpha: 0.92)
        let haloAttrs = Self.coreTextDictionary(
          objects: [font as CTFont, outlineColor, NSNumber(value: 4.5)],
          keys: [kCTFontAttributeName, kCTStrokeColorAttributeName, kCTStrokeWidthAttributeName])
        let fgAttrs = Self.coreTextDictionary(
          objects: [font as CTFont, fgColor],
          keys: [kCTFontAttributeName, kCTForegroundColorAttributeName])
        Self.drawCoreText(string, in: frame, attributes: haloAttrs, context: context)
        Self.drawCoreText(string, in: frame, attributes: fgAttrs, context: context)

      case .solid, .frosted:
        let attrs = Self.coreTextDictionary(
          objects: [font as CTFont, fgColor],
          keys: [kCTFontAttributeName, kCTForegroundColorAttributeName])
        Self.drawCoreText(string, in: frame, attributes: attrs, context: context)
      }
    }
  }

  private static func drawCoreText(
    _ string: String,
    in frame: CGRect,
    attributes: CFDictionary,
    context: CGContext
  ) {
    guard !string.isEmpty,
      let attr = CFAttributedStringCreate(nil, string as CFString, attributes)
    else { return }
    let framesetter = CTFramesetterCreateWithAttributedString(attr)
    let width = max(frame.width, 1)
    let suggested = CTFramesetterSuggestFrameSizeWithConstraints(
      framesetter, CFRange(location: 0, length: 0), nil,
      CGSize(width: width, height: .greatestFiniteMagnitude), nil)
    let frameHeight = max(frame.height, ceil(suggested.height) + 100)
    let path = CGPath(rect: CGRect(x: 0, y: 0, width: width, height: frameHeight), transform: nil)
    let ctFrame = CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), path, nil)
    guard let lines = CTFrameGetLines(ctFrame) as? [CTLine], !lines.isEmpty else { return }
    var origins = Array(repeating: CGPoint.zero, count: lines.count)
    CTFrameGetLineOrigins(ctFrame, CFRange(location: 0, length: 0), &origins)
    let savedTextMatrix = context.textMatrix
    defer { context.textMatrix = savedTextMatrix }
    context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
    for (index, line) in lines.enumerated() {
      context.textPosition = CGPoint(
        x: frame.minX + origins[index].x, y: frame.minY + (frameHeight - origins[index].y))
      CTLineDraw(line, context)
    }
  }

  func drawMosaicRegion(
    _ rect: CGRect,
    style: AnnotationStyle,
    cutouts: [SpotlightCutout],
    dimAlpha: CGFloat,
    backdrop: CaptureBackdrop?,
    in context: CGContext
  ) {
    if style.redaction == .solid {
      context.setFillColor(NSColor.black.cgColor)
      context.fill(rect)
      return
    }
    // Without a backdrop (e.g. offscreen review preview) the region still reads as redacted.
    guard let backdrop,
      let (image, area) = mosaic.render(
        rect.offsetBy(dx: -backdrop.origin.x, dy: -backdrop.origin.y),
        style: style,
        backdrop: backdrop.image,
        scale: backdrop.scale,
        opaque: backdrop.isOpaque)
    else {
      context.setFillColor(NSColor.gray.cgColor)
      context.fill(rect)
      return
    }
    let placed = area.offsetBy(dx: backdrop.origin.x, dy: backdrop.origin.y)
    context.clip(to: rect)
    context.clip(to: backdrop.frames)
    context.interpolationQuality = .none
    Self.drawImage(image, in: placed, context: context)
    if !cutouts.isEmpty { Self.dim(placed, cutouts: cutouts, alpha: dimAlpha, in: context) }
  }

  func drawMosaicBrush(
    _ points: [CGPoint],
    style: AnnotationStyle,
    cutouts: [SpotlightCutout],
    dimAlpha: CGFloat,
    backdrop: CaptureBackdrop?,
    in context: CGContext
  ) {
    if style.redaction == .solid || backdrop == nil {
      context.setLineDash(phase: 0, lengths: [])
      context.setLineCap(.round)
      context.setLineJoin(.round)
      context.setLineWidth(style.stroke.highlighterWidth)
      context.setStrokeColor((style.redaction == .solid ? NSColor.black : NSColor.gray).cgColor)
      context.addPath(Self.path(AnnotationPath.smoothed(points)))
      context.strokePath()
      return
    }
    guard let backdrop,
      let (image, area, strokePath) = mosaic.renderBrushMask(
        points, style: style, backdrop: backdrop)
    else { return }
    context.addPath(strokePath)
    context.clip()
    context.clip(to: backdrop.frames)
    context.interpolationQuality = .none
    Self.drawImage(image, in: area, context: context)
    if !cutouts.isEmpty { Self.dim(area, cutouts: cutouts, alpha: dimAlpha, in: context) }
  }

  func drawStep(
    center: CGPoint,
    tip: CGPoint?,
    label: String,
    style: AnnotationStyle,
    rgba: AnnotationRGBA,
    in context: CGContext
  ) {
    let diameter = style.stroke.stepDiameter
    let badge = CGRect(
      x: center.x - diameter / 2, y: center.y - diameter / 2, width: diameter, height: diameter)
    context.setLineDash(phase: 0, lengths: [])
    if let tip {
      let width = style.stroke.stepTailWidth
      if let start = AnnotationPath.stepTailStart(center: center, tip: tip, diameter: diameter),
        let arrow = AnnotationPath.arrow(
          from: start, to: tip, lineWidth: width, headLength: style.stroke.stepTailHeadLength)
      {
        context.setLineWidth(width)
        context.strokeLineSegments(between: [start, arrow.shaftEnd])
        context.addLines(between: arrow.head)
        context.closePath()
        context.drawPath(using: .fillStroke)
      }
    }
    context.setFillColor(rgba.nsColor.cgColor)
    context.fillEllipse(in: badge)
    if rgba.isLight {
      context.setStrokeColor(NSColor.black.withAlphaComponent(0.35).cgColor)
      context.setLineWidth(1)
      context.strokeEllipse(in: badge.insetBy(dx: 0.5, dy: 0.5))
    }
    let scaleFactor = label.count > 1 ? 0.44 : 0.55
    let font = Self.monospacedDigitSystemCTFont(ofSize: diameter * scaleFactor, weight: .bold)
    let textColor = rgba.isLight ? CGColor(gray: 0, alpha: 1) : CGColor(gray: 1, alpha: 1)
    let attrs = Self.coreTextDictionary(
      objects: [font, textColor],
      keys: [kCTFontAttributeName, kCTForegroundColorAttributeName])
    guard !label.isEmpty,
      let attr = CFAttributedStringCreate(nil, label as CFString, attrs)
    else { return }
    let framesetter = CTFramesetterCreateWithAttributedString(attr)
    let size = CTFramesetterSuggestFrameSizeWithConstraints(
      framesetter, CFRange(location: 0, length: 0), nil,
      CGSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude), nil)
    let width = max(ceil(size.width) + 16, 32)
    let height = max(ceil(size.height) + 16, 32)
    let path = CGPath(rect: CGRect(x: 0, y: 0, width: width, height: height), transform: nil)
    let ctFrame = CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), path, nil)
    guard let lines = CTFrameGetLines(ctFrame) as? [CTLine], let line = lines.first else { return }
    var origin = CGPoint.zero
    CTFrameGetLineOrigins(ctFrame, CFRange(location: 0, length: 1), &origin)
    let savedTextMatrix = context.textMatrix
    defer { context.textMatrix = savedTextMatrix }
    context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
    context.textPosition = CGPoint(
      x: center.x - size.width / 2 + origin.x,
      y: center.y - size.height / 2 + (height - origin.y))
    CTLineDraw(line, context)
  }

  private static func monospacedDigitSystemCTFont(ofSize size: CGFloat, weight: NSFont.Weight)
    -> CTFont
  {
    let feature: [[CFString: Any]] = [
      [
        kCTFontFeatureTypeIdentifierKey: kNumberSpacingType,
        kCTFontFeatureSelectorIdentifierKey: kMonospacedNumbersSelector,
      ]
    ]
    let descAttrs: [CFString: Any] = [
      kCTFontTraitsAttribute: [kCTFontWeightTrait: weight.rawValue] as CFDictionary,
      kCTFontFeatureSettingsAttribute: feature as CFArray,
    ]
    let descriptor = CTFontDescriptorCreateWithAttributes(descAttrs as CFDictionary)
    if let base = CTFontCreateUIFontForLanguage(.system, size, nil) {
      return CTFontCreateCopyWithAttributes(base, size, nil, descriptor)
    }
    return NSFont.monospacedDigitSystemFont(ofSize: size, weight: weight) as CTFont
  }
}
