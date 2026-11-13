import AICore
import AppKit
import SwiftUI
import Testing

@testable import AIShell

@MainActor
@Suite("Island result layout and transitions", .serialized, .enabled(if: !NSScreen.screens.isEmpty))
struct IslandResultTests {
  private func labels(_ language: String) -> IslandLabels {
    var labels = IslandLabels.current()
    labels.copy = language == "en" ? "Copy" : "复制"
    labels.close = language == "en" ? "Close" : "关闭"
    labels.openInAtd = language == "en" ? "Open in Atd" : "在 Atd 中打开"
    labels.insert = language == "en" ? "Insert" : "插入"
    labels.replace = language == "en" ? "Replace" : "替换"
    labels.review.stop = language == "en" ? "Stop" : "停止"
    labels.keyMove = language == "en" ? "Move" : "移动"
    labels.review.keyInput = language == "en" ? "Input" : "输入"
    labels.review.keySelect = language == "en" ? "Select" : "选择"
    return labels
  }

  @Test("Result actions stay on one row in both languages", arguments: ["en", "zh"])
  func footerLayout(_ language: String) {
    let model = IslandModel()
    model.labels = labels(language)
    for mode in ["copy", "insert", "replace", "pending"] {
      let offer = mode == "copy" ? nil : AnswerWriteOffer(app: "Editor", replaces: mode != "insert")
      let footer = IslandResultFooter(
        model: model, offer: offer, pending: mode == "pending", showsOptionHint: true)
      model.reviewChip = nil
      let ideal = NSHostingView(rootView: footer.widthProbe).fittingSize.width
      model.reviewChip = 0
      let focused = NSHostingView(rootView: footer.widthProbe).fittingSize.width
      #expect(abs(focused - ideal) < 0.5)
      for width in [320.0, 420.0, 496.0, 560.0, 640.0] {
        let inner = width - IslandMetrics.cardPadding * 2
        let view = footer.frame(width: inner).fixedSize(horizontal: false, vertical: true)
        let measured = NSHostingView(rootView: view).fittingSize
        #expect(abs(measured.width - inner) < 1)
        #expect(abs(measured.height - IslandMetrics.footerHeight) < 0.5)
      }
    }
  }

  @Test(
    "Result measurement reserves the full footer even for a short answer", arguments: ["en", "zh"])
  func cardWidth(_ language: String) {
    let controller = IslandController()
    controller.model.labels = labels(language)
    controller.model.answerOffer = AnswerWriteOffer(app: "Editor", replaces: true)
    let footer = IslandResultFooter(model: controller.model, offer: controller.model.answerOffer)
    let required =
      NSHostingView(rootView: footer.widthProbe).fittingSize.width
      + IslandMetrics.cardPadding * 2
    let answer = controller.measure(
      .answer(command: "Translate", answer: IslandAnswer(text: "Hello"), note: nil))
    let review = controller.measure(reviewContent())
    #expect(answer.size.width >= required)
    #expect(review.size.width >= required)
    #expect(answer.size.width <= IslandMetrics.maxShape.width)
    #expect(review.size.width <= IslandMetrics.maxShape.width)
    let text = IslandAnswerText(
      text: String(repeating: "A readable line of text. 正文保持阅读宽度。", count: 20))
    let capped = IslandController.height(of: text, width: IslandMetrics.resultTextWidth)
    let wide = IslandController.height(of: text, width: IslandMetrics.maxShape.width)
    let narrow = IslandController.height(of: text, width: IslandMetrics.minCardWidth)
    #expect(abs(wide - capped) < 0.5)
    #expect(narrow > capped)
  }

  @Test("An editable focus arriving during entrance keeps the spring and the departing footer")
  func editableEntranceAndExit() async throws {
    let controller = IslandController()
    controller.model.labels = labels("en")
    controller.model.reduceMotion = false
    defer { controller.hide() }
    controller.show(reviewContent())
    let initialWidth = try #require(controller.size?.width)
    let offer = AnswerWriteOffer(app: "Editor", replaces: true)
    controller.model.answerOffer = offer
    controller.show(reviewContent())
    #expect(try #require(controller.size?.width) > initialWidth)
    #expect(controller.model.layers.last?.scales == true)
    #expect(controller.model.layers.last?.answerOffer == offer)
    try await Task.sleep(for: .milliseconds(40))
    #expect(controller.model.shape.animation != nil)

    controller.show(
      reviewContent(answer: String(repeating: "A longer line of text.\n", count: 15)), inPlace: true
    )
    #expect(controller.model.layers.last?.scales == false)
    let rest = controller.model.shape.frame
    controller.model.answerOffer = nil
    controller.exit()
    #expect(controller.model.layers.last?.scales == true)
    #expect(controller.model.layers.last?.answerOffer == offer)
    #expect(controller.model.shape.frame.width < rest.width)
    #expect(!controller.window.acceptsPointerEvents)

    controller.model.answerOffer = offer
    controller.show(reviewContent())
    #expect(controller.model.layers.last?.scales == true)
    #expect(controller.window.acceptsPointerEvents)
    try await Task.sleep(for: .milliseconds(250))
    #expect(controller.window.isVisible)
    #expect(controller.content?.kind == .review)
  }

