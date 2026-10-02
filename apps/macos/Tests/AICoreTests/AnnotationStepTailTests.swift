import CoreGraphics
import Foundation
import Testing

@testable import AICore

@Suite("Annotation step tail and document extras")
struct AnnotationStepTailTests {
  let style = AnnotationStyle(color: .red)
  let center = CGPoint(x: 100, y: 100)
  let tip = CGPoint(x: 200, y: 100)

  func badge(tip: CGPoint?) -> Annotation {
    Annotation(shape: .step(center: center, tip: tip), style: style)
  }

  @Test("A click keeps the plain badge; a drag past the click reach pulls out a tail")
  func dragging() {
    let start = AnnotationShape.step(center: center)
    #expect(
      start.dragged(from: center, to: CGPoint(x: 103, y: 100), constrained: false)
        == .step(center: center, tip: nil))
    // Exactly the click reach is still a click.
    #expect(
      start.dragged(from: center, to: CGPoint(x: 104, y: 100), constrained: false)
        == .step(center: center))
    #expect(
      start.dragged(from: center, to: tip, constrained: false) == .step(center: center, tip: tip))
    // Shift snaps the tail to 45 degrees, keeping its length.
    let snapped = start.dragged(from: center, to: CGPoint(x: 160, y: 108), constrained: true)
    guard case .step(_, let end?) = snapped else {
      Issue.record("no tail")
      return
    }
    #expect(abs(end.y - center.y) < 0.001)
  }

  @Test("The tail starts inside the badge's edge and only exists once the tip clears the badge")
  func tailStart() {
    let start = AnnotationPath.stepTailStart(center: center, tip: tip, diameter: 28)
    #expect(start == CGPoint(x: 113, y: 100))
    #expect(
      AnnotationPath.stepTailStart(center: center, tip: CGPoint(x: 110, y: 100), diameter: 28)
        == nil)
    #expect(AnnotationPath.stepTailStart(center: center, tip: center, diameter: 28) == nil)
  }

  @Test("Bounds, hit-testing and grips include the tail")
  func geometry() {
    let plain = badge(tip: nil)
    let tailed = badge(tip: tip)
    #expect(plain.handles.isEmpty)
    #expect(tailed.handles.map(\.handle) == [.start, .end])
    #expect(tailed.handles.map(\.point) == [center, tip])
    #expect(tailed.bounds.contains(plain.bounds))
    #expect(tailed.bounds.maxX >= tip.x)
    // The tail is body: a press along it hits, beside it does not.
    let alongTail = CGPoint(x: 150, y: 101)
    #expect(tailed.contains(alongTail, tolerance: 4))
    #expect(!plain.contains(alongTail, tolerance: 4))
    #expect(!tailed.contains(CGPoint(x: 150, y: 110), tolerance: 4))
    // A tip inside the badge draws no tail, so it adds nothing to the bounds or the hit.
    let hidden = badge(tip: CGPoint(x: 105, y: 100))
    #expect(hidden.bounds == plain.bounds)
    #expect(!hidden.contains(CGPoint(x: 150, y: 100), tolerance: 4))
  }

  @Test("Moving shifts the tip; the centre grip moves the badge, the tip grip the tip")
  func moveAndResize() {
    let tailed = badge(tip: tip)
    #expect(
      tailed.moved(by: CGVector(dx: 5, dy: -2)).shape
        == .step(center: CGPoint(x: 105, y: 98), tip: CGPoint(x: 205, y: 98)))
    let target = CGPoint(x: 120, y: 160)
    #expect(tailed.resized(.start, to: target).shape == .step(center: target, tip: tip))
    #expect(tailed.resized(.end, to: target).shape == .step(center: center, tip: target))
    let plain = badge(tip: nil)
    #expect(plain.resized(.end, to: target) == plain)
  }

  @Test("A press on the tail drags the badge; its grips come first on a selected one")
  func press() {
    let tailed = badge(tip: tip)
    let document = AnnotationDocument([tailed])
    let along = CGPoint(x: 150, y: 100)
    #expect(
      document.pressTarget(at: along, tool: .step, selectedID: nil) == .annotation(tailed.id))
    #expect(
      document.pressTarget(at: along, tool: .select, selectedID: nil) == .annotation(tailed.id))
    #expect(document.pressTarget(at: tip, tool: .step, selectedID: tailed.id) == .grip(.end))
    #expect(document.pressTarget(at: center, tool: .step, selectedID: tailed.id) == .grip(.start))
  }

  @Test("Numbering counts badges with tails like any other")
  func numbering() {
    let first = badge(tip: tip)
    let second = badge(tip: nil)
    let document = AnnotationDocument([first, second])
    #expect(document.stepNumber(of: first.id) == 1)
    #expect(document.stepNumber(of: second.id) == 2)
  }

  @Test("Stepping the size moves twentieths of its range and clamps at both ends")
  func strokeSteps() {
    #expect(abs(AnnotationStroke(0.5).stepped(by: 1).value - 0.55) < 1e-9)
    #expect(abs(AnnotationStroke(0.5).stepped(by: -5).value - 0.25) < 1e-9)
    #expect(AnnotationStroke(0.98).stepped(by: 1) == AnnotationStroke(1))
    #expect(AnnotationStroke(0.02).stepped(by: -1) == AnnotationStroke(0))
  }

  @Test("Translating a document moves every annotation and round-trips")
  func translation() {
    let text = Annotation(
      shape: .text("Hi", frame: CGRect(x: 10, y: 20, width: 30, height: 10)), style: style)
    let document = AnnotationDocument([text, badge(tip: tip)])
    let offset = CGVector(dx: -7, dy: 3)
    let moved = document.translated(by: offset)
    #expect(
      moved.annotations[0].shape == .text("Hi", frame: CGRect(x: 3, y: 23, width: 30, height: 10)))
    #expect(moved.annotations.map(\.id) == document.annotations.map(\.id))
    #expect(moved.translated(by: CGVector(dx: 7, dy: -3)) == document)
  }
}
