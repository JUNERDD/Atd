import AICore
import AppKit
import CoreText

nonisolated extension AnnotationRGBA {
  var srgbCGColor: CGColor {
    CGColor(srgbRed: red, green: green, blue: blue, alpha: alpha)
  }
}

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
  let mosaic = AnnotationMosaic()

  /// Highlighter ink: translucent and multiplied, so text under it stays readable and
  /// overlapping strokes of one path do not stack up.
  static let highlighterAlpha: CGFloat = 0.45
  /// Default dim opacity when no document override is specified.
  static let spotlightDim: CGFloat = 0.5

  /// The attributes text annotations draw with; the text editor types with the same ones, so
  /// committing an edit does not move or reflow the text.
  @MainActor
  static func textAttributes(_ style: AnnotationStyle) -> [NSAttributedString.Key: Any] {
    var attrs: [NSAttributedString.Key: Any] = [
      .font: CaptureFontCatalog.shared.font(
        family: style.fontFamily, size: style.textFontSize, weight: .semibold),
      .foregroundColor: textColor(style),
    ]
    if style.resolvedTextPlate == .outlined {
      let rgba = style.effectiveRGBA
      attrs[.strokeColor] =
        rgba.isLight
        ? NSColor.black.withAlphaComponent(0.85)
        : NSColor.white.withAlphaComponent(0.92)
      attrs[.strokeWidth] = -4.2
    }
    return attrs
  }

  /// The glyph colour: an exact ink, else the style's, or on a solid plate black or white for
  /// contrast, like a step badge's number (E9).
  static func textColor(_ style: AnnotationStyle) -> NSColor {
    if let ink = style.ink { return ink.nsColor }
    let rgba = style.effectiveRGBA
    switch style.resolvedTextPlate {
    case .solid:
      let fill = style.plate ?? rgba
      return fill.isLight ? .black : .white
    case .none, .frosted, .outlined:
      return rgba.nsColor
    }
  }

  /// Thread-safe CGColor equivalent of ``textColor(_:)`` for off-main CoreText rendering.
  static func textCGColor(_ style: AnnotationStyle) -> CGColor {
    if let ink = style.ink { return ink.srgbCGColor }
    let rgba = style.effectiveRGBA
    switch style.resolvedTextPlate {
    case .solid:
      let fill = style.plate ?? rgba
      return fill.isLight ? CGColor(gray: 0, alpha: 1) : CGColor(gray: 1, alpha: 1)
    case .none, .frosted, .outlined:
      return rgba.srgbCGColor
    }
  }

  /// Builds an immutable CoreText attribute dictionary without hitting UIFoundation's global
  /// `NSAttributeDictionary` cache.
  static func coreTextDictionary(objects: [Any], keys: [CFString]) -> CFDictionary {
    precondition(objects.count == keys.count)
    return NSDictionary(objects: objects, forKeys: keys.map { $0 as NSString }) as CFDictionary
  }

  /// The size `text` takes drawn in `style` and wrapped at `width`, as ``draw`` lays it out: what
  /// a command's text in place is fitted with (``CaptureTextMarks/Measure``) and what a text box
  /// grows to when a grip narrows it.
  static func measure(_ text: String, style: AnnotationStyle, width: CGFloat) -> CGSize {
    CaptureGoogleFontLoader.shared.withPinnedFamily(style.fontFamily) {
      let font = CaptureFontCatalog.shared.font(
        family: style.fontFamily, size: style.textFontSize, weight: .semibold)
      var keys: [CFString] = [kCTFontAttributeName, kCTForegroundColorAttributeName]
      var objects: [Any] = [font as CTFont, textCGColor(style)]
      if style.resolvedTextPlate == .outlined {
        let rgba = style.effectiveRGBA
        let strokeColor =
          rgba.isLight ? CGColor(gray: 0, alpha: 0.85) : CGColor(gray: 1, alpha: 0.92)
        keys.append(contentsOf: [kCTStrokeColorAttributeName, kCTStrokeWidthAttributeName])
        objects.append(contentsOf: [strokeColor, NSNumber(value: -4.2)])
      }
      let attrs = coreTextDictionary(objects: objects, keys: keys)
      let probe =
        (text.isEmpty || text.hasSuffix("\n") || text.hasSuffix("\r")) ? text + "\u{200B}" : text
      guard let attr = CFAttributedStringCreate(nil, probe as CFString, attrs) else { return .zero }
      let framesetter = CTFramesetterCreateWithAttributedString(attr)
      let size = CTFramesetterSuggestFrameSizeWithConstraints(
        framesetter, CFRange(location: 0, length: 0), nil,
        CGSize(width: max(width, 1), height: .greatestFiniteMagnitude), nil)
      return CGSize(width: ceil(size.width), height: ceil(size.height))
    }
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
    let cutouts = spotlightCutouts(in: document)
    let dimAlpha = document.spotlightDim
    if !cutouts.isEmpty {
      Self.dim(context.boundingBoxOfClipPath, cutouts: cutouts, alpha: dimAlpha, in: context)
      Self.drawSpotlightRims(cutouts, in: context)
    }
    let clipBox = context.boundingBoxOfClipPath
    let hasClip = !clipBox.isNull && !clipBox.isInfinite
    let families = Set(document.annotations.compactMap(\.style.fontFamily))
    CaptureGoogleFontLoader.shared.withPinnedFamilies(families) {
      for annotation in document.annotations where annotation.id != hidden {
        if hasClip, !annotation.bounds.insetBy(dx: -20, dy: -20).intersects(clipBox) {
          continue
        }
        context.saveGState()
        drawShape(
          annotation,
          label: document.stepLabel(of: annotation.id),
          cutouts: cutouts,
          dimAlpha: dimAlpha,
          backdrop: backdrop,
          in: context)
        context.restoreGState()
      }
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
    let families = Set(shown.compactMap(\.style.fontFamily))
    CaptureGoogleFontLoader.shared.withPinnedFamilies(families) {
      for annotation in shown {
        context.saveGState()
        drawShape(
          annotation,
          label: preview.document.stepLabel(of: annotation.id),
          cutouts: [],
          dimAlpha: preview.document.spotlightDim,
          backdrop: nil,
          in: context)
        context.restoreGState()
      }
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
  static func rounded(_ rect: CGRect, radius: CGFloat) -> CGPath {
    let corner = max(min(radius, rect.width / 2, rect.height / 2), 0)
    return CGPath(roundedRect: rect, cornerWidth: corner, cornerHeight: corner, transform: nil)
  }

  /// Draws text's plate (solid pill or translucent scrim) around `frame`.
  static func drawTextPlate(around frame: CGRect, style: AnnotationStyle, in context: CGContext) {
    let plateMode = style.resolvedTextPlate
    let rgba = style.effectiveRGBA
    let plateRect = AnnotationPath.textPlate(around: frame, fontSize: style.textFontSize)
    let radius = AnnotationPath.textPlateRadius(fontSize: style.textFontSize)

    switch plateMode {
    case .none, .outlined:
      break
    case .solid:
      let fillRGBA = style.plate ?? rgba
      context.saveGState()
      context.setFillColor(fillRGBA.nsColor.cgColor)
      context.addPath(rounded(plateRect, radius: radius))
      context.fillPath()
      if style.plate == nil, fillRGBA.isLight {
        context.setStrokeColor(NSColor.black.withAlphaComponent(0.35).cgColor)
        context.setLineWidth(1)
        context.addPath(rounded(plateRect.insetBy(dx: 0.5, dy: 0.5), radius: radius))
        context.strokePath()
      }
      context.restoreGState()
    case .frosted:
      let useDarkScrim = rgba.isLight || rgba.luminance > 0.28
      let bgColor =
        useDarkScrim
        ? NSColor(srgbRed: 0.09, green: 0.09, blue: 0.11, alpha: 0.78)
        : NSColor(srgbRed: 0.98, green: 0.98, blue: 0.99, alpha: 0.86)
      let borderColor =
        useDarkScrim
        ? NSColor.white.withAlphaComponent(0.24)
        : NSColor.black.withAlphaComponent(0.16)
      context.saveGState()
      context.setFillColor(bgColor.cgColor)
      context.addPath(rounded(plateRect, radius: radius))
      context.fillPath()
      context.setStrokeColor(borderColor.cgColor)
      context.setLineWidth(1)
      context.addPath(rounded(plateRect.insetBy(dx: 0.5, dy: 0.5), radius: radius))
      context.strokePath()
      context.restoreGState()
    }
  }
}
