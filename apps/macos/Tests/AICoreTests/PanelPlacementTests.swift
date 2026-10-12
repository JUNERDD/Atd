import Testing

@testable import AICore

/// Summon placement on the display under the cursor, in AppKit's y-up space.
@Suite("Panel summon placement")
struct PanelPlacementTests {
  /// A secondary display left of and below the primary one, with a 25pt menu bar.
  static let secondary = ScreenRect(x: -1920, y: -180, width: 1920, height: 1055)
  static let size = WindowSize(width: 500, height: 680)

  @Test("Bottom-right docks as before and follows its corner")
  func bottomRight() {
    let placed = PanelGeometry.summonFrame(
      .bottomRight, in: Self.secondary, size: Self.size, remembered: PanelOffset(left: 0, top: 0))
    #expect(placed.frame == PanelGeometry.dockedFrame(in: Self.secondary, size: Self.size))
    #expect(placed.anchor == PanelAnchor(point: .bottomRight, workArea: Self.secondary))
  }

  @Test("Center places the panel in the middle of a negative-origin work area")
  func center() {
    let placed = PanelGeometry.summonFrame(
      .center, in: Self.secondary, size: Self.size, remembered: nil)
    #expect(placed.frame == ScreenRect(x: -1210, y: 7, width: 500, height: 680))
    #expect(placed.anchor == PanelAnchor(point: .center, workArea: Self.secondary))
  }

  @Test("Center keeps the size rules on a display smaller than the panel")
  func centerSmallDisplay() {
    let workArea = ScreenRect(x: 300, y: 40, width: 360, height: 480)
    #expect(
      PanelGeometry.centeredFrame(in: workArea, size: Self.size)
        == ScreenRect(x: 316, y: 56, width: 328, height: 448))
    let tiny = ScreenRect(x: -200, y: -300, width: 200, height: 300)
    #expect(PanelGeometry.centeredFrame(in: tiny, size: Self.size) == tiny)
  }

  @Test("A centered panel re-centers when its work area changes; a moved one stays inside")
  func followCenter() {
    let before = ScreenRect(x: 0, y: 60, width: 1440, height: 815)
    let after = ScreenRect(x: 0, y: 100, width: 1440, height: 775)
    let anchor = PanelAnchor(point: .center, workArea: before)
    let centered = PanelGeometry.centeredFrame(in: before, size: Self.size)
    let followed = PanelGeometry.follow(centered, anchor: anchor, workArea: after)
    #expect(followed.frame == PanelGeometry.centeredFrame(in: after, size: Self.size))
    #expect(followed.anchor == PanelAnchor(point: .center, workArea: after))

    let moved = ScreenRect(x: 1200, y: 60, width: 500, height: 680)
    let kept = PanelGeometry.follow(moved, anchor: anchor, workArea: after)
    #expect(kept.frame == ScreenRect(x: 940, y: 100, width: 500, height: 680))
    #expect(kept.anchor == nil)
  }

  @Test("Last position round-trips through the work area's top-left corner")
  func lastPositionRoundTrip() {
    let frame = ScreenRect(x: -1800, y: 100, width: 420, height: 600)
    let offset = PanelGeometry.offset(of: frame, in: Self.secondary)
    #expect(offset == PanelOffset(left: 120, top: 175))
    let placed = PanelGeometry.summonFrame(
      .lastPosition, in: Self.secondary, size: frame.size, remembered: offset)
    #expect(placed.frame == frame)
    #expect(placed.anchor == nil)
  }

  @Test("Last position keeps the top edge when the panel's height changed")
  func lastPositionKeepsTop() {
    let offset = PanelOffset(left: 120, top: 175)
    let taller = WindowSize(width: 420, height: 700)
    #expect(
      PanelGeometry.restoredFrame(offset, size: taller, in: Self.secondary)
        == ScreenRect(x: -1800, y: 0, width: 420, height: 700))
  }

  @Test("Last position is clamped into a display that shrank")
  func lastPositionClamped() {
    let shrunk = ScreenRect(x: -1280, y: -180, width: 1280, height: 695)
    let offset = PanelOffset(left: 1100, top: -40)
    #expect(
      PanelGeometry.restoredFrame(offset, size: Self.size, in: shrunk)
        == ScreenRect(x: -500, y: -165, width: 500, height: 680))
    let tiny = ScreenRect(x: 0, y: 0, width: 300, height: 380)
    #expect(PanelGeometry.restoredFrame(offset, size: Self.size, in: tiny) == tiny)
  }

  @Test("Last position falls back to center on a display without one")
  func lastPositionFallback() {
    let placed = PanelGeometry.summonFrame(
      .lastPosition, in: Self.secondary, size: Self.size, remembered: nil)
    #expect(placed.frame == PanelGeometry.centeredFrame(in: Self.secondary, size: Self.size))
    #expect(placed.anchor == PanelAnchor(point: .center, workArea: Self.secondary))
  }
}
