import CoreGraphics
import Foundation

/// Geometric dwell-to-snap recognizer inspired by iPadOS PencilKit Smart Shapes.
/// When the pointer holds steady at the end of a Pen stroke (360ms dwell), classifies
/// the freehand polyline into an exact `.line`, `.rectangle`, `.ellipse`, or `.arrow`.
public enum AnnotationSmartShape {
  public static let dwellInterval: TimeInterval = 0.36
  public static let minimumStrokeLength: CGFloat = 28

  public static func classify(_ points: [CGPoint]) -> AnnotationShape? {
    guard points.count >= 6, let first = points.first, let last = points.last else { return nil }
    let box = AnnotationMath.rect(enclosing: points)
    let diag = hypot(box.width, box.height)
    guard diag >= minimumStrokeLength else { return nil }

    let totalLen = polylineLength(points)
    guard totalLen >= minimumStrokeLength else { return nil }

    let chord = AnnotationMath.distance(first, last)
    let closedThreshold = max(24, diag * 0.28)
    let isClosed = chord <= closedThreshold && totalLen >= diag * 1.9

    if isClosed {
      return classifyClosed(points, box: box)
    }
    return classifyOpen(points, first: first, last: last, totalLen: totalLen)
  }

  private static func classifyOpen(
    _ points: [CGPoint], first: CGPoint, last: CGPoint, totalLen: CGFloat
  )
    -> AnnotationShape?
  {
    let chord = AnnotationMath.distance(first, last)
    guard chord >= 20 else { return nil }
    // Straightness check: max perpendicular deviation vs chord.
    let maxDev = points.map { AnnotationMath.distance($0, toSegment: first, last) }.max() ?? 0
    if maxDev <= max(10, chord * 0.08) && totalLen <= chord * 1.18 {
      return .line(from: first, to: last, bend: nil)
    }
    // Single-stroke curved arc if smooth single curvature.
    if points.count >= 8 {
      let mid = points[points.count / 2]
      let midOffset = AnnotationMath.distance(mid, toSegment: first, last)
      if midOffset >= 12, midOffset <= chord * 0.45, totalLen <= chord * 1.38 {
        let control = AnnotationMath.quadControl(from: first, mid: mid, to: last)
        let curveErr =
          points.map {
            AnnotationMath.distance($0, toQuadFrom: first, control: control, to: last)
          }.max() ?? .infinity
        if curveErr <= max(12, chord * 0.08) {
          return .line(from: first, to: last, bend: control)
        }
      }
    }
    return nil
  }

  private static func classifyClosed(_ points: [CGPoint], box: CGRect) -> AnnotationShape? {
    guard box.width >= 16, box.height >= 16 else { return nil }
    // Measure average normalized distance to ellipse perimeter vs rectangle perimeter.
    let a = box.width / 2
    let b = box.height / 2
    let cx = box.midX
    let cy = box.midY
    var rectErrSum: CGFloat = 0
    var ellipseErrSum: CGFloat = 0
    for p in points {
      let edgeX = min(abs(p.x - box.minX), abs(p.x - box.maxX))
      let edgeY = min(abs(p.y - box.minY), abs(p.y - box.maxY))
      rectErrSum += min(edgeX, edgeY)
      let nx = (p.x - cx) / max(a, 1)
      let ny = (p.y - cy) / max(b, 1)
      let radialRatio = hypot(nx, ny)
      ellipseErrSum += abs(radialRatio - 1) * min(a, b)
    }
    let count = CGFloat(points.count)
    let avgRect = rectErrSum / count
    let avgEllipse = ellipseErrSum / count
    let maxAllowed = max(14, min(box.width, box.height) * 0.22)
    guard min(avgRect, avgEllipse) <= maxAllowed else { return nil }
    return avgRect < avgEllipse * 0.92 ? .rectangle(box) : .ellipse(box)
  }

  private static func polylineLength(_ points: [CGPoint]) -> CGFloat {
    guard points.count > 1 else { return 0 }
    return zip(points, points.dropFirst()).reduce(0) { $0 + AnnotationMath.distance($1.0, $1.1) }
  }
}
