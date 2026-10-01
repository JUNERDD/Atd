import Testing

@testable import AICore

/// Placement cases in AppKit's y-up space. `flip` turns a top-left-origin rectangle into it for a
/// primary display of height `primaryHeight`.
@Suite("Panel placement in AppKit screen coordinates")
struct WindowGeometryTests {
  static func flip(_ x: Double, _ y: Double, _ w: Double, _ h: Double, primaryHeight: Double)
    -> ScreenRect
  {
    ScreenRect(x: x, y: primaryHeight - y - h, width: w, height: h)
  }

  @Test("Clears the menu bar and Dock using the work area")
  func menuBarAndDock() {
    let workArea = Self.flip(0, 25, 1440, 815, primaryHeight: 900)
    #expect(
      PanelGeometry.dockedFrame(in: workArea)
        == Self.flip(1004, 244, 420, 580, primaryHeight: 900))
  }

  @Test("Anchors to a secondary display with a negative origin")
  func negativeOrigin() {
    let workArea = Self.flip(-1920, -100, 1920, 1040, primaryHeight: 1080)
    #expect(
      PanelGeometry.dockedFrame(in: workArea)
        == Self.flip(-436, 344, 420, 580, primaryHeight: 1080))
  }

  @Test("Fits a small display without leaving the work area")
  func smallDisplay() {
    let workArea = Self.flip(300, 40, 360, 480, primaryHeight: 600)
    #expect(
      PanelGeometry.dockedFrame(in: workArea)
        == Self.flip(316, 56, 328, 448, primaryHeight: 600))
  }

  @Test("A display smaller than the minimum gives up the margin, not the work area")
  func tinyDisplay() {
    let workArea = ScreenRect(x: -200, y: -300, width: 200, height: 300)
    #expect(PanelGeometry.minimumSize(in: workArea) == WindowSize(width: 200, height: 300))
    #expect(PanelGeometry.dockedFrame(in: workArea) == workArea)
  }

  @Test("A remembered size is kept, and clamped to the work area")
  func rememberedSize() {
    let workArea = ScreenRect(x: 0, y: 0, width: 1000, height: 800)
    let docked = PanelGeometry.dockedFrame(in: workArea, size: WindowSize(width: 500, height: 600))
    #expect(docked == ScreenRect(x: 484, y: 16, width: 500, height: 600))
    let huge = PanelGeometry.dockedFrame(in: workArea, size: WindowSize(width: 5000, height: 5000))
    #expect(huge == ScreenRect(x: 16, y: 16, width: 968, height: 768))
  }

  @Test("A docked panel follows its work area; a moved one only stays inside")
  func followWorkArea() {
    let before = ScreenRect(x: 0, y: 60, width: 1440, height: 815)
    let after = ScreenRect(x: 0, y: 100, width: 1440, height: 775)
    let docked = PanelGeometry.dockedFrame(in: before)
    let followed = PanelGeometry.follow(docked, docked: before, workArea: after)
    #expect(followed.frame == PanelGeometry.dockedFrame(in: after))
    #expect(followed.docked == after)

    let moved = ScreenRect(x: 10, y: 20, width: 420, height: 580)
    let kept = PanelGeometry.follow(moved, docked: before, workArea: after)
    #expect(kept.frame == ScreenRect(x: 10, y: 100, width: 420, height: 580))
    #expect(kept.docked == nil)
  }

  @Test("The settings window centers inside the work area")
  func settingsFrame() {
    let workArea = ScreenRect(x: -1280, y: 0, width: 1280, height: 700)
    #expect(
      SettingsGeometry.centeredFrame(in: workArea)
        == ScreenRect(x: -1140, y: 0, width: 1000, height: 700))
  }

  @Test("The display under the cursor wins, otherwise the nearest one")
  func nearestDisplay() {
    let frames = [
      ScreenRect(x: 0, y: 0, width: 1440, height: 900),
      ScreenRect(x: -1920, y: -180, width: 1920, height: 1080),
    ]
    #expect(DisplaySelection.index(nearestTo: 100, 100, in: frames) == 0)
    #expect(DisplaySelection.index(nearestTo: -10, -100, in: frames) == 1)
    #expect(DisplaySelection.index(nearestTo: 2000, 450, in: frames) == 0)
    #expect(DisplaySelection.index(nearestTo: -3000, 0, in: frames) == 1)
    #expect(DisplaySelection.index(nearestTo: 0, 0, in: []) == nil)
  }
}
