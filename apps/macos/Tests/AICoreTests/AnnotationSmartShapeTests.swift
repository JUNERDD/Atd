import CoreGraphics
import Testing

@testable import AICore

@Suite("Annotation smart shape recognition")
struct AnnotationSmartShapeTests {
  @Test("Straight freehand pen stroke snaps to a line")
  func snapsStraightLine() {
    let points = (0...10).map { CGPoint(x: Double($0) * 12, y: 20 + Double($0 % 2)) }
    let shape = AnnotationSmartShape.classify(points)
    guard case .line(let from, let to, let bend) = shape else {
      Issue.record("Expected straight line, got \(String(describing: shape))")
      return
    }
    #expect(from == points.first)
    #expect(to == points.last)
    #expect(bend == nil)
  }

  @Test("Smooth single-curvature open stroke snaps to a curved line")
  func snapsCurvedLine() {
    let p0 = CGPoint(x: 0, y: 0)
    let p1 = CGPoint(x: 90, y: -90)
    let p2 = CGPoint(x: 180, y: 0)
    let points = (0...16).map { index in
      let t = CGFloat(index) / 16
      return AnnotationMath.quadPoint(from: p0, control: p1, to: p2, t: t)
    }
    let shape = AnnotationSmartShape.classify(points)
    guard case .line(let from, let to, let bend) = shape else {
      Issue.record("Expected curved line, got \(String(describing: shape))")
      return
    }
    #expect(from == p0)
    #expect(to == p2)
    #expect(bend != nil)
    if let bend {
      #expect(abs(bend.y - p1.y) < 3)
    }
  }

  @Test("Closed box stroke snaps to a rectangle")
  func snapsRectangle() {
    let rect = CGRect(x: 20, y: 30, width: 120, height: 80)
    let points: [CGPoint] = [
      CGPoint(x: rect.minX, y: rect.minY),
      CGPoint(x: rect.midX, y: rect.minY),
      CGPoint(x: rect.maxX, y: rect.minY),
      CGPoint(x: rect.maxX, y: rect.midY),
      CGPoint(x: rect.maxX, y: rect.maxY),
      CGPoint(x: rect.midX, y: rect.maxY),
      CGPoint(x: rect.minX, y: rect.maxY),
      CGPoint(x: rect.minX, y: rect.midY),
      CGPoint(x: rect.minX, y: rect.minY + 1),
    ]
    let shape = AnnotationSmartShape.classify(points)
    guard case .rectangle(let box) = shape else {
      Issue.record("Expected rectangle, got \(String(describing: shape))")
      return
    }
    #expect(box == rect)
  }

  @Test("Closed circular stroke snaps to an ellipse")
  func snapsEllipse() {
    let center = CGPoint(x: 100, y: 100)
    let rx: CGFloat = 50
    let ry: CGFloat = 40
    let points = (0...24).map { index -> CGPoint in
      let angle = (CGFloat(index) / 24) * .pi * 2
      return CGPoint(x: center.x + cos(angle) * rx, y: center.y + sin(angle) * ry)
    }
    let shape = AnnotationSmartShape.classify(points)
    guard case .ellipse(let box) = shape else {
      Issue.record("Expected ellipse, got \(String(describing: shape))")
      return
    }
    #expect(abs(box.width - rx * 2) < 3)
    #expect(abs(box.height - ry * 2) < 3)
  }

  @Test("Too-short or noisy scribbles do not classify as smart shapes")
  func ignoresShortOrScribbledStrokes() {
    let short = [
      CGPoint(x: 0, y: 0), CGPoint(x: 3, y: 0), CGPoint(x: 6, y: 0),
      CGPoint(x: 9, y: 0), CGPoint(x: 12, y: 0), CGPoint(x: 15, y: 0),
    ]
    #expect(AnnotationSmartShape.classify(short) == nil)

    let zigzag = (0...12).map { index in
      CGPoint(x: Double(index) * 15, y: index.isMultiple(of: 2) ? 0 : 80)
    }
    #expect(AnnotationSmartShape.classify(zigzag) == nil)
  }
}
