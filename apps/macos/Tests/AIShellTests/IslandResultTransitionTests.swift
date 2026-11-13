import AICore
import AppKit
import Testing

@testable import AIShell

extension IslandResultTests {
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

    try await waitForRest(controller)
    #expect(controller.model.arrived)
    #expect(controller.model.layoutMotion == .fixed)

    // Reflowing review update turns on `.interpolated` during motion, then resets to `.fixed`.
    controller.show(
      reviewContent(answer: String(repeating: "Another longer version.\n", count: 8)))
    #expect(controller.model.layoutMotion == .interpolated)
    let updatedSize = try #require(controller.size)
    try await waitForRest(controller)
    #expect(controller.model.layoutMotion == .fixed)
    #expect(controller.model.canvas == IslandMetrics.canvas(fitting: updatedSize))
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
    try await waitForRest(controller)
    #expect(controller.model.arrived)
    #expect(controller.window.hoverReady)
    #expect(controller.model.layoutMotion == .fixed)

    controller.hide()
    #expect(!controller.window.hoverReady)
    #expect(controller.model.layers.isEmpty)

    controller.show(reviewContent(answer: "Second appearance"))
    #expect(controller.model.appearance == firstAppearance + 1)
    #expect(!controller.window.hoverReady)
    try await waitForRest(controller)
    #expect(controller.model.arrived)
    #expect(controller.window.hoverReady)
  }

  // CI can delay the first frame; observe the same rest state the controller publishes.
  private func waitForRest(_ controller: IslandController) async throws {
    let deadline = ContinuousClock.now + .seconds(5)
    while !controller.model.arrived || controller.model.shape.animation != nil,
      ContinuousClock.now < deadline
    {
      try await Task.sleep(for: .milliseconds(10))
    }
    try #require(controller.model.arrived && controller.model.shape.animation == nil)
  }
}
