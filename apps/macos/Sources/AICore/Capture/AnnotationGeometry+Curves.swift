import CoreGraphics
import Foundation

extension AnnotationMath {
  /// Evaluates a quadratic Bezier curve `B(t)` for parameter `t` in `0...1`.
  public static func quadPoint(from p0: CGPoint, control p1: CGPoint, to p2: CGPoint, t: CGFloat)
    -> CGPoint
  {
    let u = 1 - t
    return CGPoint(
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y)
  }

  /// Tangent vector `B'(t)` of a quadratic Bezier curve at `t`.
  public static func quadTangent(from p0: CGPoint, control p1: CGPoint, to p2: CGPoint, t: CGFloat)
    -> CGVector
  {
    let u = 1 - t
    return CGVector(
      dx: 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x),
      dy: 2 * u * (p1.y - p0.y) + 2 * t * (p2.y - p1.y))
  }

  /// Computes the Bezier control point `p1` such that `B(0.5) == midOnCurve`.
  public static func quadControl(from p0: CGPoint, mid midOnCurve: CGPoint, to p2: CGPoint)
    -> CGPoint
  {
    CGPoint(
      x: 2 * midOnCurve.x - 0.5 * (p0.x + p2.x),
      y: 2 * midOnCurve.y - 0.5 * (p0.y + p2.y))
  }

  /// Tight bounding box of a quadratic Bezier via dense curve sampling.
  public static func quadBounds(from p0: CGPoint, control p1: CGPoint, to p2: CGPoint) -> CGRect {
    var pts = [p0, p2]
    for step in 1..<16 {
      pts.append(quadPoint(from: p0, control: p1, to: p2, t: CGFloat(step) / 16))
    }
    return rect(enclosing: pts)
  }

  /// Shortest approximate distance from `point` to the quadratic Bezier curve `(p0, p1, p2)`.
  public static func distance(
    _ point: CGPoint, toQuadFrom p0: CGPoint, control p1: CGPoint, to p2: CGPoint
  )
    -> CGFloat
  {
    var prev = p0
    var best = CGFloat.infinity
    let steps = 24
    for step in 1...steps {
      let cur = quadPoint(from: p0, control: p1, to: p2, t: CGFloat(step) / CGFloat(steps))
      best = min(best, distance(point, toSegment: prev, cur))
      prev = cur
    }
    return best
  }

  /// Snaps `point` relative to `anchor` to 45° increments.
  public static func snap45(from anchor: CGPoint, to point: CGPoint) -> CGPoint {
    AnnotationPath.dragEnd(from: anchor, to: point, snap: true)
  }
}

extension AnnotationHandle {
  public var horizontal: Int { boxHandle?.horizontal ?? 0 }
  public var vertical: Int { boxHandle?.vertical ?? 0 }
}

extension Annotation {
  /// Location of the interactive midpoint diamond handle on lines and arrows.
  public var curveBendHandlePoint: CGPoint? {
    guard let ends = shape.lineEndpoints else { return nil }
    if let bend = ends.bend {
      return AnnotationMath.quadPoint(from: ends.from, control: bend, to: ends.to, t: 0.5)
    }
    return CGPoint(x: (ends.from.x + ends.to.x) / 2, y: (ends.from.y + ends.to.y) / 2)
  }

