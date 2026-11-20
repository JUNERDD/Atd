import SwiftUI

/// Corner radii that differ at each corner, the way a hand rounds a box: horizontal radii for the
/// top-leading, top-trailing, bottom-trailing and bottom-leading corners, then the vertical ones,
/// in the order CSS `border-radius` writes them. Relative radii are fractions of the box's width
/// and height.
public nonisolated struct InkCorners: Sendable, Equatable {
  public var horizontal: [CGFloat]
  public var vertical: [CGFloat]
  public var relative = false

  public init(_ horizontal: [CGFloat], _ vertical: [CGFloat], relative: Bool = false) {
    self.horizontal = horizontal
    self.vertical = vertical
    self.relative = relative
  }

  /// A capsule button.
  public static let capsule = InkCorners([24, 19, 26, 17], [19, 26, 17, 24])
  /// A full-width button.
  public static let block = InkCorners([26, 17, 28, 15], [17, 28, 15, 26])
  /// A round icon button.
  public static let round = InkCorners(
    [0.53, 0.47, 0.51, 0.45], [0.47, 0.54, 0.45, 0.52], relative: true)
  public static let card = InkCorners([26, 20, 28, 18], [20, 28, 18, 26])
  public static let field = InkCorners([16, 20, 15, 18], [18, 15, 20, 16])
  public static let chip = InkCorners([20, 15, 21, 14], [15, 21, 14, 20])
  /// A switch's track.
  public static let track = InkCorners([17, 14, 16, 13], [14, 17, 13, 16])
  /// The frame of a segmented choice, and its chosen segment.
  public static let segments = InkCorners([19, 15, 20, 14], [15, 20, 14, 19])
  public static let segment = InkCorners([15, 11, 16, 10], [11, 16, 10, 15])
  /// The shapes a sticker's blob takes.
  public static let blobs = [
    InkCorners([0.62, 0.38, 0.55, 0.45], [0.46, 0.58, 0.42, 0.54], relative: true),
    InkCorners([0.40, 0.60, 0.46, 0.54], [0.58, 0.42, 0.60, 0.40], relative: true),
    InkCorners([0.55, 0.45, 0.36, 0.64], [0.62, 0.50, 0.50, 0.38], relative: true),
    InkCorners([0.66, 0.34, 0.58, 0.42], [0.40, 0.54, 0.46, 0.60], relative: true),
    InkCorners([0.46, 0.54, 0.64, 0.36], [0.54, 0.38, 0.62, 0.46], relative: true),
  ]

  /// The radii in points for a box of `size`, scaled down together where adjacent ones would
  /// overlap, as CSS does.
  func resolved(in size: CGSize) -> (horizontal: [CGFloat], vertical: [CGFloat]) {
    var h = relative ? horizontal.map { $0 * size.width } : horizontal
    var v = relative ? vertical.map { $0 * size.height } : vertical
    let ratios = [
      size.width / max(h[0] + h[1], 0.001), size.width / max(h[3] + h[2], 0.001),
      size.height / max(v[0] + v[3], 0.001), size.height / max(v[1] + v[2], 0.001),
    ]
    let scale = min(1, ratios.min() ?? 1)
    h = h.map { $0 * scale }
    v = v.map { $0 * scale }
    return (h, v)
  }
}

