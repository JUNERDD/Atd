import CoreGraphics
import Testing

@testable import AICore

@Suite("Glass HUD placement")
struct GlassHUDPlacementTests {
  typealias Display = GlassHUDPlacement.Display

  static let main = Display(
    frame: ScreenRect(x: 0, y: 0, width: 1440, height: 900),
    workArea: ScreenRect(x: 0, y: 0, width: 1440, height: 875))
  /// Left of the main display, so its origin is negative.
  static let left = Display(
    frame: ScreenRect(x: -1280, y: 100, width: 1280, height: 800),
    workArea: ScreenRect(x: -1280, y: 160, width: 1280, height: 740))
  static let size = WindowSize(width: 200, height: 36)

  @Test("Home is the bottom centre of the work area under the pointer")
  func home() {
    let displays = [Self.main, Self.left]
    let onMain = GlassHUDPlacement.home(
      size: Self.size, pointer: CGPoint(x: 300, y: 400), displays: displays, fallback: Self.main)
    #expect(onMain == CGPoint(x: 620, y: 24))
    let onLeft = GlassHUDPlacement.home(
      size: Self.size, pointer: CGPoint(x: -10, y: 500), displays: displays, fallback: Self.main)
    #expect(onLeft == CGPoint(x: -740, y: 184))
  }

  @Test("A pointer on no display falls back to the main display")
  func homeFallback() {
    let home = GlassHUDPlacement.home(
      size: Self.size, pointer: CGPoint(x: 5000, y: 5000), displays: [Self.left],
      fallback: Self.main)
    #expect(home == CGPoint(x: 620, y: 24))
  }

  @Test("A frame stays the margin inside the work area of the display holding most of it")
  func clamped() {
    let displays = [Self.main, Self.left]
    let past = ScreenRect(x: 1400, y: -20, width: 200, height: 36)
    #expect(
      GlassHUDPlacement.clamped(past, displays: displays, fallback: Self.main)
        == ScreenRect(x: 1232, y: 8, width: 200, height: 36))
    let mostlyLeft = ScreenRect(x: -150, y: 120, width: 200, height: 36)
    #expect(
      GlassHUDPlacement.clamped(mostlyLeft, displays: displays, fallback: Self.main)
        == ScreenRect(x: -208, y: 168, width: 200, height: 36))
  }

  @Test("A frame on no display is kept on the fallback")
  func clampedFallback() {
    let away = ScreenRect(x: 4000, y: 4000, width: 200, height: 36)
    #expect(
      GlassHUDPlacement.clamped(away, displays: [Self.left], fallback: Self.main)
        == ScreenRect(x: 1232, y: 831, width: 200, height: 36))
  }
}
