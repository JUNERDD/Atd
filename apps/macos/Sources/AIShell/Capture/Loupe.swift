import AICore
import AppKit
import CoreText

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
  private static let hintFont = NSFont.monospacedSystemFont(ofSize: 9.5, weight: .semibold)
  private static let infoAttributes = makeAttributes(font: infoFont, color: .white)
  private static let hintAttributes = makeAttributes(
    font: hintFont, color: NSColor(white: 1, alpha: 0.58))
  private static let hintLine = makeLine("C", attributes: hintAttributes)
  private static let hintWidth = lineWidth(hintLine)
  private static var gridSide: CGFloat { CGFloat(span) * zoom }

  private let image: CGImage
  private let scale: CGFloat
  private var magnified: CGImage?
  private var coordinates = ""
  private var hex = ""
  private var sampledColor = NSColor.clear
  private(set) var sampledRGBA = AnnotationRGBA(red: 0, green: 0, blue: 0, alpha: 1)
  var onCopyText: ((String) -> Bool)?
  private var copiedFeedback: String?
  private var feedbackTask: Task<Void, Never>?
  private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()

  init(image: CGImage, scale: CGFloat) {
    self.image = image
    self.scale = scale
    super.init(frame: CGRect(x: 0, y: 0, width: Self.gridSide, height: Self.gridSide + 24))
    clipsToBounds = false
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  isolated deinit { feedbackTask?.cancel() }

  override var isFlipped: Bool { true }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil {
      feedbackTask?.cancel()
      feedbackTask = nil
      copiedFeedback = nil
    }
  }

  /// Shows the pixels around `point` (view space) and the readout for `quartz`.
  func update(at point: CGPoint, quartz: CGPoint) {
    let pixel = CaptureCoordinates.pixel(
      at: point, scale: scale, width: image.width, height: image.height)
    let rendered = render(around: pixel)
    magnified = rendered.image
    coordinates = "\(Int(quartz.x.rounded(.down))), \(Int(quartz.y.rounded(.down)))"
    hex = rendered.hex
    sampledColor = rendered.color
    sampledRGBA = rendered.rgba
    updateFrameSize()
    needsDisplay = true
  }

  /// Copies the hovered pixel's `#HEX` (`asRGB: false`, shortcut `C`) or `rgb(r,g,b)`
  /// (`asRGB: true`, shortcut `⇧C`) and displays inline confirmation.
  @discardableResult
  func copyColor(asRGB: Bool) -> String? {
    guard !hex.isEmpty else { return nil }
    let value = asRGB ? sampledRGBA.rgbString : sampledRGBA.hexString
    let copied = onCopyText?(value) ?? Self.writeToPasteboard(value)
    guard copied else { return nil }
    copiedFeedback = "\(ShellStrings.shared.text(CaptureToolsStringKey.loupeCopied)) \(value)"
    feedbackTask?.cancel()
    feedbackTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(1.0))
      guard !Task.isCancelled, let self else { return }
      self.copiedFeedback = nil
      self.updateFrameSize()
      self.needsDisplay = true
    }
    updateFrameSize()
    needsDisplay = true
    return value
  }

  private func updateFrameSize() {
    setFrameSize(NSSize(width: max(Self.gridSide, infoWidth), height: Self.gridSide + 24))
  }

  private static func writeToPasteboard(_ value: String) -> Bool {
    NSPasteboard.general.clearContents()
    return NSPasteboard.general.setString(value, forType: .string)
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
    if let copiedFeedback {
      return Self.copiedWidth(
        textWidth: Self.lineWidth(Self.makeLine(copiedFeedback, attributes: Self.infoAttributes)))
    }
    return Self.normalWidth(
      coordinates: Self.lineWidth(Self.makeLine(coordinates, attributes: Self.infoAttributes)),
      hex: Self.lineWidth(Self.makeLine(hex, attributes: Self.infoAttributes)))
  }

  private static func copiedWidth(textWidth: CGFloat) -> CGFloat {
    textWidth + 10 + 7 * 2 + 6
  }

  private static func normalWidth(coordinates: CGFloat, hex: CGFloat) -> CGFloat {
    coordinates + hex + 10 + 8 * 2 + 7 * 2 + hintWidth + 10
  }

  private func drawInfo(at y: CGFloat) {
    let context = NSGraphicsContext.current?.cgContext
    if let copiedFeedback {
      let feedbackLine = Self.makeLine(copiedFeedback, attributes: Self.infoAttributes)
      let boxWidth = Self.copiedWidth(textWidth: Self.lineWidth(feedbackLine))
      let box = CGRect(x: (bounds.width - boxWidth) / 2, y: y, width: boxWidth, height: 20)
      NSColor(srgbRed: 0.11, green: 0.42, blue: 0.24, alpha: 0.92).setFill()
      NSBezierPath(roundedRect: box, xRadius: 6, yRadius: 6).fill()
      let chip = CGRect(x: box.minX + 7, y: y + 5, width: 10, height: 10)
      drawColorChip(in: chip, borderAlpha: 0.75)
      if let context {
        Self.drawLine(feedbackLine, at: CGPoint(x: chip.maxX + 6, y: y + 3), in: context)
      }
      return
    }
    let coordLine = Self.makeLine(coordinates, attributes: Self.infoAttributes)
    let hexLine = Self.makeLine(hex, attributes: Self.infoAttributes)
    let coordWidth = Self.lineWidth(coordLine)
    let hexWidth = Self.lineWidth(hexLine)
    let boxWidth = Self.normalWidth(coordinates: coordWidth, hex: hexWidth)
    let box = CGRect(x: (bounds.width - boxWidth) / 2, y: y, width: boxWidth, height: 20)
    NSColor(white: 0, alpha: 0.72).setFill()
    NSBezierPath(roundedRect: box, xRadius: 6, yRadius: 6).fill()
    var x = box.minX + 7
    if let context { Self.drawLine(coordLine, at: CGPoint(x: x, y: y + 3), in: context) }
    x += coordWidth + 8
    let chip = CGRect(x: x, y: y + 5, width: 10, height: 10)
    drawColorChip(in: chip, borderAlpha: 0.6)
    x += 10 + 8
    if let context { Self.drawLine(hexLine, at: CGPoint(x: x, y: y + 3), in: context) }
    x += hexWidth + 8
    if let context { Self.drawLine(Self.hintLine, at: CGPoint(x: x, y: y + 3.5), in: context) }
  }

  private func drawColorChip(in chip: CGRect, borderAlpha: CGFloat) {
    sampledColor.setFill()
    NSBezierPath(roundedRect: chip, xRadius: 3, yRadius: 3).fill()
    NSColor(white: 1, alpha: borderAlpha).setStroke()
    NSBezierPath(roundedRect: chip.insetBy(dx: 0.5, dy: 0.5), xRadius: 2.5, yRadius: 2.5).stroke()
  }

  /// Build an immutable `CFDictionary` directly via `NSDictionary(objects:forKeys:)` so
  /// `CFAttributedStringCreate` uses a per-instance dictionary instead of UIFoundation's global
  /// `NSAttributeDictionary` cache or Swift dictionary bridging.
  private static func makeAttributes(font: NSFont, color: NSColor) -> CFDictionary {
    let ctFont: CTFont = font
    let cgColor = color.cgColor
    let keys: [any NSCopying] = [
      kCTFontAttributeName as NSString,
      kCTForegroundColorAttributeName as NSString,
    ]
    let values: [AnyObject] = [ctFont, cgColor]
    let dict = NSDictionary(objects: values, forKeys: keys) as CFDictionary
    precondition(
      CFDictionaryGetValue(dict, Unmanaged.passUnretained(kCTFontAttributeName).toOpaque()) != nil
        && CFDictionaryGetValue(
          dict, Unmanaged.passUnretained(kCTForegroundColorAttributeName).toOpaque()) != nil
    )
    return dict
  }

  private static func makeLine(_ text: String, attributes: CFDictionary) -> CTLine? {
    guard !text.isEmpty,
      let attributed = CFAttributedStringCreate(nil, text as CFString, attributes)
    else { return nil }
    return CTLineCreateWithAttributedString(attributed)
  }

  private static func lineWidth(_ line: CTLine?) -> CGFloat {
    guard let line else { return 0 }
    return ceil(CTLineGetTypographicBounds(line, nil, nil, nil))
  }

  private static func drawLine(_ line: CTLine?, at origin: CGPoint, in context: CGContext) {
    guard let line else { return }
    var ascent: CGFloat = 0
    CTLineGetTypographicBounds(line, &ascent, nil, nil)
    // CoreGraphics GState does not save textMatrix, so restore it explicitly.
    let savedTextMatrix = context.textMatrix
    defer { context.textMatrix = savedTextMatrix }
    // LoupeView is flipped (y-down), while CoreText draws y-up unless textMatrix flips y.
    context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
    context.textPosition = CGPoint(x: origin.x, y: origin.y + ascent)
    CTLineDraw(line, context)
  }

  /// The `span` × `span` pixels around `pixel` in sRGB (black past the image's edges) and the
  /// center pixel's hex colour and sRGB components.
  private func render(around pixel: CapturePixel)
    -> (image: CGImage?, hex: String, color: NSColor, rgba: AnnotationRGBA)
  {
    let span = Self.span
    let half = span / 2
    guard
      let context = CGContext(
        data: nil, width: span, height: span, bitsPerComponent: 8, bytesPerRow: span * 4,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
          | CGBitmapInfo.byteOrder32Little.rawValue)
    else { return (nil, "", .clear, AnnotationRGBA(red: 0, green: 0, blue: 0, alpha: 1)) }
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
    var rgba = AnnotationRGBA(red: 0, green: 0, blue: 0, alpha: 1)
    if let data = context.data?.assumingMemoryBound(to: UInt8.self) {
      // Rows are stored top first; BGRA in memory for 32-bit little-endian ARGB.
      let offset = half * span * 4 + half * 4
      let r = CGFloat(data[offset + 2]) / 255
      let g = CGFloat(data[offset + 1]) / 255
      let b = CGFloat(data[offset]) / 255
      rgba = AnnotationRGBA(red: r, green: g, blue: b, alpha: 1)
      hex = rgba.hexString
      color = NSColor(srgbRed: r, green: g, blue: b, alpha: 1)
    }
    return (context.makeImage(), hex, color, rgba)
  }
}
