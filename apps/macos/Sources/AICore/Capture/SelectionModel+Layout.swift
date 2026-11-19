import CoreGraphics
import Foundation

extension SelectionModel {
  /// Computes a selection rectangle supporting aspect-ratio presets and centered modifier drags:
  /// - `constrained` (`⇧`): locks to `aspect` or `1:1` square when `aspect` is nil.
  /// - `centered` (`⌥`): drags symmetrically outward around `origin` or original center.
  /// - `aspect`: constrains proportions to the active preset (`ratio`).
  public func rect(
    for drag: SelectionDrag,
    to point: CGPoint,
    constrained: Bool,
    centered: Bool = false,
    aspect: CGFloat? = nil
  ) -> CGRect {
    let clampedPoint = clamped(point)
    let activeRatio = constrained ? (aspect ?? 1.0) : aspect

    switch drag {
    case .create(let origin):
      let raw: CGRect
      if centered {
        var hx = abs(clampedPoint.x - origin.x)
        var hy = abs(clampedPoint.y - origin.y)
        if let ratio = activeRatio {
          hy = max(1, hx / ratio)
          if hx / max(hy, 1) < ratio { hx = hy * ratio }
        }
        let maxHalfW = min(origin.x - bounds.minX, bounds.maxX - origin.x)
        let maxHalfH = min(origin.y - bounds.minY, bounds.maxY - origin.y)
        hx = min(hx, maxHalfW)
        hy = min(hy, maxHalfH)
        if let ratio = activeRatio {
          if hx / max(hy, 1) > ratio { hx = hy * ratio } else { hy = hx / ratio }
        }
        raw = CGRect(x: origin.x - hx, y: origin.y - hy, width: hx * 2, height: hy * 2)
        return settled(raw)
      }
      if let ratio = activeRatio {
        return settled(aspectRect(from: origin, to: clampedPoint, ratio: ratio))
      }
      return rect(for: drag, to: point, square: constrained)

    case .move:
      return rect(for: drag, to: point, square: false)

    case .resize(let handle, let original):
      if centered {
        let c = CGPoint(x: original.midX, y: original.midY)
        var hw = handle.horizontal == 0 ? original.width / 2 : abs(clampedPoint.x - c.x)
        var hh = handle.vertical == 0 ? original.height / 2 : abs(clampedPoint.y - c.y)
        if let ratio = activeRatio {
          if handle.horizontal != 0 { hh = hw / ratio } else { hw = hh * ratio }
        }
        hw = min(hw, min(c.x - bounds.minX, bounds.maxX - c.x))
        hh = min(hh, min(c.y - bounds.minY, bounds.maxY - c.y))
        if let ratio = activeRatio {
          if hw / max(hh, 1) > ratio { hw = hh * ratio } else { hh = hw / ratio }
        }
        return settled(CGRect(x: c.x - hw, y: c.y - hh, width: hw * 2, height: hh * 2))
      }
      if let ratio = activeRatio, handle.horizontal != 0, handle.vertical != 0 {
        let anchor = CGPoint(
          x: handle.horizontal < 0 ? original.maxX : original.minX,
          y: handle.vertical < 0 ? original.maxY : original.minY)
        return settled(aspectRect(from: anchor, to: clampedPoint, ratio: ratio))
      }
      return rect(for: drag, to: point, square: false)
    }
  }

  /// Resizes `selection` cleanly around its center (clamped to bounds) to match `preset`.
  public func applyingAspectPreset(_ preset: SelectionAspectPreset, to selection: CGRect) -> CGRect
  {
    guard let ratio = preset.ratio else { return selection }
    let center = CGPoint(x: selection.midX, y: selection.midY)
    var w = selection.width
    var h = w / ratio
    if h > bounds.height {
      h = bounds.height * 0.8
      w = h * ratio
    }
    if w > bounds.width {
      w = bounds.width * 0.8
      h = w / ratio
    }
    let minX = min(max(center.x - w / 2, bounds.minX), bounds.maxX - w)
    let minY = min(max(center.y - h / 2, bounds.minY), bounds.maxY - h)
    return settled(CGRect(x: minX, y: minY, width: w, height: h))
  }

  private func aspectRect(from origin: CGPoint, to point: CGPoint, ratio: CGFloat) -> CGRect {
    let dx = point.x - origin.x
    let dy = point.y - origin.y
    let signX: CGFloat = dx < 0 ? -1 : 1
    let signY: CGFloat = dy < 0 ? -1 : 1
    let maxW = signX < 0 ? origin.x - bounds.minX : bounds.maxX - origin.x
    let maxH = signY < 0 ? origin.y - bounds.minY : bounds.maxY - origin.y
    var w = abs(dx)
    var h = abs(dy)
    if w / max(h, 0.001) > ratio {
      h = w / ratio
    } else {
      w = h * ratio
    }
    if w > maxW {
      w = maxW
      h = w / ratio
    }
    if h > maxH {
      h = maxH
      w = h * ratio
    }
    return AnnotationMath.rect(
      corners: origin,
      CGPoint(x: origin.x + signX * w, y: origin.y + signY * h))
  }
}
