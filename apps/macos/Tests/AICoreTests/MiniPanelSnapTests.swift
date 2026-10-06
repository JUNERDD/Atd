import CoreGraphics
import Testing

@testable import AICore

@Suite("Mini panel snapping")
struct MiniPanelSnapTests {
  /// The primary display, and a second one to its left whose work area starts lower.
  static let displays = [
    MiniPanelDisplay(
      id: "main", frame: ScreenRect(x: 0, y: 0, width: 1440, height: 900),
      workArea: ScreenRect(x: 0, y: 70, width: 1440, height: 805)),
    MiniPanelDisplay(
      id: "left", frame: ScreenRect(x: -1920, y: -180, width: 1920, height: 1080),
      workArea: ScreenRect(x: -1920, y: -180, width: 1920, height: 1055)),
  ]

  static func samples(_ points: [(Double, Double, Double)]) -> [MiniPanelSnap.Sample] {
    points.map { MiniPanelSnap.Sample(time: $0.0, point: CGPoint(x: $0.1, y: $0.2)) }
  }

  @Test("Release velocity is measured over the last 80 ms of the drag")
  func velocity() {
    let samples = Self.samples([(0.5, 0, 0), (0.93, 100, 0), (0.96, 130, 20), (0.99, 160, 40)])
    let velocity = MiniPanelSnap.velocity(
      of: samples, releasedAt: 1.0, point: CGPoint(x: 170, y: 45))
    // From the 0.93 sample: 70 pt and 45 pt over 70 ms.
    #expect(abs(velocity.dx - 1000) < 1e-6)
    #expect(abs(velocity.dy - 45 / 0.07) < 1e-6)
  }

  @Test("A pointer that rested before the release throws nothing")
  func restingRelease() {
    let samples = Self.samples([(0.2, 0, 0), (0.4, 300, 0)])
    #expect(
      MiniPanelSnap.velocity(of: samples, releasedAt: 1.0, point: CGPoint(x: 300, y: 0))
        == .zero)
    #expect(MiniPanelSnap.velocity(of: [], releasedAt: 1.0, point: .zero) == .zero)
  }

  @Test("The projection carries the release on for 0.499 s, like UIScrollView's deceleration")
  func projection() {
    let point = MiniPanelSnap.projected(
      CGPoint(x: 100, y: 200), velocity: CGVector(dx: 1000, dy: -400))
    #expect(abs(point.x - 599) < 1e-9)
    #expect(abs(point.y - 0.4) < 1e-9)
  }

  @Test("The display holds the projected point; the edge is the nearer side of its work area")
  func displayAndEdge() throws {
    let right = try #require(MiniPanelSnap.target(for: CGPoint(x: 900, y: 400), in: Self.displays))
    #expect(right.display == 0)
    #expect(right.placement.edge == .right)
    let left = try #require(MiniPanelSnap.target(for: CGPoint(x: 300, y: 400), in: Self.displays))
    #expect(left.placement.edge == .left)
    let other = try #require(
      MiniPanelSnap.target(for: CGPoint(x: -500, y: 100), in: Self.displays))
    #expect(other.display == 1)
    #expect(other.placement.edge == .right)
  }

  @Test("A point off every display goes to the nearest one")
  func nearestDisplay() throws {
    let below = try #require(
      MiniPanelSnap.target(for: CGPoint(x: -100, y: -2000), in: Self.displays))
    #expect(below.display == 1)
    let beyond = try #require(
      MiniPanelSnap.target(for: CGPoint(x: 4000, y: 450), in: Self.displays))
    #expect(beyond.display == 0)
    #expect(beyond.placement.edge == .right)
    #expect(MiniPanelSnap.target(for: .zero, in: []) == nil)
  }

  @Test("The height is the projected point's, kept so the pill stays 8 pt inside")
  func position() throws {
    let middle = try #require(
      MiniPanelSnap.target(for: CGPoint(x: 10, y: 472.5), in: Self.displays))
    #expect(abs(middle.placement.position - 0.5) < 1e-9)
    let high = try #require(MiniPanelSnap.target(for: CGPoint(x: 10, y: 899), in: Self.displays))
    #expect(
      MiniPanelLayout.pillCenterY(position: high.placement.position, in: Self.displays[0].workArea)
        == 875 - 30)
    let low = try #require(MiniPanelSnap.target(for: CGPoint(x: 10, y: 0), in: Self.displays))
    let area = Self.displays[0].workArea
    let layout = MiniPanelLayout(
      placement: low.placement, workArea: area, displayFrame: Self.displays[0].frame,
      commands: 0, flyoutWidth: 0)
    #expect(layout.pill.y == area.y + 8)
  }
}
