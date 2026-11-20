import SwiftUI

/// SVG path data and transform lists, as much as the artwork in `InkArt.json` uses: the move,
/// line, curve, arc and close commands in absolute and relative form, and `translate`, `scale`
/// and `rotate` transforms.
nonisolated enum SVGPath {
  /// The path `data` describes. Drawing stops at a command it does not know.
  static func path(_ data: String) -> Path {
    var scanner = PathScanner(data)
    var path = Path()
    var current = CGPoint.zero
    var start = CGPoint.zero
    var command: UInt8 = 0
    while true {
      if let next = scanner.command() {
        command = next
      } else if command == 0 || scanner.isAtEnd {
        break
      }
      let relative = command >= UInt8(ascii: "a")
      let base = relative ? current : .zero
      switch command | 0x20 {
      case UInt8(ascii: "m"):
        guard let point = scanner.point(base) else { return path }
        path.move(to: point)
        (current, start) = (point, point)
        // Coordinates after a move are lines.
        command = relative ? UInt8(ascii: "l") : UInt8(ascii: "L")
      case UInt8(ascii: "l"):
        guard let point = scanner.point(base) else { return path }
        path.addLine(to: point)
        current = point
      case UInt8(ascii: "h"):
        guard let x = scanner.number() else { return path }
        current.x = base.x + x
        path.addLine(to: current)
      case UInt8(ascii: "v"):
        guard let y = scanner.number() else { return path }
        current.y = base.y + y
        path.addLine(to: current)
      case UInt8(ascii: "c"):
        guard let control1 = scanner.point(base), let control2 = scanner.point(base),
          let point = scanner.point(base)
        else { return path }
        path.addCurve(to: point, control1: control1, control2: control2)
        current = point
      case UInt8(ascii: "q"):
        guard let control = scanner.point(base), let point = scanner.point(base) else {
          return path
        }
        path.addQuadCurve(to: point, control: control)
        current = point
      case UInt8(ascii: "a"):
        guard let rx = scanner.number(), let ry = scanner.number(), let angle = scanner.number(),
          let large = scanner.flag(), let sweep = scanner.flag(), let point = scanner.point(base)
        else { return path }
        let arc = EllipticalArc(
          from: current, to: point, radii: CGSize(width: rx, height: ry), rotation: angle,
          large: large, sweep: sweep)
        arc.append(to: &path)
        current = point
      case UInt8(ascii: "z"):
        path.closeSubpath()
        current = start
        command = 0
      default:
        return path
      }
    }
    return path
  }

  /// The transform a list such as `rotate(28 42 104) translate(4 6) scale(0.5)` describes; the
  /// last transform in the list applies first, as in SVG.
  static func transform(_ list: String) -> CGAffineTransform {
    var result = CGAffineTransform.identity
    for match in list.matches(of: /(translate|scale|rotate)\(([^)]*)\)/) {
      let values = match.2.split(whereSeparator: { $0 == " " || $0 == "," })
        .compactMap { Double($0) }.map { CGFloat($0) }
      let value = { (index: Int, fallback: CGFloat) in
        index < values.count ? values[index] : fallback
      }
      let step: CGAffineTransform
      switch match.1 {
      case "translate":
        step = CGAffineTransform(translationX: value(0, 0), y: value(1, 0))
      case "scale":
        step = CGAffineTransform(scaleX: value(0, 1), y: value(1, value(0, 1)))
      default:
        let center = CGPoint(x: value(1, 0), y: value(2, 0))
        step = CGAffineTransform(translationX: -center.x, y: -center.y)
          .concatenating(CGAffineTransform(rotationAngle: value(0, 0) * .pi / 180))
          .concatenating(CGAffineTransform(translationX: center.x, y: center.y))
      }
      result = step.concatenating(result)
    }
    return result
  }
}

