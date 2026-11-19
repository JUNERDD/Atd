import AICore
import AppKit

/// Transient direct-manipulation visual overlays hosted by ``AnnotationCanvasView``:
/// snap guides, marquee box, text-box creation preview, selection handles (including curve bend,
/// step tail pull-out, and multi-select group bounds), eyedropper magnifier, and size HUD.
final class AnnotationCanvasOverlay: NSObject {
  var pointerLocation: CGPoint?
  var eyedropperSample: AnnotationRGBA?
  var sizeHudText: String?
  private var sizeHudTimer: Timer?

  func showSizeHud(_ text: String, on view: NSView) {
    sizeHudText = text
    sizeHudTimer?.invalidate()
    sizeHudTimer = Timer.scheduledTimer(withTimeInterval: 0.95, repeats: false) {
      [weak self, weak view] _ in
      MainActor.assumeIsolated {
        guard let self, let view else { return }
        self.sizeHudText = nil
        view.setNeedsDisplay(Self.hudDirtyRect(in: view.bounds))
      }
    }
    view.setNeedsDisplay(Self.hudDirtyRect(in: view.bounds))
  }

  private static func hudDirtyRect(in bounds: CGRect) -> CGRect {
    CGRect(
      x: max(bounds.minX, bounds.midX - 150),
      y: bounds.minY,
      width: min(bounds.width, 300),
      height: 52)
  }