  @Test("A departing result retains its write actions when the next content clears live focus")
  func morphKeepsFooter() {
    let controller = IslandController()
    controller.model.labels = labels("en")
    let offer = AnswerWriteOffer(app: "Editor", replaces: true)
    controller.model.answerOffer = offer
    defer { controller.hide() }
    controller.show(reviewContent())
    let leaving = controller.model.layers.last?.id
    controller.model.answerOffer = nil
    controller.show(.copied)
    #expect(controller.model.layers.first(where: { $0.id == leaving })?.answerOffer == offer)
    #expect(controller.model.layers.last?.answerOffer == nil)
  }

  @Test("Reduce Motion leaves the shape still while the result fades out")
  func reducedMotion() {
    let controller = IslandController()
    controller.model.reduceMotion = true
    defer { controller.hide() }
    controller.show(reviewContent())
    let frame = controller.model.shape.frame
    controller.exit()
    #expect(controller.model.shape.frame == frame)
  }

  @Test("Settled island resets layout motion to fixed and trims canvas to active shape")
  func settledCanvasAndLayoutMotion() async throws {
    let controller = IslandController()
    controller.model.labels = labels("en")
    controller.model.reduceMotion = false
    defer { controller.hide() }

    controller.show(reviewContent())
    #expect(controller.model.layoutMotion == .fixed)
    let initialSize = try #require(controller.size)
    #expect(controller.model.canvas == IslandMetrics.canvas(fitting: initialSize))

    // Wait for entrance to settle (`model.arrived == true`)
    try await Task.sleep(for: .milliseconds(800))
    #expect(controller.model.arrived)
    #expect(controller.model.layoutMotion == .fixed)

    // Reflowing review update turns on `.interpolated` during motion, then resets to `.fixed`.
    controller.show(
      reviewContent(answer: String(repeating: "Another longer version.\n", count: 8)))
    #expect(controller.model.layoutMotion == .interpolated)
    let updatedSize = try #require(controller.size)
    try await Task.sleep(for: .milliseconds(800))
    #expect(controller.model.layoutMotion == .fixed)
    #expect(controller.model.canvas == IslandMetrics.canvas(fitting: updatedSize))
  }

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

  @Test("Warm-up, repeated appear, and morph from working settle hoverReady")
  func appearanceAndHoverReadyTransitions() async throws {
    let controller = IslandController()
    controller.model.labels = labels("en")
    controller.model.reduceMotion = false
    defer { controller.hide() }

    controller.warmUp()
    #expect(!controller.window.isVisible)

    controller.show(.working(command: "Summarize", summary: nil))
    let firstAppearance = controller.model.appearance
    #expect(!controller.window.hoverReady)
    controller.show(reviewContent())
    try await Task.sleep(for: .milliseconds(800))
    #expect(controller.model.arrived)
    #expect(controller.window.hoverReady)
    #expect(controller.model.layoutMotion == .fixed)

    controller.hide()
    #expect(!controller.window.hoverReady)
    #expect(controller.model.layers.isEmpty)

    controller.show(reviewContent(answer: "Second appearance"))
    #expect(controller.model.appearance == firstAppearance + 1)
    #expect(!controller.window.hoverReady)
    try await Task.sleep(for: .milliseconds(800))
    #expect(controller.model.arrived)
    #expect(controller.window.hoverReady)
  }

  private func reviewContent(answer: String = "Hello") -> IslandContent {
    .review(
      command: "Translate", answer: answer, note: nil,
      review: .init(
        source: "你好", changes: nil, version: 1, count: 1, options: [], summary: nil,
        adjustments: [], pending: nil))
  }
}
