import CoreGraphics
import Testing

@testable import AICore

@Suite("Mini panel hover label")
struct MiniPanelHoverLabelTests {
  typealias Timer = MiniPanelLabelTimer<String>

  @Test("The first label shows after the pointer rests on a control for 0.35 s")
  func warmUp() {
    var timer = Timer()
    #expect(timer.update(item: "new", suppressed: false, at: 0) == nil)
    #expect(timer.isTiming)
    #expect(timer.update(item: "new", suppressed: false, at: 0.34) == nil)
    #expect(timer.update(item: "new", suppressed: false, at: 0.36) == "new")
    #expect(!timer.isTiming)
  }

  @Test("Moving to another control before then starts the warm-up over")
  func warmUpRestarts() {
    var timer = Timer()
    _ = timer.update(item: "new", suppressed: false, at: 0)
    #expect(timer.update(item: "ask", suppressed: false, at: 0.3) == nil)
    #expect(timer.update(item: "ask", suppressed: false, at: 0.6) == nil)
    #expect(timer.update(item: "ask", suppressed: false, at: 0.66) == "ask")
  }

  @Test("While warm, the label follows the pointer at once, gliding across the gaps")
  func warm() {
    var timer = Timer()
    _ = timer.update(item: "new", suppressed: false, at: 0)
    _ = timer.update(item: "new", suppressed: false, at: 0.4)
    // The 4 pt gap between two buttons: the label lingers rather than hiding.
    #expect(timer.update(item: nil, suppressed: false, at: 0.42) == "new")
    #expect(timer.update(item: nil, suppressed: false, at: 0.45) == "new")
    #expect(timer.update(item: "ask", suppressed: false, at: 0.46) == "ask")
  }

  @Test("Off every control, the label hides after its linger and stays warm for 0.5 s")
  func coolDown() {
    var timer = Timer()
    _ = timer.update(item: "new", suppressed: false, at: 0)
    _ = timer.update(item: "new", suppressed: false, at: 0.4)
    _ = timer.update(item: nil, suppressed: false, at: 1)
    #expect(timer.update(item: nil, suppressed: false, at: 1.11) == nil)
    #expect(timer.isTiming)
    #expect(timer.update(item: "shot", suppressed: false, at: 1.3) == "shot")
    _ = timer.update(item: nil, suppressed: false, at: 2)
    _ = timer.update(item: nil, suppressed: false, at: 2.6)
    #expect(!timer.isTiming)
    #expect(timer.update(item: "ask", suppressed: false, at: 2.7) == nil)
    #expect(timer.update(item: "ask", suppressed: false, at: 3.1) == "ask")
  }

  @Test("Off every control with no warmth left, nothing is timed, so the frames may pause")
  func idleWithoutWarmth() {
    var timer = Timer()
    // A warm-up that never finished, then the pointer goes away for good.
    _ = timer.update(item: "new", suppressed: false, at: 0)
    _ = timer.update(item: "new", suppressed: false, at: 0.2)
    #expect(timer.update(item: nil, suppressed: false, at: 0.25) == nil)
    #expect(!timer.isTiming)
    #expect(timer.update(item: nil, suppressed: false, at: 30) == nil)
    #expect(!timer.isTiming)
    // After a label, the cool-down is timed, then nothing is.
    _ = timer.update(item: "ask", suppressed: false, at: 31)
    _ = timer.update(item: "ask", suppressed: false, at: 31.4)
    _ = timer.update(item: nil, suppressed: false, at: 32)
    #expect(timer.isTiming)
    _ = timer.update(item: nil, suppressed: false, at: 32.6)
    #expect(!timer.isTiming)
    #expect(timer.update(item: nil, suppressed: false, at: 90) == nil)
    #expect(!timer.isTiming)
  }

  @Test("A press hides the label at once; it stays hidden on that control until the pointer leaves")
  func suppression() {
    var timer = Timer()
    _ = timer.update(item: "new", suppressed: false, at: 0)
    _ = timer.update(item: "new", suppressed: false, at: 0.4)
    #expect(timer.update(item: "new", suppressed: true, at: 0.5) == nil)
    #expect(timer.update(item: "new", suppressed: false, at: 0.6) == nil)
    #expect(timer.update(item: "new", suppressed: false, at: 2) == nil)
    // Another control warms up again: the press ended the warmth.
    #expect(timer.update(item: "ask", suppressed: false, at: 2.1) == nil)
    #expect(timer.update(item: "ask", suppressed: false, at: 2.5) == "ask")
    // The pressed control has its label again once the pointer has left it.
    #expect(timer.update(item: "new", suppressed: false, at: 2.6) == "new")
  }

  static let layout = MiniPanelLayout(
    placement: MiniPanelPlacement(edge: .right, position: 0.4),
    workArea: ScreenRect(x: 0, y: 0, width: 1440, height: 875),
    displayFrame: ScreenRect(x: 0, y: 0, width: 1440, height: 900), commands: 3,
    flyoutWidth: 200)

  @Test("The label sits 8 pt beside the capsule toward the interior, centered on the control")
  func placement() {
    let layout = Self.layout
    let button = layout.buttons[2]
    let label = layout.hoverLabel(
      beside: layout.capsule, centerY: button.y + button.height / 2, width: 120)
    #expect(label.maxX == layout.capsule.x - 8)
    #expect(label.width == 120 && label.height == 26)
    #expect(label.y + label.height / 2 == button.y + button.height / 2)
    #expect(layout.hoverLabel(beside: layout.capsule, centerY: 500, width: 900).width == 280)
  }

  @Test("On the left edge it sits to the right; near the top it stays 8 pt inside")
  func placementEdges() {
    let left = MiniPanelLayout(
      placement: MiniPanelPlacement(edge: .left, position: 0),
      workArea: ScreenRect(x: -1920, y: 0, width: 1920, height: 1055),
      displayFrame: ScreenRect(x: -1920, y: 0, width: 1920, height: 1080), commands: 0,
      flyoutWidth: 0)
    let label = left.hoverLabel(beside: left.capsule, centerY: 1050, width: 100)
    #expect(label.x == left.capsule.x + left.capsule.width + 8)
    #expect(label.y + label.height == 1055 - 8)
  }
}
