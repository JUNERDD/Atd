import CoreGraphics
import Foundation
import Testing

@testable import AICore

/// hover-label-v4: as a popover does, the label grows out of an anchor on its side facing the
/// shape it belongs to (the capsule, or the card for a row's label), level with its control, and
/// leaves into that anchor, staying a capsule of its rest's proportions. Its side facing the shape
/// never moves, so no part of it ever crosses the 8 pt gap toward the shape, where its base fill
/// would stack on the shape's; an elastic entrance grows it past its rest away from the shape.
@Suite("Mini panel hover label path")
struct MiniPanelLabelPathTests {
  static let workArea = ScreenRect(x: 0, y: 0, width: 1920, height: 1055)
  static let display = ScreenRect(x: 0, y: 0, width: 1920, height: 1080)

  static func layout(_ edge: MiniPanelEdge, position: Double) -> MiniPanelLayout {
    MiniPanelLayout(
      placement: MiniPanelPlacement(edge: edge, position: position), workArea: workArea,
      displayFrame: display, commands: 12, flyoutWidth: 240)
  }

  /// How far out of sight, from a little past rest (an elastic entrance's overshoot) to gone,
  /// finely sampled.
  static let fades = (-80...400).map { Double($0) / 400 }

  static func rect(_ rect: ScreenRect) -> CGRect {
    CGRect(x: rect.x, y: rect.y, width: rect.width, height: rect.height)
  }

  /// Checks every sampled step of the way between `rest` and its anchor, beside `shape` on `edge`.
  static func checkPath(rest: CGRect, shape: CGRect, edge: MiniPanelEdge, _ name: String) {
    let gap = edge == .right ? shape.minX - rest.maxX : rest.minX - shape.maxX
    #expect(abs(gap - MiniPanelMetrics.labelGap) < 1e-9, "\(name)")
    for fade in fades {
      let drawn = MiniPanelLabelPath.rect(fade: fade, rest: rest, edge: edge)
      let scale = max(MiniPanelLabelPath.scale(fade: fade), 0)
      // A capsule of the rest's proportions, level with the rest, its near side where the rest's
      // is: never closer to the shape, so the gap stays whole.
      #expect(abs(drawn.width - rest.width * scale) < 1e-9, "\(name) at \(fade)")
      #expect(abs(drawn.height - rest.height * scale) < 1e-9, "\(name) at \(fade)")
      #expect(abs(drawn.midY - rest.midY) < 1e-9, "\(name) at \(fade)")
      let near = edge == .right ? drawn.maxX : drawn.minX
      #expect(abs(near - (edge == .right ? rest.maxX : rest.minX)) < 1e-9, "\(name) at \(fade)")
      // Out of sight or on its way there, it stays inside its rest.
      if fade >= 0 {
        #expect(rest.insetBy(dx: -1e-9, dy: -1e-9).contains(drawn), "\(name) at \(fade)")
      }
    }
  }

  @Test(
    "The first, a middle and the last button's label keep clear of the capsule",
    arguments: MiniPanelEdge.allCases, [0.0, 0.5, 1.0])
  func buttons(edge: MiniPanelEdge, position: Double) {
    let layout = Self.layout(edge, position: position)
    for index in [0, layout.buttons.count / 2, layout.buttons.count - 1] {
      let button = Self.rect(layout.buttons[index])
      let rest = Self.rect(
        layout.hoverLabel(beside: layout.capsule, centerY: button.midY, width: 140))
      Self.checkPath(
        rest: rest, shape: Self.rect(layout.capsule), edge: edge,
        "\(edge) \(position) button \(index)")
    }
  }

  @Test("A row's label keeps clear of the card", arguments: MiniPanelEdge.allCases)
  func rows(edge: MiniPanelEdge) throws {
    let layout = Self.layout(edge, position: 0.5)
    let card = try #require(layout.flyout)
    let visible = MiniPanelMetrics.maxVisibleRows
    for index in [0, visible / 2, visible - 1] {
      let middle =
        card.maxY - MiniPanelMetrics.cardPadding - (Double(index) + 0.5)
        * MiniPanelMetrics.rowHeight
      let rest = Self.rect(layout.hoverLabel(beside: card, centerY: middle, width: 280))
      Self.checkPath(rest: rest, shape: Self.rect(card), edge: edge, "\(edge) row \(index)")
    }
  }

  @Test(
    "At rest it is the rest; out of sight, nothing at its anchor; past rest, larger",
    arguments: [MiniPanelEdge.left, .right])
  func endpoints(edge: MiniPanelEdge) {
    let rest = CGRect(x: 100, y: 300, width: 120, height: 26)
    let anchor = MiniPanelLabelPath.anchor(of: rest, edge: edge)
    #expect(anchor == CGPoint(x: edge == .right ? rest.maxX : rest.minX, y: rest.midY))
    #expect(MiniPanelLabelPath.rect(fade: 0, rest: rest, edge: edge) == rest)
    let gone = MiniPanelLabelPath.rect(fade: 1, rest: rest, edge: edge)
    #expect(gone.width == 0 && gone.height == 0 && gone.origin == anchor)
    // Its fill fades while its glass only draws a little toward the anchor, then the glass goes.
    #expect(MiniPanelLabelPath.scale(fade: 0.5) == 1 - MiniPanelLabelPath.leaveShrink * 0.5)
    #expect(MiniPanelLabelPath.scale(fade: 0.8) < 0.5)
    #expect(MiniPanelLabelPath.scale(fade: -0.1) > 1)
  }
}