  /// Samples the RGBA color at `canvasPoint` from `backdrop`.
  static func samplePixel(at canvasPoint: CGPoint, in backdrop: CaptureBackdrop) -> AnnotationRGBA?
  {
    let image = backdrop.image
    let scale = max(backdrop.scale, 1)
    let px = Int(((canvasPoint.x - backdrop.origin.x) * scale).rounded(.down))
    let py = Int(((canvasPoint.y - backdrop.origin.y) * scale).rounded(.down))
    guard px >= 0, py >= 0, px < image.width, py < image.height,
      let pixel = image.cropping(to: CGRect(x: px, y: py, width: 1, height: 1)),
      let cs = CGColorSpace(name: CGColorSpace.sRGB)
    else { return nil }
    var rgba: [UInt8] = [0, 0, 0, 0]
    guard
      let ctx = CGContext(
        data: &rgba, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
        space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    ctx.draw(pixel, in: CGRect(x: 0, y: 0, width: 1, height: 1))
    let div = max(CGFloat(rgba[3]) / 255.0, 0.001)
    return AnnotationRGBA(
      red: min(CGFloat(rgba[0]) / 255.0 / div, 1),
      green: min(CGFloat(rgba[1]) / 255.0 / div, 1),
      blue: min(CGFloat(rgba[2]) / 255.0 / div, 1),
      alpha: 1)
  }

  func draw(on canvas: AnnotationCanvasView, in context: CGContext) {
    let interaction = canvas.interaction
    if let marquee = interaction.marqueeRect {
      context.saveGState()
      context.setFillColor(NSColor.controlAccentColor.withAlphaComponent(0.12).cgColor)
      context.fill(marquee)
      context.setStrokeColor(NSColor.controlAccentColor.withAlphaComponent(0.9).cgColor)
      context.setLineWidth(1.2)
      context.stroke(marquee.insetBy(dx: 0.6, dy: 0.6))
      context.restoreGState()
    }
    if let box = interaction.textBoxPreview {
      context.saveGState()
      context.setFillColor(NSColor.controlAccentColor.withAlphaComponent(0.08).cgColor)
      context.fill(box)
      context.setStrokeColor(NSColor.controlAccentColor.cgColor)
      context.setLineWidth(1.2)
      context.setLineDash(phase: 0, lengths: [4, 3])
      context.stroke(box)
      context.restoreGState()
    }
    for guide in interaction.activeSnapGuides {
      context.saveGState()
      context.setStrokeColor(NSColor.systemPink.withAlphaComponent(0.88).cgColor)
      context.setLineWidth(1)
      switch guide {
      case .vertical(let x, let ySpan):
        context.strokeLineSegments(between: [
          CGPoint(x: x, y: ySpan.lowerBound), CGPoint(x: x, y: ySpan.upperBound),
        ])
      case .horizontal(let y, let xSpan):
        context.strokeLineSegments(between: [
          CGPoint(x: xSpan.lowerBound, y: y), CGPoint(x: xSpan.upperBound, y: y),
        ])
      }
      context.restoreGState()
    }
    if !canvas.textEditor.isHosted(in: canvas) {
      drawSelection(store: canvas.store, in: context)
    }
    if interaction.eyedropperActive, let pt = pointerLocation, let backdrop = canvas.backdrop {
      drawEyedropperLoupe(
        at: pt, sample: eyedropperSample, in: canvas.bounds, backdrop: backdrop, context: context)
    }
    if let sizeHudText { drawSizeHud(sizeHudText, in: canvas.bounds, context: context) }
  }

  private func drawSelection(store: AnnotationStore, in context: CGContext) {
    let selected = store.selectedAnnotations
    guard !selected.isEmpty else { return }
    if selected.count > 1 {
      drawMultiSelection(selected, in: context)
      return
    }
    guard let single = selected.first else { return }
    var handles = single.interactiveHandles
    if let cornerPoint = single.cornerRadiusHandlePoint() {
      handles.append((.cornerRadius, cornerPoint))
    }
    if case .spotlight(let rect) = single.shape {
      context.saveGState()
      context.setLineWidth(1.2)
      context.setStrokeColor(NSColor.controlAccentColor.cgColor)
      context.setLineDash(phase: 0, lengths: [4, 3])
      let r = single.style.cornerRadius(for: rect)
      if single.style.spotlightShape == .ellipse {
        context.strokeEllipse(in: rect.insetBy(dx: 0.6, dy: 0.6))
      } else {
        context.addPath(AnnotationRenderer.rounded(rect.insetBy(dx: 0.6, dy: 0.6), radius: r))
        context.strokePath()
      }
      context.restoreGState()
    } else if handles.isEmpty {
      AnnotationCanvasView.outline(single.bounds.insetBy(dx: -3, dy: -3), in: context)
    }
    let isStep = if case .step = single.shape { true } else { false }
    if case .step(let center, nil) = single.shape,
      let tail = handles.first(where: { $0.handle == .end })?.point
    {
      context.saveGState()
      context.setStrokeColor(NSColor.controlAccentColor.withAlphaComponent(0.7).cgColor)
      context.setLineWidth(1.2)
      context.setLineDash(phase: 0, lengths: [2.5, 2.5])
      context.strokeLineSegments(between: [center, tail])
      context.restoreGState()
    }
    drawExtendedHandles(handles, isStep: isStep, in: context)
  }

  private func drawExtendedHandles(
    _ handles: [(handle: AnnotationHandle, point: CGPoint)], isStep: Bool, in context: CGContext
  ) {
    context.saveGState()
    for (handle, point) in handles {
      if handle == .bend {
        let r: CGFloat = 5.5
        context.addLines(between: [
          CGPoint(x: point.x, y: point.y - r), CGPoint(x: point.x + r, y: point.y),
          CGPoint(x: point.x, y: point.y + r), CGPoint(x: point.x - r, y: point.y),
        ])
        context.closePath()
        context.setFillColor(NSColor.systemYellow.cgColor)
        context.setStrokeColor(NSColor.black.withAlphaComponent(0.75).cgColor)
        context.setLineWidth(1.3)
        context.drawPath(using: .fillStroke)
      } else if handle == .cornerRadius {
        let grip = CGRect(x: point.x - 3.5, y: point.y - 3.5, width: 7, height: 7)
        drawCircleGrip(grip, fill: NSColor.white.cgColor, in: context)
      } else {
        let grip = CGRect(x: point.x - 4, y: point.y - 4, width: 8, height: 8)
        let fill = (isStep && handle == .end) ? NSColor.systemOrange.cgColor : NSColor.white.cgColor
        drawCircleGrip(grip, fill: fill, in: context)
      }
    }
    context.restoreGState()
  }

  private func drawCircleGrip(_ grip: CGRect, fill: CGColor, in context: CGContext) {
    context.setFillColor(fill)
    context.setStrokeColor(NSColor.controlAccentColor.cgColor)
    context.setLineWidth(1.5)
    context.fillEllipse(in: grip)
    context.strokeEllipse(in: grip)
  }

  private func drawMultiSelection(_ selected: [Annotation], in context: CGContext) {
    let union = selected.dropFirst().reduce(selected[0].bounds) { $0.union($1.bounds) }
    let outer = union.insetBy(dx: -5, dy: -5)
    context.saveGState()
    context.setLineWidth(1)
    context.setStrokeColor(NSColor.controlAccentColor.withAlphaComponent(0.55).cgColor)
    context.setLineDash(phase: 0, lengths: [3, 3])
    for item in selected { context.stroke(item.bounds.insetBy(dx: -2, dy: -2)) }
    context.setLineDash(phase: 0, lengths: [5, 3])
    context.setLineWidth(1.5)
    context.setStrokeColor(NSColor.controlAccentColor.cgColor)
    context.stroke(outer)
    context.setLineDash(phase: 0, lengths: [])
    context.setFillColor(NSColor.white.cgColor)
    for handle in SelectionHandle.allCases {
      let pt = handle.point(on: outer)
      let grip = CGRect(x: pt.x - 4, y: pt.y - 4, width: 8, height: 8)
      context.fillEllipse(in: grip)
      context.strokeEllipse(in: grip)
    }
    context.restoreGState()
  }

  private func drawEyedropperLoupe(
    at point: CGPoint,
    sample: AnnotationRGBA?,
    in bounds: CGRect,
    backdrop: CaptureBackdrop,
    context: CGContext
  ) {
    let diameter: CGFloat = 56
    var cx = point.x + 42
    var cy = point.y - 42
    if cx + diameter / 2 > bounds.maxX - 8 { cx = point.x - 42 }
    if cy - diameter / 2 < bounds.minY + 8 { cy = point.y + 42 }
    let circle = CGRect(
      x: cx - diameter / 2, y: cy - diameter / 2, width: diameter, height: diameter)

    let scale = max(backdrop.scale, 1)
    let px = Int(((point.x - backdrop.origin.x) * scale).rounded(.down))
    let py = Int(((point.y - backdrop.origin.y) * scale).rounded(.down))
    let gridRadius = 4
    let cropRect = CGRect(
      x: px - gridRadius, y: py - gridRadius, width: gridRadius * 2 + 1, height: gridRadius * 2 + 1)

    context.saveGState()
    context.setShadow(
      offset: CGSize(width: 0, height: -4), blur: 10,
      color: NSColor.black.withAlphaComponent(0.45).cgColor)
    context.setFillColor(NSColor.black.cgColor)
    context.fillEllipse(in: circle)
    context.restoreGState()

    context.saveGState()
    context.addEllipse(in: circle)
    context.clip()
    if let crop = backdrop.image.cropping(to: cropRect) {
      context.interpolationQuality = .none
      AnnotationRenderer.drawImage(crop, in: circle, context: context)
    }
    let cell = diameter / CGFloat(gridRadius * 2 + 1)
    let centerPixel = CGRect(x: cx - cell / 2, y: cy - cell / 2, width: cell, height: cell)
    context.setStrokeColor(NSColor.white.cgColor)
    context.setLineWidth(1.5)
    context.stroke(centerPixel)
    context.restoreGState()

    context.saveGState()
    context.setStrokeColor(NSColor.white.withAlphaComponent(0.9).cgColor)
    context.setLineWidth(2)
    context.strokeEllipse(in: circle)
    if let sample {
      let badgeText = sample.hexString
      let attr = NSAttributedString(
        string: badgeText,
        attributes: [
          .font: NSFont.monospacedSystemFont(ofSize: 10.5, weight: .semibold),
          .foregroundColor: NSColor.white,
        ])
      let sz = attr.size()
      let pill = CGRect(
        x: cx - (sz.width + 20) / 2, y: circle.maxY + 4, width: sz.width + 20, height: 18)
      context.setFillColor(NSColor(srgbRed: 0.08, green: 0.09, blue: 0.11, alpha: 0.88).cgColor)
      context.addPath(AnnotationRenderer.rounded(pill, radius: 9))
      context.fillPath()
      context.setFillColor(sample.nsColor.cgColor)
      context.fillEllipse(in: CGRect(x: pill.minX + 5, y: pill.midY - 4, width: 8, height: 8))
      AnnotationRenderer.withAppKit(context) {
        attr.draw(at: CGPoint(x: pill.minX + 16, y: pill.midY - sz.height / 2))
      }
    }
    context.restoreGState()
  }

  private func drawSizeHud(_ text: String, in bounds: CGRect, context: CGContext) {
    let attr = NSAttributedString(
      string: text,
      attributes: [
        .font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold),
        .foregroundColor: NSColor.white,
      ])
    let sz = attr.size()
    let pill = CGRect(
      x: bounds.midX - (sz.width + 24) / 2,
      y: bounds.minY + 14,
      width: sz.width + 24,
      height: 26)
    context.saveGState()
    context.setShadow(
      offset: CGSize(width: 0, height: -2), blur: 8,
      color: NSColor.black.withAlphaComponent(0.32).cgColor)
    context.setFillColor(NSColor(srgbRed: 0.09, green: 0.10, blue: 0.12, alpha: 0.84).cgColor)
    context.addPath(AnnotationRenderer.rounded(pill, radius: 13))
    context.fillPath()
    context.setStrokeColor(NSColor.white.withAlphaComponent(0.22).cgColor)
    context.setLineWidth(1)
    context.addPath(AnnotationRenderer.rounded(pill.insetBy(dx: 0.5, dy: 0.5), radius: 12.5))
    context.strokePath()
    AnnotationRenderer.withAppKit(context) {
      attr.draw(at: CGPoint(x: pill.minX + 12, y: pill.midY - sz.height / 2))
    }
    context.restoreGState()
  }
}

extension AnnotationCanvasView {
  func sampleEyedropper(at point: CGPoint, commit: Bool) {
    overlay.pointerLocation = point
    guard let backdrop,
      let sample = AnnotationCanvasOverlay.samplePixel(at: point, in: backdrop)
    else {
      needsDisplay = true
      return
    }
    overlay.eyedropperSample = sample
    interaction.hoveredRGBA = sample
    onSampleColor?(sample, commit)
    needsDisplay = true
  }
}
