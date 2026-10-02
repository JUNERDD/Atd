import CoreGraphics
import Foundation
import Testing

@testable import AICore

@Suite("Annotation drawing")
struct AnnotationDrawingTests {
  let style = AnnotationStyle(color: .red)

  func annotation(_ shape: AnnotationShape, style: AnnotationStyle? = nil) -> Annotation {
    Annotation(shape: shape, style: style ?? self.style)
  }

  @Test("Shift turns a pen or highlighter stroke into one segment from the press, snapped")
  func straightStrokes() {
    let start = CGPoint(x: 10, y: 10)
    let wobbly: [CGPoint] = [start, CGPoint(x: 20, y: 14), CGPoint(x: 30, y: 9)]
    let pen = AnnotationShape.pen(wobbly).dragged(
      from: start, to: CGPoint(x: 110, y: 13), constrained: true)
    guard case .pen(let points) = pen else {
      Issue.record("not a pen")
      return
    }
    #expect(points.count == 2)
    #expect(points[0] == start)
    #expect(abs(points[1].y - start.y) < 0.001)
    #expect(abs(points[1].x - (10 + hypot(100, 3))) < 0.001)
    let marker = AnnotationShape.highlighter([start]).dragged(
      from: start, to: CGPoint(x: 60, y: 62), constrained: true)
    guard case .highlighter(let line) = marker else {
      Issue.record("not a marker")
      return
    }
    #expect(line.count == 2)
    #expect(abs((line[1].x - start.x) - (line[1].y - start.y)) < 0.001)
    // Without Shift the stroke keeps collecting samples.
    let free = AnnotationShape.pen(wobbly).dragged(
      from: start, to: CGPoint(x: 40, y: 20), constrained: false)
    #expect(free == .pen(wobbly + [CGPoint(x: 40, y: 20)]))
  }

  @Test("Rectangle, ellipse, mosaic and spotlight box elements; other tools do not")
  func elementTools() {
    let boxing = AnnotationTool.allCases.filter(\.boxesElements)
    #expect(boxing == [.rectangle, .ellipse, .mosaic, .spotlight])
    let rect = CGRect(x: 1, y: 2, width: 30, height: 40)
    #expect(AnnotationTool.spotlight.elementBox(rect) == .spotlight(rect))
    #expect(AnnotationTool.ellipse.elementBox(rect) == .ellipse(rect))
    #expect(AnnotationTool.arrow.elementBox(rect) == nil)
  }

  @Test("A click boxes the smallest element holding it, clipped to the selection")
  func elementBox() {
    let button = CGRect(x: 100, y: 100, width: 80, height: 24)
    let window = CGRect(x: 0, y: 0, width: 800, height: 600)
    let selection = CGRect(x: 120, y: 50, width: 400, height: 400)
    let point = CGPoint(x: 150, y: 110)
    #expect(
      AnnotationPath.elementBox(in: [button, window], at: point, within: selection)
        == CGRect(x: 120, y: 100, width: 60, height: 24))
    // A stale answer whose smallest area no longer holds the pointer falls back to a larger
    // area that does, or to nothing.
    let away = CGPoint(x: 300, y: 300)
    #expect(
      AnnotationPath.elementBox(in: [button, window], at: away, within: selection) == selection)
    #expect(AnnotationPath.elementBox(in: [button], at: away, within: selection) == nil)
    #expect(AnnotationPath.elementBox(in: [], at: point, within: selection) == nil)
    // An element that barely reaches into the selection is too thin to keep.
    let sliver = CGRect(x: 0, y: 100, width: 122, height: 24)
    #expect(
      AnnotationPath.elementBox(in: [sliver], at: CGPoint(x: 121, y: 110), within: selection)
        == nil)
  }

  @Test("A spotlight hits along its edge, moves, resizes and is dropped when too small")
  func spotlightGeometry() {
    let rect = CGRect(x: 50, y: 50, width: 200, height: 100)
    let spot = annotation(.spotlight(rect))
    #expect(spot.contains(CGPoint(x: 52, y: 100), tolerance: 4))
    #expect(!spot.contains(CGPoint(x: 150, y: 100), tolerance: 4))
    #expect(spot.bounds == rect)
    #expect(spot.handles.count == 8)
    #expect(
      spot.moved(by: CGVector(dx: 5, dy: -5)).shape == .spotlight(rect.offsetBy(dx: 5, dy: -5)))
    #expect(
      spot.resized(.bottomRight, to: CGPoint(x: 300, y: 300)).shape
        == .spotlight(CGRect(x: 50, y: 50, width: 250, height: 250)))
    #expect(!AnnotationPath.isSubstantial(.spotlight(CGRect(x: 0, y: 0, width: 2, height: 50))))
    let dragged = AnnotationTool.spotlight.initialShape(at: CGPoint(x: 10, y: 10))?.dragged(
      from: CGPoint(x: 10, y: 10), to: CGPoint(x: 40, y: 20), constrained: true)
    #expect(dragged == .spotlight(CGRect(x: 10, y: 10, width: 30, height: 30)))
  }

  @Test("Drawing tools reach into a spotlight; the select tool selects it from inside")
  func spotlightPress() {
    let spot = annotation(.spotlight(CGRect(x: 50, y: 50, width: 200, height: 100)))
    let document = AnnotationDocument([spot])
    let inside = CGPoint(x: 150, y: 100)
    #expect(document.pressTarget(at: inside, tool: .rectangle, selectedID: nil) == .canvas)
    #expect(document.pressTarget(at: inside, tool: .spotlight, selectedID: nil) == .canvas)
    #expect(
      document.pressTarget(at: CGPoint(x: 50, y: 100), tool: .spotlight, selectedID: nil)
        == .annotation(spot.id))
    #expect(
      document.pressTarget(at: inside, tool: .select, selectedID: nil) == .annotation(spot.id))
  }

  @Test("Text with a background hits and bounds its plate, which grows with the type")
  func textPlate() {
    let frame = CGRect(x: 100, y: 100, width: 80, height: 26)
    let plain = annotation(.text("Hi", frame: frame))
    let plated = annotation(
      .text("Hi", frame: frame), style: AnnotationStyle(textBackground: true))
    #expect(plain.bounds == frame)
    let plate = AnnotationPath.textPlate(around: frame, fontSize: AnnotationStroke.default.fontSize)
    #expect(plated.bounds == plate)
    #expect(plate.contains(frame))
    #expect(plate.minX < frame.minX && plate.minY < frame.minY)
    let edge = CGPoint(x: plate.minX + 1, y: frame.midY)
    #expect(plated.contains(edge, tolerance: 0))
    #expect(!plain.contains(edge, tolerance: 0))
    let small = AnnotationPath.textPlate(around: frame, fontSize: AnnotationStroke(0).fontSize)
    #expect(small.width < plate.width)
  }
}
