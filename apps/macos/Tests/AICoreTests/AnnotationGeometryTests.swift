import CoreGraphics
import Foundation
import Testing

@testable import AICore

@Suite("Annotation geometry")
struct AnnotationGeometryTests {
  let style = AnnotationStyle(color: .red, stroke: .medium)

  func annotation(_ shape: AnnotationShape) -> Annotation {
    Annotation(shape: shape, style: style)
  }

  @Test("A rectangle hits near its outline only, so shapes inside it stay reachable")
  func rectangleHit() {
    let frame = annotation(.rectangle(CGRect(x: 10, y: 10, width: 100, height: 60)))
    #expect(frame.contains(CGPoint(x: 10, y: 40), tolerance: 4))
    #expect(frame.contains(CGPoint(x: 60, y: 73), tolerance: 4))
    #expect(!frame.contains(CGPoint(x: 60, y: 40), tolerance: 4))
    #expect(!frame.contains(CGPoint(x: 60, y: 90), tolerance: 4))
  }

  @Test("An ellipse hits near its outline on and between the axes")
  func ellipseHit() {
    let oval = annotation(.ellipse(CGRect(x: 0, y: 0, width: 200, height: 100)))
    #expect(oval.contains(CGPoint(x: 200, y: 50), tolerance: 3))
    #expect(oval.contains(CGPoint(x: 100, y: 1), tolerance: 3))
    let diagonal = CGPoint(x: 100 + 100 * cos(0.6), y: 50 + 50 * sin(0.6))
    #expect(oval.contains(diagonal, tolerance: 3))
    #expect(!oval.contains(CGPoint(x: 100, y: 50), tolerance: 3))
    #expect(!oval.contains(CGPoint(x: 195, y: 5), tolerance: 3))
  }

  @Test("Lines, arrows and freehand paths hit within stroke width plus tolerance")
  func strokeHit() {
    let line = annotation(.line(from: CGPoint(x: 0, y: 0), to: CGPoint(x: 100, y: 0)))
    #expect(line.contains(CGPoint(x: 50, y: 5), tolerance: 3))
    #expect(!line.contains(CGPoint(x: 50, y: 6), tolerance: 3))
    #expect(!line.contains(CGPoint(x: 110, y: 0), tolerance: 3))
    let pen = annotation(.pen([CGPoint(x: 0, y: 0), CGPoint(x: 10, y: 10), CGPoint(x: 20, y: 0)]))
    #expect(pen.contains(CGPoint(x: 15, y: 5), tolerance: 2))
    #expect(!pen.contains(CGPoint(x: 10, y: 0), tolerance: 2))
    let marker = Annotation(shape: .highlighter([CGPoint(x: 0, y: 0)]), style: style)
    #expect(marker.contains(CGPoint(x: 0, y: 12), tolerance: 2))
  }

  @Test("Text, mosaic and step badges hit anywhere inside")
  func filledHit() {
    let text = annotation(.text("Hi", frame: CGRect(x: 0, y: 0, width: 30, height: 20)))
    #expect(text.contains(CGPoint(x: 15, y: 10), tolerance: 0))
    let mosaic = annotation(.mosaic(CGRect(x: 0, y: 0, width: 30, height: 20)))
    #expect(mosaic.contains(CGPoint(x: 15, y: 10), tolerance: 0))
    let step = annotation(.step(center: CGPoint(x: 50, y: 50)))
    #expect(step.contains(CGPoint(x: 50, y: 63), tolerance: 0))
    #expect(!step.contains(CGPoint(x: 50, y: 65), tolerance: 0))
  }

  @Test("Padded bounds cover a shape's whole box, inside an outline too")
  func paddedBounds() {
    let box = annotation(.rectangle(CGRect(x: 10, y: 10, width: 100, height: 60)))
    #expect(box.boundsContain(CGPoint(x: 60, y: 40), padding: 4))
    #expect(box.boundsContain(CGPoint(x: 5, y: 40), padding: 4))
    #expect(!box.boundsContain(CGPoint(x: 3, y: 40), padding: 4))
    let line = annotation(.line(from: CGPoint(x: 0, y: 0), to: CGPoint(x: 100, y: 0)))
    #expect(line.boundsContain(CGPoint(x: 50, y: 5.5), padding: 4))
    #expect(!line.boundsContain(CGPoint(x: 50, y: 7), padding: 4))
  }

