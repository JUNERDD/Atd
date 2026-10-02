import CoreGraphics
import Foundation
import Testing

@testable import AICore

@Suite("Annotation document, paths and tools")
struct AnnotationDocumentTests {
  let style = AnnotationStyle()

  @Test("Hit-testing prefers the front-most annotation")
  func frontMostHit() {
    let back = Annotation(shape: .mosaic(CGRect(x: 0, y: 0, width: 50, height: 50)), style: style)
    let front = Annotation(shape: .step(center: CGPoint(x: 25, y: 25)), style: style)
    var document = AnnotationDocument([back, front])
    #expect(document.hit(at: CGPoint(x: 25, y: 25), tolerance: 2) == front.id)
    #expect(document.hit(at: CGPoint(x: 2, y: 2), tolerance: 2) == back.id)
    #expect(document.hit(at: CGPoint(x: 80, y: 80), tolerance: 2) == nil)
    document.remove(front.id)
    #expect(document.hit(at: CGPoint(x: 25, y: 25), tolerance: 2) == back.id)
  }

  @Test("Step badges number in creation order and renumber when one is removed")
  func stepNumbers() {
    let steps = (0..<3).map { Annotation(shape: .step(center: CGPoint(x: $0, y: 0)), style: style) }
    let other = Annotation(shape: .rectangle(.zero), style: style)
    var document = AnnotationDocument([steps[0], other, steps[1], steps[2]])
    #expect(steps.map { document.stepNumber(of: $0.id) } == [1, 2, 3])
    #expect(document.stepNumber(of: other.id) == nil)
    document.remove(steps[0].id)
    #expect(document.stepNumber(of: steps[2].id) == 2)
  }

  @Test("Updating keeps an annotation's place in the z-order")
  func updateKeepsOrder() {
    let first = Annotation(shape: .step(center: .zero), style: style)
    let second = Annotation(shape: .step(center: .zero), style: style)
    var document = AnnotationDocument([first, second])
    document.update(first.moved(by: CGVector(dx: 1, dy: 1)))
    #expect(document.annotations.map(\.id) == [first.id, second.id])
    #expect(document[first.id]?.shape == .step(center: CGPoint(x: 1, y: 1)))
  }

