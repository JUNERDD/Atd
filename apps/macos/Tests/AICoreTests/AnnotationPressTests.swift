import CoreGraphics
import Foundation
import Testing

@testable import AICore

@Suite("Annotation press targets (D15)")
struct AnnotationPressTests {
  let style = AnnotationStyle()
  /// A frame from (100, 100) to (300, 200), a badge drawn inside it later, and a text label.
  let frame: Annotation
  let badge: Annotation
  let label: Annotation
  let pen: Annotation
  let document: AnnotationDocument

  init() {
    frame = Annotation(
      shape: .rectangle(CGRect(x: 100, y: 100, width: 200, height: 100)), style: style)
    badge = Annotation(shape: .step(center: CGPoint(x: 150, y: 150)), style: style)
    label = Annotation(
      shape: .text("Hi", frame: CGRect(x: 400, y: 100, width: 40, height: 20)), style: style)
    pen = Annotation(
      shape: .pen([CGPoint(x: 500, y: 300), CGPoint(x: 600, y: 300)]), style: style)
    document = AnnotationDocument([frame, badge, label, pen])
  }

  func target(_ x: CGFloat, _ y: CGFloat, _ tool: AnnotationTool, selected: Annotation? = nil)
    -> AnnotationPressTarget
  {
    document.pressTarget(at: CGPoint(x: x, y: y), tool: tool, selectedID: selected?.id)
  }

  @Test("The selected annotation's grips win whatever the tool")
  func grips() {
    for tool in AnnotationTool.allCases {
      #expect(target(302, 198, tool, selected: frame) == .grip(.bottomRight))
    }
  }

  @Test("A selected annotation drags from anywhere in its padded bounds")
  func selectedBounds() {
    #expect(target(250, 180, .select, selected: frame) == .annotation(frame.id))
    #expect(target(250, 180, .rectangle, selected: frame) == .annotation(frame.id))
    #expect(target(250, 180, .text, selected: frame) == .annotation(frame.id))
    #expect(target(250, 205, .arrow, selected: frame) == .annotation(frame.id))
    #expect(target(250, 210, .arrow, selected: frame) == .canvas)
  }

  @Test("An annotation in front of the selected one stays reachable by its body")
  func frontOfSelected() {
    #expect(target(150, 150, .select, selected: frame) == .annotation(badge.id))
    #expect(target(150, 150, .ellipse, selected: frame) == .annotation(badge.id))
    // The selected badge keeps its box over the frame's outline behind it.
    #expect(target(150, 150, .select, selected: badge) == .annotation(badge.id))
  }

  @Test("Unselected: the select tool takes the whole box, drawing tools only the body")
  func unselected() {
    #expect(target(250, 180, .select) == .annotation(frame.id))
    #expect(target(250, 180, .rectangle) == .canvas)
    #expect(target(100, 180, .rectangle) == .annotation(frame.id))
    #expect(target(150, 150, .mosaic) == .annotation(badge.id))
    #expect(target(420, 110, .arrow) == .annotation(label.id))
    #expect(target(700, 700, .select) == .canvas)
  }

  @Test("Pen and highlighter draw over everything but drag the selected one by its stroke")
  func freehand() {
    #expect(target(100, 180, .pen) == .canvas)
    #expect(target(150, 150, .highlighter) == .canvas)
    #expect(target(550, 300, .pen, selected: pen) == .annotation(pen.id))
    #expect(target(550, 290, .pen, selected: pen) == .canvas)
    #expect(target(250, 180, .highlighter, selected: frame) == .canvas)
  }

  @Test("The text tool opens text, drags the selected annotation, else starts new text")
  func textTool() {
    #expect(target(420, 110, .text) == .text(label.id))
    #expect(target(420, 110, .text, selected: frame) == .text(label.id))
    #expect(target(100, 180, .text) == .canvas)
    #expect(target(700, 700, .text) == .canvas)
  }
}
