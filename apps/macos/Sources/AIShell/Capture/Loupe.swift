import AICore
import AppKit

/// The magnifier beside the pointer: a nearest-neighbour grid of the frozen pixels around it,
/// the pixel under it framed, and below that the pointer's Quartz point and that pixel's sRGB
/// hex colour. Each update renders only the small pixel window, so following the pointer stays
/// cheap on a large display.
final class LoupeView: NSView {
  /// Pixels across the grid; odd, so one pixel is the center.
  private static let span = 15
  private static let zoom: CGFloat = 8
  private static let gap: CGFloat = 20
  private static let infoFont = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular)
  private static var gridSide: CGFloat { CGFloat(span) * zoom }

  private let image: CGImage
  private let scale: CGFloat
  private var magnified: CGImage?
  private var coordinates = ""
  private var hex = ""
  private var sampledColor = NSColor.clear
  private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()

  init(image: CGImage, scale: CGFloat) {
    self.image = image
    self.scale = scale
    super.init(frame: CGRect(x: 0, y: 0, width: Self.gridSide, height: Self.gridSide + 24))
    clipsToBounds = false
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  /// Shows the pixels around `point` (view space) and the readout for `quartz`.
  func update(at point: CGPoint, quartz: CGPoint) {
    let pixel = CaptureCoordinates.pixel(
      at: point, scale: scale, width: image.width, height: image.height)
    let rendered = render(around: pixel)
    magnified = rendered.image
    coordinates = "\(Int(quartz.x.rounded(.down))), \(Int(quartz.y.rounded(.down)))"
    hex = rendered.hex
    sampledColor = rendered.color
    setFrameSize(NSSize(width: max(Self.gridSide, infoWidth), height: Self.gridSide + 24))
    needsDisplay = true
  }

  /// Down and to the right of the pointer, flipped to the other side near a display edge.
  func place(near point: CGPoint, in bounds: CGRect) {
    var origin = CGPoint(x: point.x + Self.gap, y: point.y + Self.gap)
    if origin.x + frame.width > bounds.maxX { origin.x = point.x - Self.gap - frame.width }
    if origin.y + frame.height > bounds.maxY { origin.y = point.y - Self.gap - frame.height }
    setFrameOrigin(origin)
  }

  override func draw(_ dirtyRect: NSRect) {
    let grid = CGRect(
      x: (bounds.width - Self.gridSide) / 2, y: 0, width: Self.gridSide, height: Self.gridSide)
    let rounded = NSBezierPath(roundedRect: grid, xRadius: 8, yRadius: 8)
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowColor = NSColor(white: 0, alpha: 0.35)
    shadow.shadowBlurRadius = 18
    shadow.shadowOffset = NSSize(width: 0, height: -6)
    shadow.set()
    NSColor.black.setFill()
    rounded.fill()
    NSGraphicsContext.restoreGraphicsState()

    NSGraphicsContext.saveGraphicsState()
    rounded.addClip()
    NSColor.black.setFill()
    grid.fill()
    if let magnified {
      NSGraphicsContext.current?.imageInterpolation = .none
      NSImage(cgImage: magnified, size: grid.size).draw(
        in: grid, from: .zero, operation: .copy, fraction: 1, respectFlipped: true, hints: nil)
    }
    let center = CGFloat(Self.span / 2) * Self.zoom
    let pixel = CGRect(x: grid.minX + center, y: center, width: Self.zoom, height: Self.zoom)
    for (inset, color) in [
      (0.5, NSColor(white: 1, alpha: 0.9)), (-0.5, NSColor(white: 0, alpha: 0.6)),
    ] {
      color.setStroke()
      NSBezierPath(rect: pixel.insetBy(dx: inset, dy: inset)).stroke()
    }
    NSGraphicsContext.restoreGraphicsState()
    for (outset, color) in [
      (1.5, NSColor(white: 0, alpha: 0.35)), (0.5, NSColor(white: 1, alpha: 0.85)),
    ] {
      color.setStroke()
      NSBezierPath(
        roundedRect: grid.insetBy(dx: -outset, dy: -outset), xRadius: 8 + outset,
        yRadius: 8 + outset
      ).stroke()
    }
    drawInfo(at: grid.maxY + 4)
  }

  private var infoWidth: CGFloat {
    textWidth(coordinates) + textWidth(hex) + 10 + 8 * 2 + 7 * 2
  }

  private func textWidth(_ text: String) -> CGFloat {
    ceil(text.size(withAttributes: [.font: Self.infoFont]).width)
  }

  private func drawInfo(at y: CGFloat) {
    let box = CGRect(x: (bounds.width - infoWidth) / 2, y: y, width: infoWidth, height: 20)
    NSColor(white: 0, alpha: 0.72).setFill()
    NSBezierPath(roundedRect: box, xRadius: 6, yRadius: 6).fill()
    var x = box.minX + 7
    let attributes: [NSAttributedString.Key: Any] = [
      .font: Self.infoFont, .foregroundColor: NSColor.white,
    ]
    NSAttributedString(string: coordinates, attributes: attributes)
      .draw(in: CGRect(x: x, y: y + 3, width: textWidth(coordinates), height: 14))
    x += textWidth(coordinates) + 8
    let chip = CGRect(x: x, y: y + 5, width: 10, height: 10)
    sampledColor.setFill()
    NSBezierPath(roundedRect: chip, xRadius: 3, yRadius: 3).fill()
    NSColor(white: 1, alpha: 0.6).setStroke()
    NSBezierPath(roundedRect: chip.insetBy(dx: 0.5, dy: 0.5), xRadius: 2.5, yRadius: 2.5).stroke()
    x += 10 + 8
    NSAttributedString(string: hex, attributes: attributes)
      .draw(in: CGRect(x: x, y: y + 3, width: textWidth(hex), height: 14))
  }

  /// The `span` × `span` pixels around `pixel` in sRGB (black past the image's edges) and the
  /// center pixel's hex colour.
  private func render(around pixel: CapturePixel) -> (image: CGImage?, hex: String, color: NSColor)
  {
    let span = Self.span
    let half = span / 2
    guard
      let context = CGContext(
        data: nil, width: span, height: span, bitsPerComponent: 8, bytesPerRow: span * 4,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
          | CGBitmapInfo.byteOrder32Little.rawValue)
    else { return (nil, "", .clear) }
    context.interpolationQuality = .none
    let area = CGRect(x: pixel.x - half, y: pixel.y - half, width: span, height: span)
    let visible = area.intersection(CGRect(x: 0, y: 0, width: image.width, height: image.height))
    if !visible.isNull, let crop = image.cropping(to: visible) {
      // Bitmap contexts are y-up; the crop's top row lands `visible.minY - area.minY` rows
      // below the area's top.
      let top = visible.minY - area.minY
      context.draw(
        crop,
        in: CGRect(
          x: visible.minX - area.minX, y: CGFloat(span) - top - visible.height,
          width: visible.width, height: visible.height))
    }
    var hex = ""
    var color = NSColor.clear
    if let data = context.data?.assumingMemoryBound(to: UInt8.self) {
      // Rows are stored top first; BGRA in memory for 32-bit little-endian ARGB.
      let offset = half * span * 4 + half * 4
      hex = String(format: "#%02X%02X%02X", data[offset + 2], data[offset + 1], data[offset])
      color = NSColor(
        srgbRed: CGFloat(data[offset + 2]) / 255, green: CGFloat(data[offset + 1]) / 255,
        blue: CGFloat(data[offset]) / 255, alpha: 1)
    }
    return (context.makeImage(), hex, color)
  }
}
