import Testing

@testable import AICore

@Suite("Mini panel recovery")
struct MiniPanelRecoveryTests {
  @Test("A press whose button stays up for 0.1 s over three frames without its release ends")
  func lostRelease() {
    var watch = MiniPanelPressWatch()
    #expect(watch.update(pressing: true, dragging: false, buttonDown: true, at: 0) == .none)
    // The release of an ordinary click is still on its way: no end yet.
    #expect(watch.update(pressing: true, dragging: false, buttonDown: false, at: 1) == .none)
    #expect(watch.update(pressing: true, dragging: false, buttonDown: false, at: 1.05) == .none)
    #expect(watch.update(pressing: true, dragging: false, buttonDown: false, at: 1.09) == .none)
    #expect(watch.update(pressing: true, dragging: false, buttonDown: false, at: 1.1) == .endPress)
    // Once ended, the window holds no press.
    #expect(watch.update(pressing: false, dragging: false, buttonDown: false, at: 1.2) == .none)
  }

  @Test("After a stall, the event loop's turn between frames comes before any end")
  func stall() {
    var watch = MiniPanelPressWatch()
    #expect(watch.update(pressing: true, dragging: false, buttonDown: false, at: 0) == .none)
    // The app stalled for half a second: time alone is not enough.
    #expect(watch.update(pressing: true, dragging: false, buttonDown: false, at: 0.5) == .none)
    // The release arrived between the frames.
    #expect(watch.update(pressing: false, dragging: false, buttonDown: false, at: 0.52) == .none)
  }

  @Test("A lost drag comes to rest; a release that arrives in time ends nothing")
  func lostDrag() {
    var watch = MiniPanelPressWatch()
    for frame in 0..<3 {
      _ = watch.update(
        pressing: true, dragging: true, buttonDown: false, at: Double(frame) * 0.016)
    }
    #expect(watch.update(pressing: true, dragging: true, buttonDown: false, at: 0.1) == .endDrag)
    var clicked = MiniPanelPressWatch()
    _ = clicked.update(pressing: true, dragging: false, buttonDown: false, at: 0)
    #expect(clicked.update(pressing: false, dragging: false, buttonDown: false, at: 0.05) == .none)
    #expect(clicked.update(pressing: false, dragging: false, buttonDown: false, at: 0.5) == .none)
  }

  @Test("Pressing the button again starts the wait over")
  func buttonDownResets() {
    var watch = MiniPanelPressWatch()
    _ = watch.update(pressing: true, dragging: false, buttonDown: false, at: 0)
    _ = watch.update(pressing: true, dragging: false, buttonDown: false, at: 0.05)
    #expect(watch.update(pressing: true, dragging: false, buttonDown: true, at: 0.08) == .none)
    #expect(watch.update(pressing: true, dragging: false, buttonDown: false, at: 0.15) == .none)
    #expect(watch.update(pressing: true, dragging: false, buttonDown: false, at: 0.2) == .none)
    #expect(watch.update(pressing: true, dragging: false, buttonDown: false, at: 0.25) == .endPress)
  }

  @Test("A drag session that began during a drop's wait is invited once it ends")
  func afterWait() {
    #expect(MiniPanelDropFlow.afterWait(sessionUnderWay: true) == .invite)
    #expect(MiniPanelDropFlow.afterWait(sessionUnderWay: false) == .tucked)
  }

  @Test("Promised files that failed or never came are reported")
  func promiseFailures() {
    typealias Outcome = MiniPanelPromiseOutcome
    #expect(
      Outcome.settle(expected: 3, received: 3, failed: 0, imageAvailable: false)
        == .init(failures: 0, useImage: false))
    #expect(
      Outcome.settle(expected: 3, received: 1, failed: 1, imageAvailable: true)
        == .init(failures: 2, useImage: false))
    // A promiser that wrote more files than it announced.
    #expect(
      Outcome.settle(expected: 1, received: 4, failed: 0, imageAvailable: false)
        == .init(failures: 0, useImage: false))
  }

  @Test("When nothing arrives, the drop's image goes in instead, else the drop is reported")
  func promiseNothingArrived() {
    typealias Outcome = MiniPanelPromiseOutcome
    #expect(
      Outcome.settle(expected: 2, received: 0, failed: 2, imageAvailable: true)
        == .init(failures: 0, useImage: true))
    #expect(
      Outcome.settle(expected: 2, received: 0, failed: 1, imageAvailable: false)
        == .init(failures: 2, useImage: false))
    #expect(
      Outcome.settle(expected: 0, received: 0, failed: 0, imageAvailable: false)
        == .init(failures: 1, useImage: false))
  }
}