/// Reads the numbers, flags and command letters of path data.
nonisolated private struct PathScanner {
  private let bytes: [UInt8]
  private var index = 0

  init(_ data: String) {
    bytes = Array(data.utf8)
  }

  var isAtEnd: Bool {
    mutating get {
      skipSeparators()
      return index >= bytes.count
    }
  }

  /// The next command letter, when the next token is one.
  mutating func command() -> UInt8? {
    skipSeparators()
    guard index < bytes.count else { return nil }
    let byte = bytes[index] | 0x20
    guard byte >= UInt8(ascii: "a"), byte <= UInt8(ascii: "z"), byte != UInt8(ascii: "e") else {
      return nil
    }
    defer { index += 1 }
    return bytes[index]
  }

  mutating func number() -> CGFloat? {
    skipSeparators()
    let start = index
    if index < bytes.count, bytes[index] == UInt8(ascii: "-") || bytes[index] == UInt8(ascii: "+") {
      index += 1
    }
    var hasDigits = false
    var hasPoint = false
    while index < bytes.count {
      let byte = bytes[index]
      if byte >= UInt8(ascii: "0"), byte <= UInt8(ascii: "9") {
        hasDigits = true
      } else if byte == UInt8(ascii: "."), !hasPoint {
        hasPoint = true
      } else {
        break
      }
      index += 1
    }
    if hasDigits, index < bytes.count, bytes[index] | 0x20 == UInt8(ascii: "e") {
      index += 1
      if index < bytes.count, bytes[index] == UInt8(ascii: "-") || bytes[index] == UInt8(ascii: "+")
      {
        index += 1
      }
      while index < bytes.count, bytes[index] >= UInt8(ascii: "0"),
        bytes[index] <= UInt8(ascii: "9")
      {
        index += 1
      }
    }
    guard hasDigits, let value = Double(String(decoding: bytes[start..<index], as: UTF8.self))
    else {
      index = start
      return nil
    }
    return CGFloat(value)
  }

  mutating func point(_ base: CGPoint) -> CGPoint? {
    guard let x = number(), let y = number() else { return nil }
    return CGPoint(x: base.x + x, y: base.y + y)
  }

  /// An arc flag: a single `0` or `1`, which may run into the next number.
  mutating func flag() -> Bool? {
    skipSeparators()
    guard index < bytes.count,
      bytes[index] == UInt8(ascii: "0") || bytes[index] == UInt8(ascii: "1")
    else { return nil }
    defer { index += 1 }
    return bytes[index] == UInt8(ascii: "1")
  }

  private mutating func skipSeparators() {
    while index < bytes.count, [0x20, 0x2C, 0x09, 0x0A, 0x0D].contains(bytes[index]) {
      index += 1
    }
  }
}

/// An SVG elliptical arc, drawn as cubic curves of at most a quarter turn each.
nonisolated private struct EllipticalArc {
  var from: CGPoint
  var to: CGPoint
  var radii: CGSize
  /// The ellipse's rotation, in degrees.
  var rotation: CGFloat
  var large: Bool
  var sweep: Bool

  func append(to path: inout Path) {
    guard from != to else { return }
    var rx = abs(radii.width)
    var ry = abs(radii.height)
    guard rx > 0, ry > 0 else {
      path.addLine(to: to)
      return
    }
    let phi = rotation * .pi / 180
    let (cosPhi, sinPhi) = (cos(phi), sin(phi))
    // The endpoints in the ellipse's own axes, relative to the chord's midpoint.
    let dx = (from.x - to.x) / 2
    let dy = (from.y - to.y) / 2
    let x1 = cosPhi * dx + sinPhi * dy
    let y1 = -sinPhi * dx + cosPhi * dy
    // Radii too small to span the endpoints grow until they just do.
    let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
    if lambda > 1 {
      rx *= lambda.squareRoot()
      ry *= lambda.squareRoot()
    }
    let numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
    let denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
    let sign: CGFloat = large == sweep ? -1 : 1
    let coefficient = sign * max(0, numerator / denominator).squareRoot()
    let cx1 = coefficient * rx * y1 / ry
    let cy1 = -coefficient * ry * x1 / rx
    let center = CGPoint(
      x: cosPhi * cx1 - sinPhi * cy1 + (from.x + to.x) / 2,
      y: sinPhi * cx1 + cosPhi * cy1 + (from.y + to.y) / 2)
    let startVector = CGPoint(x: (x1 - cx1) / rx, y: (y1 - cy1) / ry)
    let endVector = CGPoint(x: (-x1 - cx1) / rx, y: (-y1 - cy1) / ry)
    let startAngle = Self.angle(CGPoint(x: 1, y: 0), startVector)
    var delta = Self.angle(startVector, endVector)
    if !sweep, delta > 0 { delta -= 2 * .pi }
    if sweep, delta < 0 { delta += 2 * .pi }
    let segments = max(1, Int((abs(delta) / (.pi / 2)).rounded(.up)))
    let step = delta / CGFloat(segments)
    let handle = 4 / 3 * tan(step / 4)
    // A point of the unit circle, placed on the ellipse.
    func place(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
      CGPoint(
        x: center.x + rx * cosPhi * x - ry * sinPhi * y,
        y: center.y + rx * sinPhi * x + ry * cosPhi * y)
    }
    var theta = startAngle
    for _ in 0..<segments {
      let next = theta + step
      path.addCurve(
        to: place(cos(next), sin(next)),
        control1: place(cos(theta) - handle * sin(theta), sin(theta) + handle * cos(theta)),
        control2: place(cos(next) + handle * sin(next), sin(next) - handle * cos(next)))
      theta = next
    }
  }

  private static func angle(_ u: CGPoint, _ v: CGPoint) -> CGFloat {
    atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y)
  }
}
