import Testing

@testable import AICore

@Suite("Mini panel hover")
struct MiniPanelHoverTests {
  @Test("The pill swells as the pointer enters the hot zone and opens after a 60 ms dwell")
  func dwellOpens() {
    var hover = MiniPanelHover()
    #expect(hover.tucked(inHotZone: false, at: 0) == nil)
    #expect(hover.tucked(inHotZone: true, at: 1) == .swell)
    #expect(hover.isTiming && hover.isSwollen)
    #expect(hover.tucked(inHotZone: true, at: 1.05) == nil)
    #expect(hover.tucked(inHotZone: true, at: 1.06) == .expand)
    #expect(!hover.isTiming && !hover.isSwollen)
  }

  @Test("Leaving before the dwell relaxes the swell, and a return swells it afresh")
  func passingThrough() {
    var hover = MiniPanelHover()
    #expect(hover.tucked(inHotZone: true, at: 0) == .swell)
    #expect(hover.tucked(inHotZone: false, at: 0.05) == .relax)
    #expect(!hover.isTiming && !hover.isSwollen)
    #expect(hover.tucked(inHotZone: false, at: 0.07) == nil)
    #expect(hover.tucked(inHotZone: true, at: 0.1) == .swell)
    #expect(hover.tucked(inHotZone: true, at: 0.15) == nil)
    #expect(hover.tucked(inHotZone: true, at: 0.16) == .expand)
  }

  @Test("A state change forgets the swell")
  func resetForgetsSwell() {
    var hover = MiniPanelHover()
    _ = hover.tucked(inHotZone: true, at: 0)
    hover.reset()
    #expect(!hover.isSwollen)
    #expect(hover.tucked(inHotZone: false, at: 0.01) == nil)
    #expect(hover.tucked(inHotZone: true, at: 0.02) == .swell)
  }

  @Test("The capsule closes after the pointer stays away for 0.35 s")
  func awayCloses() {
    var hover = MiniPanelHover()
    #expect(hover.expanded(near: true, held: false, at: 0) == nil)
    #expect(!hover.isTiming)
    #expect(hover.expanded(near: false, held: false, at: 1) == nil)
    #expect(hover.expanded(near: false, held: false, at: 1.34) == nil)
    #expect(hover.expanded(near: true, held: false, at: 1.345) == nil)
    #expect(hover.expanded(near: false, held: false, at: 1.4) == nil)
    #expect(hover.expanded(near: false, held: false, at: 1.75) == .collapse)
  }

  @Test("A press, a drag or the context menu holds the capsule open")
  func heldStaysOpen() {
    var hover = MiniPanelHover()
    _ = hover.expanded(near: false, held: false, at: 0)
    #expect(hover.expanded(near: false, held: true, at: 5) == nil)
    #expect(!hover.isTiming)
    #expect(hover.expanded(near: false, held: false, at: 6) == nil)
    #expect(hover.expanded(near: false, held: false, at: 6.3) == nil)
    #expect(hover.expanded(near: false, held: false, at: 6.4) == .collapse)
  }

  @Test("An expansion the pointer did not make waits until the pointer has visited it")
  func awaitsVisit() {
    var hover = MiniPanelHover()
    hover.reset(awaitingVisit: true)
    #expect(hover.expanded(near: false, held: false, at: 0) == nil)
    #expect(hover.expanded(near: false, held: false, at: 9) == nil)
    #expect(hover.awaitsVisit)
    #expect(hover.expanded(near: true, held: false, at: 10) == nil)
    #expect(!hover.awaitsVisit)
    #expect(hover.expanded(near: false, held: false, at: 11) == nil)
    #expect(hover.expanded(near: false, held: false, at: 11.4) == .collapse)
  }
}