/// A box with hand-rounded corners whose edge strays a little from it, the same way every time
/// for the same `seed`, like a line drawn with a pen.
public nonisolated struct InkShape: Shape {
  public var corners: InkCorners
  /// How far the edge strays, in points; 0 draws it clean.
  public var wobble: CGFloat
  public var seed: Int

  public init(corners: InkCorners, wobble: CGFloat = 0.7, seed: Int = 0) {
    self.corners = corners
    self.wobble = wobble
    self.seed = seed
  }

  public func path(in rect: CGRect) -> Path {
    var points = Self.outline(rect, corners)
    if wobble > 0, points.count > 3 { points = stray(points) }
    var path = Path()
    path.addLines(points)
    path.closeSubpath()
    return path
  }

  /// Points along the box, about 2.5 pt apart, clockwise from the top-leading corner.
  private static func outline(_ rect: CGRect, _ corners: InkCorners) -> [CGPoint] {
    let (h, v) = corners.resolved(in: rect.size)
    var points: [CGPoint] = []
    func edge(_ from: CGPoint, _ to: CGPoint) {
      let length = hypot(to.x - from.x, to.y - from.y)
      let count = max(1, Int(length / 2.5))
      for step in 0..<count {
        let t = CGFloat(step) / CGFloat(count)
        points.append(CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t))
      }
    }
    func corner(_ center: CGPoint, _ rx: CGFloat, _ ry: CGFloat, from start: CGFloat) {
      let count = max(3, Int(CGFloat.pi / 2 * (rx + ry) / 2 / 2.5))
      for step in 0..<count {
        let angle = start + CGFloat.pi / 2 * CGFloat(step) / CGFloat(count)
        points.append(CGPoint(x: center.x + rx * cos(angle), y: center.y + ry * sin(angle)))
      }
    }
    let (minX, minY, maxX, maxY) = (rect.minX, rect.minY, rect.maxX, rect.maxY)
    edge(CGPoint(x: minX + h[0], y: minY), CGPoint(x: maxX - h[1], y: minY))
    corner(CGPoint(x: maxX - h[1], y: minY + v[1]), h[1], v[1], from: -.pi / 2)
    edge(CGPoint(x: maxX, y: minY + v[1]), CGPoint(x: maxX, y: maxY - v[2]))
    corner(CGPoint(x: maxX - h[2], y: maxY - v[2]), h[2], v[2], from: 0)
    edge(CGPoint(x: maxX - h[2], y: maxY), CGPoint(x: minX + h[3], y: maxY))
    corner(CGPoint(x: minX + h[3], y: maxY - v[3]), h[3], v[3], from: .pi / 2)
    edge(CGPoint(x: minX, y: maxY - v[3]), CGPoint(x: minX, y: minY + v[0]))
    corner(CGPoint(x: minX + h[0], y: minY + v[0]), h[0], v[0], from: .pi)
    return points
  }

  /// Moves each point across the edge by two waves that fit the outline a whole number of times,
  /// so the line closes where it started.
  private func stray(_ points: [CGPoint]) -> [CGPoint] {
    var lengths = [CGFloat](repeating: 0, count: points.count)
    for index in 1..<points.count {
      let (a, b) = (points[index - 1], points[index])
      lengths[index] = lengths[index - 1] + hypot(b.x - a.x, b.y - a.y)
    }
    let total =
      lengths[points.count - 1]
      + hypot(
        points[0].x - points[points.count - 1].x, points[0].y - points[points.count - 1].y)
    let long = max(2, (total / 44).rounded())
    let short = max(3, (total / 19).rounded())
    let phase1 = CGFloat(seed % 628) / 100
    let phase2 = CGFloat((seed / 7) % 628) / 100
    return points.indices.map { index in
      let before = points[(index + points.count - 1) % points.count]
      let after = points[(index + 1) % points.count]
      let tangent = CGPoint(x: after.x - before.x, y: after.y - before.y)
      let length = max(hypot(tangent.x, tangent.y), 0.001)
      let turn = 2 * CGFloat.pi * lengths[index] / total
      let offset = wobble * (0.7 * sin(long * turn + phase1) + 0.3 * sin(short * turn + phase2))
      return CGPoint(
        x: points[index].x + tangent.y / length * offset,
        y: points[index].y - tangent.x / length * offset)
    }
  }
}

/// A stable number for a string, so an item gets the same sticker shape and tilt everywhere.
public nonisolated func inkSeed(_ string: String) -> Int {
  var hash: UInt32 = 7
  for unit in string.utf16 { hash = hash &* 31 &+ UInt32(unit) }
  return Int(hash)
}
