import Foundation
import Testing

@testable import AICore

@Suite("Capture coordinates, selection and export rules")
struct CaptureGeometryTests {
  /// A 1512 × 982 point Retina primary display beside a 1920 × 1080 1x display to its left and
  /// above it, so the second one has a negative Quartz origin.
  static let primary = CGRect(x: 0, y: 0, width: 1512, height: 982)
  static let left = CGRect(x: -1920, y: -400, width: 1920, height: 1080)

  @Test("Cocoa and Quartz convert both ways with the primary display's height")
  func flip() {
    let cocoa = CGRect(x: -1920, y: 302, width: 1920, height: 1080)
    let quartz = CaptureCoordinates.flip(cocoa, primaryHeight: 982)
    #expect(quartz == Self.left)
    #expect(CaptureCoordinates.flip(quartz, primaryHeight: 982) == cocoa)
    #expect(
      CaptureCoordinates.flip(CGPoint(x: 10, y: 0), primaryHeight: 982)
        == CGPoint(x: 10, y: 982))
  }

  @Test("View points are Quartz points minus the display origin, negative origins included")
  func viewSpace() {
    let quartz = CGPoint(x: -1900, y: -390)
    let view = CaptureCoordinates.viewPoint(quartz, display: Self.left)
    #expect(view == CGPoint(x: 20, y: 10))
    #expect(CaptureCoordinates.quartzPoint(view, display: Self.left) == quartz)
    let window = CGRect(x: -100, y: 100, width: 300, height: 200)
    #expect(
      CaptureCoordinates.viewRect(window, display: Self.left)
        == CGRect(x: 1820, y: 500, width: 100, height: 200))
    #expect(
      CaptureCoordinates.viewRect(window, display: Self.primary)
        == CGRect(x: 0, y: 100, width: 200, height: 200))
    #expect(
      CaptureCoordinates.viewRect(window, display: CGRect(x: 5000, y: 0, width: 9, height: 9))
        == nil)
    #expect(
      CaptureCoordinates.quartzRect(CGRect(x: 20, y: 10, width: 5, height: 5), display: Self.left)
        == CGRect(x: -1900, y: -390, width: 5, height: 5))
  }

  @Test("Each display has its own pixel scale; crops round edges to whole pixels")
  func pixels() {
    #expect(CaptureCoordinates.pixelScale(pixelWidth: 3024, pointWidth: 1512) == 2)
    #expect(CaptureCoordinates.pixelScale(pixelWidth: 1920, pointWidth: 1920) == 1)
    #expect(CaptureCoordinates.pixelScale(pixelWidth: 2880, pointWidth: 1920) == 1.5)
    let rect = CGRect(x: 10.25, y: 4, width: 100.5, height: 50)
    #expect(
      CaptureCoordinates.pixelRect(rect, scale: 2, width: 3024, height: 1964)
        == CGRect(x: 21, y: 8, width: 201, height: 100))
    #expect(
      CaptureCoordinates.pixelRect(
        CGRect(x: 1500, y: 970, width: 40, height: 40), scale: 2, width: 3024, height: 1964)
        == CGRect(x: 3000, y: 1940, width: 24, height: 24))
    #expect(
      CaptureCoordinates.pixelRect(
        .init(x: 0, y: 0, width: 0.1, height: 9), scale: 1, width: 9,
        height: 9) == nil)
    #expect(
      CaptureCoordinates.pixel(at: CGPoint(x: 1512, y: 0.7), scale: 2, width: 3024, height: 1964)
        == CapturePixel(x: 3023, y: 1))
  }

  @Test("Snapping puts edges on the device pixel grid of the display's scale")
  func snapping() {
    #expect(CaptureCoordinates.snap(10.3, scale: 2) == 10.5)
    #expect(CaptureCoordinates.snap(10.2, scale: 2) == 10)
    #expect(CaptureCoordinates.snap(10.3, scale: 1) == 10)
    #expect(CaptureCoordinates.snap(1, scale: 1.5) == 4.0 / 3.0)
    #expect(
      CaptureCoordinates.snap(CGRect(x: 0.4, y: 0.6, width: 9.9, height: 3), scale: 1)
        == CGRect(x: 0, y: 1, width: 10, height: 3))
  }

  static let model = SelectionModel(size: CGSize(width: 1512, height: 982), scale: 2)

  @Test("Movement under four points is a click; more is a drag")
  func clickThreshold() {
    #expect(SelectionModel.isClick(from: .zero, to: CGPoint(x: 2, y: 3)))
    #expect(!SelectionModel.isClick(from: .zero, to: CGPoint(x: 3, y: 3)))
  }

  @Test("A free drag is normalised, snapped and kept on its display")
  func createDrag() {
    let drag = Self.model.drag(startingAt: CGPoint(x: 100.2, y: 80), selection: nil)
    #expect(drag == .create(origin: CGPoint(x: 100.2, y: 80)))
    #expect(
      Self.model.rect(for: drag, to: CGPoint(x: 40.3, y: 30))
        == CGRect(x: 40.5, y: 30, width: 59.5, height: 50))
    #expect(
      Self.model.rect(for: drag, to: CGPoint(x: 9000, y: -50))
        == CGRect(x: 100, y: 0, width: 1412, height: 80))
    // A drag along one axis keeps one pixel across the other.
    #expect(
      Self.model.rect(for: drag, to: CGPoint(x: 200, y: 80))
        == CGRect(x: 100, y: 80, width: 100, height: 0.5))
  }

  @Test("Shift holds a free drag to a square from the press point, inside the display")
  func squareDrag() {
    let drag = SelectionDrag.create(origin: CGPoint(x: 100.2, y: 80))
    func square(_ x: CGFloat, _ y: CGFloat) -> CGRect {
      Self.model.rect(for: drag, to: CGPoint(x: x, y: y), square: true)
    }
    // The larger offset is the side, whichever way the pointer goes.
    #expect(square(200, 130) == CGRect(x: 100, y: 80, width: 100, height: 100))
    #expect(square(40, 30) == CGRect(x: 40, y: 20, width: 60, height: 60))
    #expect(square(120, 400) == CGRect(x: 100, y: 80, width: 320, height: 320))
    // The side stops at the nearer display edge instead of becoming a rectangle there.
    #expect(square(9000, 500) == CGRect(x: 100, y: 80, width: 902, height: 902))
    #expect(square(100.2, 80) == CGRect(x: 100, y: 80, width: 0.5, height: 0.5))
    // Without Shift nothing changes.
    #expect(
      Self.model.rect(for: drag, to: CGPoint(x: 200, y: 130), square: false)
        == Self.model.rect(for: drag, to: CGPoint(x: 200, y: 130)))
  }

  @Test("The loupe follows the dragged corner, the dragged edge at the pointer, or the pointer")
  func loupePoint() {
    let rect = CGRect(x: 100, y: 100, width: 250, height: 100)
    let original = CGRect(x: 100, y: 100, width: 200, height: 100)
    let pointer = CGPoint(x: 351, y: 130)
    #expect(
      Self.model.loupePoint(
        for: .resize(.bottomRight, original: original), rect: rect, pointer: pointer)
        == CGPoint(x: 350, y: 200))
    #expect(
      Self.model.loupePoint(for: .resize(.right, original: original), rect: rect, pointer: pointer)
        == CGPoint(x: 350, y: 130))
    #expect(
      Self.model.loupePoint(for: .resize(.top, original: original), rect: rect, pointer: pointer)
        == CGPoint(x: 351, y: 100))
    let move = SelectionDrag.move(grab: .zero, original: original)
    #expect(
      Self.model.loupePoint(for: move, rect: rect, pointer: CGPoint(x: 9000, y: -5))
        == CGPoint(x: 1512, y: 0))
  }

  @Test("Detected areas reach the editor in view points, cut to the display, smallest first")
  func viewTargets() {
    let window = CGRect(x: -1900, y: -390, width: 500, height: 400)
    let element = CGRect(x: -1800, y: -300, width: 100, height: 50)
    let elsewhere = CGRect(x: 100, y: 100, width: 50, height: 50)
    let edge = CGRect(x: -100, y: 600, width: 300, height: 100)
    let twin = element.offsetBy(dx: 10, dy: 0)
    #expect(
      CaptureCoordinates.viewTargets([window, element, elsewhere, edge, twin], display: Self.left)
        == [
          CGRect(x: 120, y: 100, width: 100, height: 50),
          CGRect(x: 130, y: 100, width: 100, height: 50),
          CGRect(x: 1820, y: 1000, width: 100, height: 80),
          CGRect(x: 20, y: 10, width: 500, height: 400),
        ])
    #expect(CaptureCoordinates.viewTargets([], display: Self.left).isEmpty)
  }

  @Test("A press picks the handle, the inside or a new selection")
  func pressTargets() {
    let selection = CGRect(x: 100, y: 100, width: 200, height: 100)
    #expect(
      Self.model.drag(startingAt: CGPoint(x: 104, y: 97), selection: selection)
        == .resize(.topLeft, original: selection))
    #expect(
      Self.model.drag(startingAt: CGPoint(x: 200, y: 203), selection: selection)
        == .resize(.bottom, original: selection))
    #expect(
      Self.model.drag(startingAt: CGPoint(x: 150, y: 150), selection: selection)
        == .move(grab: CGPoint(x: 150, y: 150), original: selection))
    #expect(
      Self.model.drag(startingAt: CGPoint(x: 400, y: 400), selection: selection)
        == .create(origin: CGPoint(x: 400, y: 400)))
  }

  @Test("The edge band resizes along the outline, inside and out; corners take both edges")
  func edgeBand() {
    let selection = CGRect(x: 100, y: 100, width: 200, height: 100)
    func press(_ x: CGFloat, _ y: CGFloat) -> SelectionDrag {
      Self.model.drag(startingAt: CGPoint(x: x, y: y), selection: selection)
    }
    #expect(press(150, 104) == .resize(.top, original: selection))
    #expect(press(150, 95) == .resize(.top, original: selection))
    #expect(press(305, 130) == .resize(.right, original: selection))
    #expect(press(250, 197) == .resize(.bottom, original: selection))
    #expect(press(94, 180) == .resize(.left, original: selection))
    #expect(press(95, 94) == .resize(.topLeft, original: selection))
    #expect(press(150, 107) == .move(grab: CGPoint(x: 150, y: 107), original: selection))
    #expect(press(150, 93) == .create(origin: CGPoint(x: 150, y: 93)))
    // On a selection narrower than two reaches, the nearer edge wins.
    let thin = CGRect(x: 100, y: 100, width: 8, height: 100)
    #expect(Self.model.handle(at: CGPoint(x: 103, y: 150), of: thin) == .left)
    #expect(Self.model.handle(at: CGPoint(x: 105, y: 140), of: thin) == .right)
  }

  @Test("The crop transform puts view points on the cropped pixels wherever the selection is")
  func cropTransform() {
    let selection = CGRect(x: 100.5, y: 40, width: 200, height: 100)
    let transform = CaptureCoordinates.cropTransform(selection: selection, scale: 2)
    #expect(CGPoint(x: 100.5, y: 40).applying(transform) == .zero)
    #expect(CGPoint(x: 300.5, y: 140).applying(transform) == CGPoint(x: 400, y: 200))
    // A point left of the selection lands left of the crop, where the clip drops it.
    #expect(CGPoint(x: 90.5, y: 40).applying(transform) == CGPoint(x: -20, y: 0))
    // The origin is the pixel the crop starts at, rounded like `pixelRect`.
    let odd = CGRect(x: 10.3, y: 0, width: 50, height: 50)
    let pixels = CaptureCoordinates.pixelRect(odd, scale: 2, width: 3024, height: 1964)
    let origin = CGPoint(x: 10.3, y: 0).applying(
      CaptureCoordinates.cropTransform(selection: odd, scale: 2))
    #expect(pixels?.minX == 21)
    #expect(abs(origin.x - (20.6 - 21)) < 0.0001)
  }

  @Test("Moving keeps the size and stops at the display's edges")
  func move() {
    let selection = CGRect(x: 100, y: 100, width: 200, height: 100)
    let drag = SelectionDrag.move(grab: CGPoint(x: 150, y: 150), original: selection)
    #expect(
      Self.model.rect(for: drag, to: CGPoint(x: 160.2, y: 140))
        == CGRect(x: 110, y: 90, width: 200, height: 100))
    #expect(
      Self.model.rect(for: drag, to: CGPoint(x: -500, y: 2000))
        == CGRect(x: 0, y: 882, width: 200, height: 100))
  }

  @Test("Resizing moves the held edges and flips past the opposite one")
  func resize() {
    let selection = CGRect(x: 100, y: 100, width: 200, height: 100)
    #expect(
      Self.model.rect(for: .resize(.right, original: selection), to: CGPoint(x: 350, y: 0))
        == CGRect(x: 100, y: 100, width: 250, height: 100))
    #expect(
      Self.model.rect(for: .resize(.topLeft, original: selection), to: CGPoint(x: 400, y: 250))
        == CGRect(x: 300, y: 200, width: 100, height: 50))
    #expect(
      Self.model.rect(for: .resize(.bottomRight, original: selection), to: CGPoint(x: 9e3, y: 9e3))
        == CGRect(x: 100, y: 100, width: 1412, height: 882))
  }

  @Test("Arrow keys nudge within the display; Option-arrows resize down to one pixel")
  func keyboard() {
    let selection = CGRect(x: 0, y: 10, width: 20, height: 20)
    #expect(Self.model.nudged(selection, dx: -1, dy: 0) == selection)
    #expect(
      Self.model.nudged(selection, dx: 10, dy: -1) == CGRect(x: 10, y: 9, width: 20, height: 20))
    #expect(
      Self.model.resized(selection, dWidth: -30, dHeight: 1)
        == CGRect(x: 0, y: 10, width: 0.5, height: 21))
    #expect(
      Self.model.resized(CGRect(x: 1500, y: 0, width: 12, height: 9), dWidth: 10, dHeight: 0)
        == CGRect(x: 1500, y: 0, width: 12, height: 9))
  }

  @Test("A detected area is cut to the display and snapped before it becomes the selection")
  func settle() {
    let model = SelectionModel(size: CGSize(width: 1920, height: 1080), scale: 1)
    #expect(
      model.settled(CGRect(x: -20.4, y: 5.6, width: 100, height: 2000))
        == CGRect(x: 0, y: 6, width: 80, height: 1074))
  }

  @Test("Export keeps a fitting PNG, falls back to JPEG, then shrinks it by quarters")
  func exportFallback() {
    let first = ScreenshotRules.firstAttempt(width: 6016, height: 3384)
    #expect(first == ScreenshotAttempt(encoding: .png, longEdge: 2560))
    #expect(ScreenshotRules.firstAttempt(width: 300, height: 900).longEdge == 900)
    #expect(ScreenshotRules.step(after: first, bytes: 8 * 1024 * 1024) == .keep)
    #expect(
      ScreenshotRules.step(after: first, bytes: 9_000_000)
        == .retry(ScreenshotAttempt(encoding: .jpeg, longEdge: 2560)))
    #expect(
      ScreenshotRules.step(after: .init(encoding: .jpeg, longEdge: 2560), bytes: 9_000_000)
        == .retry(ScreenshotAttempt(encoding: .jpeg, longEdge: 1920)))
    #expect(
      ScreenshotRules.step(after: .init(encoding: .jpeg, longEdge: 800), bytes: 9_000_000)
        == .giveUp)
  }

  @Test("The stored size keeps the aspect ratio and never scales up")
  func exportSize() {
    #expect(
      ScreenshotRules.pixelSize(width: 6016, height: 3384, longEdge: 2560)
        == ScreenshotPixelSize(width: 2560, height: 1440))
    #expect(
      ScreenshotRules.pixelSize(width: 10, height: 5000, longEdge: 2560)
        == ScreenshotPixelSize(width: 5, height: 2560))
    #expect(
      ScreenshotRules.pixelSize(width: 800, height: 600, longEdge: 2560)
        == ScreenshotPixelSize(width: 800, height: 600))
    #expect(
      ScreenshotRules.fileName(
        capturedAt: Date(timeIntervalSince1970: 0), encoding: .jpeg, timeZone: .gmt)
        == "Screenshot 1970-01-01 at 00.00.00.jpg")
  }
}