  @Test("Shift-drags make squares and snap lines to 45 degrees")
  func dragConstraints() {
    let start = CGPoint(x: 10, y: 10)
    #expect(
      AnnotationPath.dragRect(from: start, to: CGPoint(x: 0, y: 40), square: true)
        == CGRect(x: -20, y: 10, width: 30, height: 30))
    #expect(
      AnnotationPath.dragRect(from: start, to: CGPoint(x: 0, y: 40), square: false)
        == CGRect(x: 0, y: 10, width: 10, height: 30))
    let end = AnnotationPath.dragEnd(from: .zero, to: CGPoint(x: 10, y: 1), snap: true)
    #expect(abs(end.y) < 0.0001)
    #expect(abs(end.x - hypot(10, 1)) < 0.0001)
  }

  @Test("Clicks without a drag do not leave shapes")
  func substantialShapes() {
    #expect(!AnnotationPath.isSubstantial(.rectangle(CGRect(x: 0, y: 0, width: 2, height: 40))))
    #expect(AnnotationPath.isSubstantial(.rectangle(CGRect(x: 0, y: 0, width: 3, height: 3))))
    #expect(!AnnotationPath.isSubstantial(.arrow(from: .zero, to: CGPoint(x: 1, y: 1))))
    #expect(!AnnotationPath.isSubstantial(.text(" \n", frame: .zero)))
    #expect(AnnotationPath.isSubstantial(.pen([.zero])))
  }

  @Test("The arrow head points at the tip and the shaft ends inside it")
  func arrowHead() throws {
    let arrow = try #require(
      AnnotationPath.arrow(from: .zero, to: CGPoint(x: 100, y: 0), lineWidth: 4))
    let length = AnnotationPath.arrowHeadLength(lineWidth: 4)
    #expect(arrow.head[0] == CGPoint(x: 100, y: 0))
    #expect(abs(arrow.head[1].x - (100 - length)) < 0.0001)
    #expect(abs(arrow.head[1].y + arrow.head[2].y) < 0.0001)
    #expect(arrow.shaftEnd.x > 100 - length && arrow.shaftEnd.x < 100)
    let short = try #require(
      AnnotationPath.arrow(from: .zero, to: CGPoint(x: 10, y: 0), lineWidth: 7))
    #expect(abs(short.head[1].x - 4) < 0.0001)
    #expect(AnnotationPath.arrow(from: .zero, to: .zero, lineWidth: 4) == nil)
  }

  @Test("Freehand samples drop jitter and smooth through midpoints")
  func penSmoothing() {
    var points = AnnotationPath.appending(.zero, to: [])
    points = AnnotationPath.appending(CGPoint(x: 1, y: 0), to: points)
    #expect(points == [.zero])
    points = AnnotationPath.appending(CGPoint(x: 10, y: 0), to: points)
    points = AnnotationPath.appending(CGPoint(x: 10, y: 10), to: points)
    #expect(
      AnnotationPath.smoothed(points) == [
        .move(.zero), .quad(to: CGPoint(x: 10, y: 5), control: CGPoint(x: 10, y: 0)),
        .line(CGPoint(x: 10, y: 10)),
      ])
    #expect(
      AnnotationPath.smoothed([CGPoint(x: 3, y: 3)]) == [
        .move(CGPoint(x: 3, y: 3)), .line(CGPoint(x: 3, y: 3)),
      ])
    #expect(AnnotationPath.smoothed([]).isEmpty)
  }

  @Test("Every measure grows with the size, which stays within 0...1")
  func strokeMeasures() {
    let smallest = AnnotationStroke(0)
    let largest = AnnotationStroke(1)
    #expect(smallest.lineWidth == 1 && largest.lineWidth == 11)
    #expect(smallest.mosaicBlock == 3 && largest.mosaicBlock == 33)
    #expect(smallest.blurRadius == 1 && largest.blurRadius == 31)
    // The default is the former medium width exactly.
    #expect(AnnotationStroke.default.lineWidth == 4 && AnnotationStroke.default.fontSize == 22)
    #expect(smallest.fontSize < AnnotationStroke.default.fontSize)
    #expect(AnnotationStroke(7) == largest)
    #expect(AnnotationStroke(-1) == smallest)
    #expect(AnnotationStroke(.nan) == .default)
  }

  @Test("A style bar change replaces only the part it names")
  func partialRestyle() {
    let thick = AnnotationStroke(0.6)
    let thin = AnnotationStroke(0.1)
    let style = AnnotationStyle(color: .blue, stroke: thick, textBackground: true)
    #expect(
      style.with(color: .red)
        == AnnotationStyle(color: .red, stroke: thick, textBackground: true))
    #expect(
      style.with(stroke: thin)
        == AnnotationStyle(color: .blue, stroke: thin, textBackground: true))
    #expect(AnnotationStyleChange(textBackground: false).applied(to: style).color == .blue)
    #expect(!AnnotationStyleChange(textBackground: false).applied(to: style).textBackground)
    #expect(style.with() == style)
  }

  @Test("Tool shortcuts follow D9 in either case and ignore other keys")
  func toolKeys() {
    #expect(AnnotationTool(key: "R") == .rectangle)
    #expect(AnnotationTool(key: "o") == .ellipse)
    #expect(AnnotationTool(key: "n") == .step)
    #expect(AnnotationTool(key: "S") == .spotlight)
    #expect(AnnotationTool(key: "v") == .select)
    #expect(AnnotationTool(key: "x") == nil)
    #expect(AnnotationTool(key: "rr") == nil)
    #expect(Set(AnnotationTool.allCases.map(\.key)).count == AnnotationTool.allCases.count)
  }

  @Test("Toolbar and style bar stack below, above (clear of the size label), or inside")
  func toolbarPlacement() {
    let display = CGRect(x: 0, y: 0, width: 1000, height: 800)
    let bar = CGSize(width: 300, height: 40)
    let style = CGSize(width: 200, height: 40)
    func frames(_ selection: CGRect) -> (toolbar: CGRect, styleBar: CGRect) {
      AnnotationToolbarLayout.frames(
        toolbar: bar, styleBar: style, beside: selection, within: display)
    }
    let middle = frames(CGRect(x: 400, y: 200, width: 300, height: 200))
    #expect(middle.toolbar == CGRect(x: 400, y: 408, width: 300, height: 40))
    #expect(middle.styleBar == CGRect(x: 400, y: 454, width: 200, height: 40))
    // 86 pt of bars do not fit under y 700, so the block goes above, clear of the size label
    // (600 − 30 − 8 = 562 for its bottom), the style bar outermost: 562 − 86 = 476.
    let low = frames(CGRect(x: 400, y: 600, width: 300, height: 100))
    #expect(low.styleBar.minY == 476)
    #expect(low.toolbar.minY == low.styleBar.maxY + 6)
    #expect(low.toolbar.maxY == 562)
    let full = frames(CGRect(x: 0, y: 0, width: 1000, height: 800))
    #expect(full.toolbar == CGRect(x: 692, y: 752, width: 300, height: 40))
    #expect(full.styleBar == CGRect(x: 692, y: 706, width: 200, height: 40))
    // The style bar keeps the toolbar's leading edge unless that would leave the display.
    let leftEdge = frames(CGRect(x: 0, y: 100, width: 100, height: 100))
    #expect(leftEdge.toolbar.minX == 8)
    #expect(leftEdge.styleBar.minX == 8)
    let rightEdge = frames(CGRect(x: 880, y: 100, width: 100, height: 100))
    #expect(rightEdge.styleBar.maxX <= 992)
  }
}
