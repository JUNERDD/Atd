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
    let answer = controller.measure(.answer(command: "Translate", answer: "Hello", note: nil))
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

  private func reviewContent(answer: String = "Hello") -> IslandContent {
    .review(
      command: "Translate", answer: answer, note: nil,
      review: .init(
        source: "你好", changes: nil, version: 1, count: 1, options: [], summary: nil,
        adjustments: [], pending: nil))
  }
}