  /// Moves a single endpoint or bends the midpoint curve while honoring modifier keys:
  /// - `handle == .bend`: moves `B(0.5)` directly under pointer (snapping to straight if close).
  /// - `constrained` (`⇧`): locks boxes to squares, lines/arrows/tails to 45°.
  /// - `centered` (`⌥`): scales symmetrically around the opposite center instead of anchoring the opposite edge.
  public func resized(
    _ handle: AnnotationHandle,
    to point: CGPoint,
    constrained: Bool,
    centered: Bool = false
  ) -> Annotation {
    var copy = self
    switch shape {
    case .arrow(let from, let to, _) where handle == .bend:
      let mid = CGPoint(x: (from.x + to.x) / 2, y: (from.y + to.y) / 2)
      let nextBend: CGPoint? =
        AnnotationMath.distance(point, mid) <= 4
        ? nil
        : AnnotationMath.quadControl(from: from, mid: point, to: to)
      copy.shape = .arrow(from: from, to: to, bend: nextBend)
      return copy
    case .line(let from, let to, _) where handle == .bend:
      let mid = CGPoint(x: (from.x + to.x) / 2, y: (from.y + to.y) / 2)
      let nextBend: CGPoint? =
        AnnotationMath.distance(point, mid) <= 4
        ? nil
        : AnnotationMath.quadControl(from: from, mid: point, to: to)
      copy.shape = .line(from: from, to: to, bend: nextBend)
      return copy
    case .arrow(let from, let to, let bend):
      let target =
        constrained ? AnnotationMath.snap45(from: handle == .start ? to : from, to: point) : point
      copy.shape =
        handle == .start
        ? .arrow(
          from: target, to: to, bend: scaledBend(bend, oldA: from, oldB: to, newA: target, newB: to)
        )
        : .arrow(
          from: from, to: target,
          bend: scaledBend(bend, oldA: from, oldB: to, newA: from, newB: target))
      return copy
    case .line(let from, let to, let bend):
      let target =
        constrained ? AnnotationMath.snap45(from: handle == .start ? to : from, to: point) : point
      copy.shape =
        handle == .start
        ? .line(
          from: target, to: to, bend: scaledBend(bend, oldA: from, oldB: to, newA: target, newB: to)
        )
        : .line(
          from: from, to: target,
          bend: scaledBend(bend, oldA: from, oldB: to, newA: from, newB: target))
      return copy
    case .step(let center, let tip):
      if handle == .end {
        let radius = style.stroke.stepDiameter / 2
        let target = constrained ? AnnotationMath.snap45(from: center, to: point) : point
        let nextTip = AnnotationMath.distance(center, target) > radius + 2 ? target : nil
        copy.shape = .step(center: center, tip: nextTip)
      } else {
        copy.shape = .step(center: point, tip: tip)
      }
      return copy
    case .text where !style.fixedWidth && (handle == .left || handle == .right):
      copy.style.fixedWidth = true
      return copy.resized(handle, to: point)
    case .rectangle(let rect):
      copy.shape = .rectangle(
        Self.resizeBox(rect, handle, to: point, constrained: constrained, centered: centered))
      return copy
    case .ellipse(let rect):
      copy.shape = .ellipse(
        Self.resizeBox(rect, handle, to: point, constrained: constrained, centered: centered))
      return copy
    case .mosaic(let rect):
      copy.shape = .mosaic(
        Self.resizeBox(rect, handle, to: point, constrained: constrained, centered: centered))
      return copy
    case .spotlight(let rect):
      copy.shape = .spotlight(
        Self.resizeBox(rect, handle, to: point, constrained: constrained, centered: centered))
      return copy
    default:
      return resized(handle, to: point)
    }
  }

  /// Preserves relative bend curvature when moving one endpoint of a curved line or arrow.
  private func scaledBend(
    _ bend: CGPoint?, oldA: CGPoint, oldB: CGPoint, newA: CGPoint, newB: CGPoint
  ) -> CGPoint? {
    guard let bend else { return nil }
    let oldMid = CGPoint(x: (oldA.x + oldB.x) / 2, y: (oldA.y + oldB.y) / 2)
    let newMid = CGPoint(x: (newA.x + newB.x) / 2, y: (newA.y + newB.y) / 2)
    return CGPoint(x: newMid.x + (bend.x - oldMid.x), y: newMid.y + (bend.y - oldMid.y))
  }

  private static func resizeBox(
    _ rect: CGRect,
    _ handle: AnnotationHandle,
    to point: CGPoint,
    constrained: Bool,
    centered: Bool
  ) -> CGRect {
    if centered {
      let c = CGPoint(x: rect.midX, y: rect.midY)
      var hw = handle.horizontal == 0 ? rect.width / 2 : abs(point.x - c.x)
      var hh = handle.vertical == 0 ? rect.height / 2 : abs(point.y - c.y)
      if constrained {
        let side = max(hw, hh)
        if handle.horizontal != 0 && handle.vertical != 0 {
          hw = side
          hh = side
        } else if handle.horizontal != 0 {
          hh = hw * (rect.height / max(rect.width, 1))
        } else if handle.vertical != 0 {
          hw = hh * (rect.width / max(rect.height, 1))
        }
      }
      return CGRect(x: c.x - hw, y: c.y - hh, width: hw * 2, height: hh * 2)
    }
    if constrained, handle.horizontal != 0, handle.vertical != 0 {
      let anchor = CGPoint(
        x: handle.horizontal < 0 ? rect.maxX : rect.minX,
        y: handle.vertical < 0 ? rect.maxY : rect.minY)
      return AnnotationPath.dragRect(from: anchor, to: point, square: true)
    }
    return Self.resize(rect, handle, to: point)
  }

  /// Interactive direct-manipulation grips for the selected annotation, extending ``handles`` with
  /// midpoint `.bend`, pull-out step tail `.end`, and auto-width text `.left`/`.right` handles.
  public var interactiveHandles: [(handle: AnnotationHandle, point: CGPoint)] {
    var list = handles
    if let bend = curveBendHandlePoint {
      list.append((.bend, bend))
    }
    if case .step(let center, nil) = shape {
      let r = style.stroke.stepDiameter / 2
      list.append((.end, CGPoint(x: center.x + r + 8, y: center.y)))
    }
    if case .text = shape, !style.fixedWidth {
      list.append((.right, CGPoint(x: bounds.maxX, y: bounds.midY)))
      list.append((.left, CGPoint(x: bounds.minX, y: bounds.midY)))
    }
    return list
  }
}
