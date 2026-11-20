import CoreGraphics
import Foundation
import Testing

@testable import AICore

@Suite("Curved lines/arrows, mosaic brush redaction, and multi-select document operations")
struct AnnotationCurvesMultiSelectTests {
  @Test("Curved lines/arrows support midpoint bend handles, hit-testing, and straightening")
  func curvedLineAndArrowBend() {
    let straight = Annotation(
      shape: .arrow(from: CGPoint(x: 0, y: 0), to: CGPoint(x: 100, y: 0), bend: nil),
      style: AnnotationStyle())
    #expect(straight.curveBendHandlePoint == CGPoint(x: 50, y: 0))
    #expect(straight.interactiveHandles.contains { $0.handle == .bend })

    // Pull midpoint downward by 40pt: quad peak B(0.5) should equal (50, 40) -> control (50, 80).
    let bent = straight.resized(.bend, to: CGPoint(x: 50, y: 40), constrained: false)
    #expect(bent.curveBendHandlePoint == CGPoint(x: 50, y: 40))
    #expect(bent.contains(CGPoint(x: 50, y: 40), tolerance: 4))
    #expect(!bent.contains(CGPoint(x: 50, y: 0), tolerance: 4))

    // Pull back within 4pt of chord midpoint -> straightens (`bend == nil`).
    let straightened = bent.resized(.bend, to: CGPoint(x: 51, y: 2), constrained: false)
    #expect(straightened.shape.bendPoint == nil)
  }

  @Test("Mosaic brush contributes to bounds, hit testing, ScreenContext, and LongScreenshotKept")
  func mosaicBrushAndRedaction() {
    let style = AnnotationStyle(stroke: AnnotationStroke(0.5), redaction: .blur, mosaicMode: .brush)
    let brush = Annotation(
      shape: .mosaicBrush([CGPoint(x: 20, y: 30), CGPoint(x: 80, y: 50)]),
      style: style)
    let half = style.stroke.highlighterWidth / 2
    #expect(
      brush.bounds == CGRect(x: 20, y: 30, width: 60, height: 20).insetBy(dx: -half, dy: -half))
    #expect(brush.contains(CGPoint(x: 50, y: 40), tolerance: 2))
    #expect(!brush.contains(CGPoint(x: 50, y: 40 + half + 20), tolerance: 2))

    let moved = brush.moved(by: CGVector(dx: 10, dy: 15))
    #expect(moved.shape.mosaicBrushPoints == [CGPoint(x: 30, y: 45), CGPoint(x: 90, y: 65)])

    let doc = AnnotationDocument([brush])
    let areas = ScreenContext.redactedAreas(of: doc, selection: CGSize(width: 200, height: 200))
    #expect(areas.count == 1)
    #expect(areas[0].minX < 20.0 / 200.0)
    #expect(areas[0].maxX > 80.0 / 200.0)

    let keptIn = LongScreenshotKept(top: 0, bottom: 100, annotations: doc)
    #expect(keptIn.redactedAreas.count == 1)
    #expect(keptIn.redacts)

    let keptOut = LongScreenshotKept(top: 200, bottom: 400, annotations: doc)
    #expect(!keptOut.redacts)
  }

  @Test("LongScreenshot askKey reflects curved bends, mosaicBrush, spotlightDim, and step format")
  func askKeyDistinguishesUpgrades() {
    let baseArrow = Annotation(
      shape: .arrow(from: .zero, to: CGPoint(x: 80, y: 0), bend: nil),
      style: AnnotationStyle())
    let bentArrow = Annotation(
      shape: .arrow(from: .zero, to: CGPoint(x: 80, y: 0), bend: CGPoint(x: 40, y: -30)),
      style: AnnotationStyle())
    let brush = Annotation(
      shape: .mosaicBrush([CGPoint(x: 10, y: 10), CGPoint(x: 40, y: 20)]),
      style: AnnotationStyle())

    let doc1 = AnnotationDocument([baseArrow, brush], spotlightDim: 0.5, stepFormat: .numbers)
    let doc2 = AnnotationDocument([bentArrow, brush], spotlightDim: 0.5, stepFormat: .numbers)
    let doc3 = AnnotationDocument([baseArrow, brush], spotlightDim: 0.7, stepFormat: .letters)
    #expect(doc1.askKey != doc2.askKey)
    #expect(doc1.askKey != doc3.askKey)
  }

  @Test(
    "Document multi-select supports marquee hit, duplicate, z-order, snap, resize, and text refit")
  func multiSelectOperations() {
    let a = Annotation(
      shape: .rectangle(CGRect(x: 10, y: 10, width: 40, height: 40)),
      style: AnnotationStyle())
    let b = Annotation(
      shape: .rectangle(CGRect(x: 100, y: 10, width: 40, height: 40)),
      style: AnnotationStyle())
    let t = Annotation(
      shape: .text("Hello", frame: CGRect(x: 200, y: 200, width: 30, height: 16)),
      style: AnnotationStyle(fontFamily: "Inter"))
    var doc = AnnotationDocument([a, b, t])

    let hit = doc.ids(intersecting: CGRect(x: 0, y: 0, width: 60, height: 60))
    #expect(hit == Set([a.id]))

    doc.bringToFront([a.id])
    #expect(doc.annotations.last?.id == a.id)
    doc.sendToBack([a.id])
    #expect(doc.annotations.first?.id == a.id)

    let dupes = doc.duplicate([a.id], offset: CGVector(dx: 15, dy: 5))
    #expect(dupes.count == 1)
    if let dupeID = dupes.first, let dupe = doc[dupeID] {
      #expect(dupe.shape == .rectangle(CGRect(x: 25, y: 15, width: 40, height: 40)))
      #expect(dupe.bounds == CGRect(x: 23, y: 13, width: 44, height: 44))
      doc.remove(dupes)
    }

    // Proposed move places `a`'s bounds minX at 95, within 5pt of `b`'s bounds minX (98) -> snaps +3pt.
    let snapped = doc.snapOffset(
      for: [a.id],
      proposedDelta: CGVector(dx: 87, dy: 0),
      in: CGRect(x: 0, y: 0, width: 400, height: 400),
      threshold: 5)
    #expect(snapped.delta.dx == 90)
    #expect(
      snapped.guides.contains { guide in
        if case .vertical(let x, _) = guide { return x == 98 }
        return false
      })

    if let groupBounds = doc.unionBounds(of: [a.id, b.id]) {
      doc.resizeGroup(
        [a, b],
        from: groupBounds,
        handle: .bottomRight,
        to: CGPoint(x: groupBounds.minX + groupBounds.width * 2, y: groupBounds.maxY))
      if case .rectangle(let rect)? = doc[b.id]?.shape {
        #expect(abs(rect.width - 80) < 0.5)
      } else {
        Issue.record("Expected resized rectangle for b")
      }
      #expect(abs((doc[b.id]?.bounds.width ?? 0) - 84) < 0.5)
    }

    let refitted = doc.refitTextAnnotations(fontFamily: "Inter") { _, _, _ in
      CGSize(width: 72, height: 24)
    }
    #expect(refitted)
    #expect(doc[t.id]?.bounds.size == CGSize(width: 72, height: 24))
  }
}
