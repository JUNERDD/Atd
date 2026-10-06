import CoreGraphics
import Foundation
import Testing

@testable import AICore

/// hover-label-v2: the label grows out of, and draws back into, the hovered control's middle,
/// staying a capsule, and no part of it ever shows outside the union of the shape it belongs to
/// (the capsule, or the card for a row's label) and its own rest. The two stand 8 pt apart, and a
/// label that converges into the shape must cross that gap, where the glass container merges the
/// two glasses: at each height both span, the gap between their outlines counts as part of the
/// union (the merged glass's bridge); above or below either one, only the other's outline does.
@Suite("Mini panel hover label path")
struct MiniPanelLabelPathTests {
  static let workArea = ScreenRect(x: 0, y: 0, width: 1920, height: 1055)
  static let display = ScreenRect(x: 0, y: 0, width: 1920, height: 1080)

  static func layout(_ edge: MiniPanelEdge, position: Double) -> MiniPanelLayout {
    MiniPanelLayout(
      placement: MiniPanelPlacement(edge: edge, position: position), workArea: workArea,
      displayFrame: display, commands: 12, flyoutWidth: 240)
  }

  /// The label's progress from drawn in (0) to at rest (1), finely sampled.
  static let progress = (0...400).map { Double($0) / 400 }

  /// Points on the outline of the capsule `rect` (its radius half its height), and its middle.
  static func outline(of rect: CGRect) -> [CGPoint] {
    let radius = min(rect.width, rect.height) / 2
    guard radius > 0 else { return [CGPoint(x: rect.midX, y: rect.midY)] }
    var points = [CGPoint(x: rect.midX, y: rect.midY)]
    for step in 0...16 {
      let t = Double(step) / 16
      let x = rect.minX + radius + (rect.width - 2 * radius) * t
      points += [CGPoint(x: x, y: rect.minY), CGPoint(x: x, y: rect.maxY)]
      let angle = Double.pi * (t - 0.5)
      let (dx, dy) = (radius * cos(angle), radius * sin(angle))
      points += [
        CGPoint(x: rect.maxX - radius + dx, y: rect.midY + dy),
        CGPoint(x: rect.minX + radius - dx, y: rect.midY + dy),
      ]
    }
    return points
  }

  static let slack = 1e-6

  /// Where the rounded rectangle `rect` (corners of `radius`) spans at height `y`, if it does.
  static func span(_ rect: CGRect, radius: Double, at y: Double) -> ClosedRange<Double>? {
    guard y >= rect.minY - slack, y <= rect.maxY + slack else { return nil }
    let cy = min(max(y, rect.minY + radius), rect.maxY - radius)
    let dy = min(abs(y - cy), radius)
    let inset = radius - (radius * radius - dy * dy).squareRoot()
    return (rect.minX + inset - slack)...(rect.maxX - inset + slack)
  }

  /// Whether `point` lies in the union of `shape` (rounded with `radius`) and the capsule `rest`,
  /// with the gap between them filled at the heights both span.
  static func isAllowed(_ point: CGPoint, shape: CGRect, radius: Double, rest: CGRect) -> Bool {
    let spans = [
      span(shape, radius: radius, at: point.y), span(rest, radius: rest.height / 2, at: point.y),
    ].compactMap { $0 }
    guard let lower = spans.map(\.lowerBound).min(), let upper = spans.map(\.upperBound).max()
    else { return false }
    guard spans.count == 2 else { return spans[0].contains(point.x) }
    return (lower...upper).contains(point.x)
  }

  /// Checks every sampled step of the way between `rest` and `point`, inside `shape` (rounded with
  /// `radius`) beside it.
  static func checkPath(
    rest: CGRect, point: CGPoint, shape: CGRect, radius: Double, edge: MiniPanelEdge,
    _ name: String
  ) {
    let gap = edge == .right ? shape.minX - rest.maxX : rest.minX - shape.maxX
    #expect(abs(gap - MiniPanelMetrics.labelGap) < 1e-9, "\(name)")
    #expect(span(shape, radius: radius, at: point.y)?.contains(point.x) == true, "\(name)")
    for p in progress {
      let rect = MiniPanelLabelPath.rect(progress: p, rest: rest, point: point, edge: edge)
      // Width and height shrink in step: it stays a capsule of the rest's proportions.
      #expect(abs(rect.width - rest.width * p) < 1e-9 && abs(rect.height - rest.height * p) < 1e-9)
      for sample in outline(of: rect) {
        let allowed = isAllowed(sample, shape: shape, radius: radius, rest: rest)
        #expect(allowed, "\(name) at \(p): \(sample) of \(rect)")
        guard allowed else { return }
      }
    }
  }

  static func rect(_ rect: ScreenRect) -> CGRect {
    CGRect(x: rect.x, y: rect.y, width: rect.width, height: rect.height)
  }

  @Test(
    "The first, a middle and the last button's label stay inside the capsule and their rest",
    arguments: MiniPanelEdge.allCases, [0.0, 0.5, 1.0])
  func buttons(edge: MiniPanelEdge, position: Double) {
    let layout = Self.layout(edge, position: position)
    let capsule = Self.rect(layout.capsule)
    let radius = layout.cornerRadius(of: .capsule)
    for index in [0, layout.buttons.count / 2, layout.buttons.count - 1] {
      let button = Self.rect(layout.buttons[index])
      let point = CGPoint(x: button.midX, y: button.midY)
      let rest = Self.rect(layout.hoverLabel(beside: layout.capsule, centerY: point.y, width: 140))
      Self.checkPath(
        rest: rest, point: point, shape: capsule, radius: radius, edge: edge,
        "\(edge) \(position) button \(index)")
    }
  }

  @Test(
    "A row's label draws back into the row's middle, inside the card and its rest",
    arguments: MiniPanelEdge.allCases)
  func rows(edge: MiniPanelEdge) throws {
    let layout = Self.layout(edge, position: 0.5)
    let card = try #require(layout.flyout)
    let visible = MiniPanelMetrics.maxVisibleRows
    for index in [0, visible / 2, visible - 1] {
      let middle =
        card.maxY - MiniPanelMetrics.cardPadding - (Double(index) + 0.5)
        * MiniPanelMetrics.rowHeight
      let point = CGPoint(x: card.x + card.width / 2, y: middle)
      let rest = Self.rect(layout.hoverLabel(beside: card, centerY: middle, width: 280))
      Self.checkPath(
        rest: rest, point: point, shape: Self.rect(card), radius: MiniPanelMetrics.cardRadius,
        edge: edge, "\(edge) row \(index)")
    }
  }

  @Test(
    "At rest it is the rest; drawn in, nothing at the control's middle",
    arguments: [
      MiniPanelEdge.left, .right,
    ])
  func endpoints(edge: MiniPanelEdge) {
    let rest = CGRect(x: 100, y: 300, width: 120, height: 26)
    let point = CGPoint(x: edge == .right ? 250 : 70, y: 313)
    #expect(MiniPanelLabelPath.rect(progress: 1, rest: rest, point: point, edge: edge) == rest)
    let gone = MiniPanelLabelPath.rect(progress: 0, rest: rest, point: point, edge: edge)
    #expect(gone.width == 0 && gone.height == 0 && gone.origin == point)
    // Halfway, it has shrunk as one shape and its near side has barely moved toward the middle.
    let half = MiniPanelLabelPath.rect(progress: 0.5, rest: rest, point: point, edge: edge)
    let near = edge == .right ? half.maxX - rest.maxX : rest.minX - half.minX
    #expect(abs(near - abs(point.x - (edge == .right ? rest.maxX : rest.minX)) / 16) < 1e-9)
  }
}
