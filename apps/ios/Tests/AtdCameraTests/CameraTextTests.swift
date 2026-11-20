import AtdAI
import CoreGraphics
import Testing

@Suite struct CameraTextTests {
  private func text(_ string: String, x: CGFloat, y: CGFloat, confidence: Float = 0.9)
    -> CameraRecognizedText
  {
    CameraRecognizedText(
      text: string, confidence: confidence,
      quad: CameraQuad(CGRect(x: x, y: y, width: 0.2, height: 0.05)))
  }

  @Test func visionCornersFlipToATopLeftOrigin() {
    let quad = CameraQuad(
      visionTopLeft: CGPoint(x: 0.1, y: 0.9), topRight: CGPoint(x: 0.5, y: 0.9),
      bottomRight: CGPoint(x: 0.5, y: 0.8), bottomLeft: CGPoint(x: 0.1, y: 0.8))
    #expect(quad.topLeft.y.isApproximately(0.1))
    #expect(quad.bottomLeft.y.isApproximately(0.2))
    #expect(quad.bounds.minY.isApproximately(0.1))
    #expect(quad.bounds.height.isApproximately(0.1))
  }

  @Test func linesAreNumberedRowByRowThenLeadingToTrailing() {
    // A menu: dish and price share a row; the price is listed first by Vision.
    let lines = CameraText.lines(from: [
      text("¥980", x: 0.7, y: 0.302),
      text("やきとり", x: 0.1, y: 0.3),
      text("居酒屋", x: 0.1, y: 0.1),
      text("ビール", x: 0.1, y: 0.5),
    ])
    #expect(lines.map(\.text) == ["居酒屋", "やきとり", "¥980", "ビール"])
    #expect(lines.map(\.id) == [1, 2, 3, 4])
  }

  @Test func unsureBlankAndExtraLinesAreDroppedAndLongOnesCut() {
    let long = String(repeating: "あ", count: 300)
    var recognized = [
      text("  ", x: 0.1, y: 0.1), text("maybe", x: 0.1, y: 0.2, confidence: 0.1),
      text(long, x: 0.1, y: 0.3),
    ]
    recognized += (0..<130).map { text("line \($0)", x: 0.1, y: 0.4 + CGFloat($0) * 0.001) }
    let lines = CameraText.lines(from: recognized)
    #expect(lines.count == CameraText.lineLimit)
    #expect(lines[0].text.count == CameraText.characterLimit)
    #expect(!lines.contains { $0.text == "maybe" })
  }

  @Test func listingNumbersEachLineForThePrompt() {
    let lines = CameraText.lines(from: [text("Menu", x: 0, y: 0), text("Tea ¥300", x: 0, y: 0.2)])
    #expect(CameraText.listing(lines) == "[1] Menu\n[2] Tea ¥300")
    #expect(!CameraText.listing([]).contains("[1]"))
  }

  @Test func validIdsNameExistingLinesOnce() {
    #expect(CameraText.valid([3, 0, 2, 3, 9, -1], lineCount: 4) == [3, 2])
    #expect(CameraText.valid([1], lineCount: 0).isEmpty)
  }
}

extension CGFloat {
  func isApproximately(_ other: CGFloat) -> Bool { abs(self - other) < 0.0001 }
}