  @Test("Box grips map to the selection handle at the same place; line ends to none")
  func gripHandles() {
    #expect(AnnotationHandle.topLeft.boxHandle == .topLeft)
    #expect(AnnotationHandle.bottom.boxHandle == .bottom)
    #expect(AnnotationHandle.start.boxHandle == nil)
    #expect(AnnotationHandle.end.boxHandle == nil)
  }

  @Test("Bounds include half the stroke and an arrow's head")
  func bounds() {
    let box = annotation(.rectangle(CGRect(x: 10, y: 10, width: 20, height: 20)))
    #expect(box.bounds == CGRect(x: 8, y: 8, width: 24, height: 24))
    let arrow = annotation(.arrow(from: CGPoint(x: 0, y: 0), to: CGPoint(x: 100, y: 0)))
    let head = AnnotationPath.arrowHeadLength(lineWidth: 4)
    #expect(arrow.bounds.minY == -head)
    let step = annotation(.step(center: CGPoint(x: 50, y: 50)))
    #expect(step.bounds == CGRect(x: 36, y: 36, width: 28, height: 28))
  }

  @Test("Moving shifts every point of the shape")
  func move() {
    let pen = annotation(.pen([CGPoint(x: 1, y: 2), CGPoint(x: 3, y: 4)]))
    #expect(
      pen.moved(by: CGVector(dx: 10, dy: -1)).shape
        == .pen([CGPoint(x: 11, y: 1), CGPoint(x: 13, y: 3)]))
    let text = annotation(.text("a", frame: CGRect(x: 0, y: 0, width: 5, height: 5)))
    #expect(
      text.moved(by: CGVector(dx: 2, dy: 2)).shape
        == .text("a", frame: CGRect(x: 2, y: 2, width: 5, height: 5)))
  }

  @Test("A box grip moves its edges and the box stays standardized past the opposite edge")
  func resizeBox() {
    let box = annotation(.rectangle(CGRect(x: 10, y: 10, width: 40, height: 20)))
    #expect(
      box.resized(.bottomRight, to: CGPoint(x: 60, y: 50)).shape
        == .rectangle(CGRect(x: 10, y: 10, width: 50, height: 40)))
    #expect(
      box.resized(.top, to: CGPoint(x: 999, y: 0)).shape
        == .rectangle(CGRect(x: 10, y: 0, width: 40, height: 30)))
    #expect(
      box.resized(.left, to: CGPoint(x: 70, y: 0)).shape
        == .rectangle(CGRect(x: 50, y: 10, width: 20, height: 20)))
  }

  @Test("Arrows and lines resize from their ends; freehand, text and badges only move")
  func resizeEnds() {
    let arrow = annotation(.arrow(from: CGPoint(x: 0, y: 0), to: CGPoint(x: 10, y: 0)))
    #expect(arrow.handles.map(\.handle) == [.start, .end])
    #expect(
      arrow.resized(.end, to: CGPoint(x: 5, y: 5)).shape
        == .arrow(from: CGPoint(x: 0, y: 0), to: CGPoint(x: 5, y: 5)))
    let step = annotation(.step(center: .zero))
    #expect(step.handles.isEmpty)
    #expect(step.resized(.end, to: CGPoint(x: 9, y: 9)) == step)
  }

  @Test("The nearest grip within tolerance wins")
  func handleHit() {
    let box = annotation(.rectangle(CGRect(x: 0, y: 0, width: 10, height: 10)))
    #expect(box.handle(at: CGPoint(x: 9, y: 9), tolerance: 6) == .bottomRight)
    #expect(box.handle(at: CGPoint(x: 5, y: -1), tolerance: 2) == .top)
    #expect(box.handle(at: CGPoint(x: 30, y: 30), tolerance: 6) == nil)
  }

  @Test("Rects from points are standardized; an empty point list has a null rect")
  func rectHelpers() {
    #expect(
      AnnotationMath.rect(corners: CGPoint(x: 5, y: 9), CGPoint(x: 1, y: 2))
        == CGRect(x: 1, y: 2, width: 4, height: 7))
    #expect(
      AnnotationMath.rect(enclosing: [CGPoint(x: 3, y: 1), CGPoint(x: -1, y: 4)])
        == CGRect(x: -1, y: 1, width: 4, height: 3))
    #expect(AnnotationMath.rect(enclosing: []).isNull)
  }
}
