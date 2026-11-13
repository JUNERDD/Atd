import AICore
import AppKit
import SwiftUI
import Testing

@testable import AIShell

// Keep persistent measurement-host parity checks in the same serialized suite as island layout.
extension IslandResultTests {
  @Test("Reused measurement host and direct TextKit measures match fresh NSHostingView")
  func measureParity() {
    let controller = IslandController()
    controller.model.labels = labels("en")
    let samples = [
      "Hi",
      String(repeating: "A longer streaming paragraph with wrapping words. ", count: 12),
      "Short again",
      "Line 1\nLine 2\nLine 3\nLine 4",
    ]
    for sample in samples {
      let textView = IslandAnswerText(text: sample)
      let freshIdeal = NSHostingView(rootView: textView.fixedSize()).fittingSize.width
      #expect(abs(IslandAnswerText.measuredIdealWidth(text: sample) - freshIdeal) < 0.5)

      for width in [300.0, 420.0, 560.0] {
        let framed = textView.frame(width: width).fixedSize(horizontal: false, vertical: true)
        let freshHeight = NSHostingView(rootView: framed).fittingSize.height
        #expect(
          abs(IslandAnswerText.measuredHeight(text: sample, width: width) - freshHeight) < 0.5)
        #expect(abs(IslandController.height(of: textView, width: width) - freshHeight) < 0.5)
      }

      let offer = AnswerWriteOffer(app: "Editor", replaces: false)
      controller.model.answerOffer = offer
      let answer = IslandAnswer(text: sample, streaming: false)
      let card = IslandAnswerCard(
        model: controller.model, command: "Summarize", answer: answer, note: "Selection note",
        offer: offer)
      let freshProbeWidth = NSHostingView(rootView: card.widthProbe.fixedSize()).fittingSize.width
      let measured = controller.measure(
        .answer(command: "Summarize", answer: answer, note: "Selection note"))
      let expectedWidth = controller.resultCardWidth(ideal: freshProbeWidth)
      #expect(abs(measured.size.width - expectedWidth) < 0.5)
    }
  }

  @Test("Review single-pass measurement matches full-card NSHostingView across states")
  func reviewMeasureParity() {
    let controller = IslandController()
    controller.model.labels = labels("en")
    let offer = AnswerWriteOffer(app: "Editor", replaces: false)
    controller.model.answerOffer = offer
    let diff: [CommandProgressState.Review.Change] = [
      .init(kind: .delete, text: "Old phrasing"),
      .init(kind: .insert, text: "New clearer phrasing across multiple words."),
    ]
    let cases: [(answer: String, review: CommandProgressState.Review, showsChanges: Bool)] = [
      (
        "Hello world",
        .init(
          source: "Original text", changes: nil, version: 1, count: 1, options: [], summary: nil,
          adjustments: ["Shorter"], pending: nil),
        false
      ),
      (
        "   ",
        .init(
          source: "Original text", changes: nil, version: 2, count: 1, options: [], summary: nil,
          adjustments: ["Shorter"], pending: .regenerate),
        false
      ),
      (
        "New clearer phrasing across multiple words.",
        .init(
          source: "Old phrasing", changes: diff, version: 1, count: 1, options: [], summary: nil,
          adjustments: ["Formal"], pending: nil),
        true
      ),
      (
        "New clearer phrasing across multiple words.",
        .init(
          source: "Old phrasing", changes: diff, version: 1, count: 1, options: [], summary: nil,
          adjustments: ["Formal"], pending: nil),
        false
      ),
    ]
    for (index, item) in cases.enumerated() {
      controller.model.review.showsChanges = item.showsChanges
      let measured = controller.measure(
        .review(
          command: "Rewrite", answer: item.answer, note: "Selection note", review: item.review))
      let card = IslandReviewCard(
        model: controller.model, command: "Rewrite", answer: item.answer, note: "Selection note",
        review: item.review, offer: offer)
      let probeWidth = NSHostingView(rootView: card.widthProbe.fixedSize()).fittingSize.width
      let expectedWidth = controller.resultCardWidth(ideal: probeWidth)
      let framed = card.frame(width: expectedWidth).fixedSize(horizontal: false, vertical: true)
      let fullHeight = NSHostingView(rootView: framed).fittingSize.height
      let expectedHeight = IslandMetrics.reviewCardHeight(natural: fullHeight)
      #expect(
        abs(measured.size.width - expectedWidth) < 0.5,
        "case \(index) width: \(measured.size.width) vs \(expectedWidth)")
      #expect(
        abs(measured.size.height - expectedHeight) < 0.5,
        "case \(index) height: \(measured.size.height) vs \(expectedHeight)")
    }
  }

  @Test("CaptureResultMeasure single-pass size matches full panel NSHostingView")
  func captureResultMeasureParity() {
    let paragraph = CaptureTextParagraph(lines: [
      (text: "Picked sentence", box: CGRect(x: 0, y: 0, width: 120, height: 18))
    ])
    var answerRun = CaptureTextRun(
      id: "ct-answer", commandId: "summarize", command: "Summarize",
      scope: CaptureTextScope(kind: .picked, count: 1),
      paragraphs: [paragraph], output: .card)
    _ = answerRun.apply(
      CaptureTextProgressParams(
        runId: answerRun.id, state: .done, output: .card,
        text: "Line 1\nLine 2\n" + String(repeating: "Wrapped sentence. ", count: 10),
        result: nil, awaitsApply: false, review: nil, draft: nil),
      in: AnnotationDocument())
    var replaceRun = CaptureTextRun(
      id: "ct-replace", commandId: "fix", command: "Fix Grammar",
      scope: CaptureTextScope(kind: .picked, count: 1),
      paragraphs: [paragraph], output: .replaceSelection)
    _ = replaceRun.apply(
      CaptureTextProgressParams(
        runId: replaceRun.id, state: .done, output: .replaceSelection, text: "",
        result: .init(
          lead: "",
          items: [
            .init(
              paragraph: replaceRun.paragraphs[0].id, tool: .replace, phrase: nil,
              text: "Fixed line")
          ]),
        awaitsApply: false, review: nil, draft: nil),
      in: AnnotationDocument())

    let model = CaptureResultCardModel()
    for run in [answerRun, replaceRun] {
      let card = CaptureResultCard(run: run, document: AnnotationDocument())
      model.show(card)
      let measured = CaptureResultMeasure.size(of: model)
      let width = CaptureResultPlacement.cardWidth
      let fullPanel = CaptureResultPanel(model: model, card: card, height: nil)
        .frame(width: width).fixedSize(horizontal: false, vertical: true)
      let expectedFullHeight = NSHostingView(rootView: fullPanel).fittingSize.height
      let limit = min(IslandMetrics.maxShape.height, model.heightLimit)
      #expect(measured.size.width == width)
      #expect(abs(measured.size.height - min(expectedFullHeight.rounded(.up), limit)) <= 1.0)
    }
  }
}
