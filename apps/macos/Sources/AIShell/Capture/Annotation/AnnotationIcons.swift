import AICore
import AppKit

/// Images of the annotation toolbar. Functional glyphs are Lucide template image sets in the App
/// target's asset catalog (`App/Assets.xcassets/Capture/lucide-<name>.imageset`), found in the
/// main bundle by `NSImage(named:)` like the status item's images. Outside the app bundle
/// (`swift run`, tests) they are missing and the controls keep their tooltips and labels.
///
/// Source: unmodified SVGs from lucide-static 1.48.0 / lucide-react 1.61.0 (ISC). Functional
/// glyphs are Lucide template image sets in `App/Assets.xcassets/`; `camera`, `sparkles`,
/// `ellipsis`, `arrow-up`, `chevron-down`, `globe`, `layers`, `maximize-2`, `minus`,
/// `panel-right`, `plus`, `save`, and `sliders-horizontal` are shared from sibling asset sets.
/// Color swatches, the rainbow wheel, and the solid cover box are drawn directly here.
enum AnnotationIcons {
  static let undo = "undo-2"
  static let redo = "redo-2"
  static let cancel = "x"
  static let save = "save"
  static let copy = "copy"
  static let confirm = "check"
  static let textBackground = "square-text"
  static let grip = "grip-vertical"
  static let screenshot = "camera"
  static let record = "video"
  static let ask = "sparkles"
  static let more = "ellipsis"
  static let send = "arrow-up"
  static let copyText = "scan-text"
  static let autoRedact = "scan-eye"
  static let redacted = "shield-check"
  static let longScreenshot = "unfold-vertical"
  /// Text mode's way in and its scope chip.
  static let selectText = "square-dashed-text"
  /// The text row's toggle for the result card (`Lucide / panel-right`, as in the long screenshot preview).
  static let results = "panel-right"
  static let pin = "pin"
  static let eyedropper = "pipette"
  static let fillOutline = "square"
  static let fillSoft = "blend"
  static let fillSolid = "squircle"
  static let cornerSharp = "square"
  static let cornerRounded = "square-round-corner"
  static let dashed = "square-dashed"
  static let arrowTapered = "move-up-right"
  static let arrowClassic = "arrow-up-right"
  static let arrowDouble = "arrow-left-right"
  static let mosaicRegion = "square"
  static let mosaicBrush = "brush"
  static let spotlightRect = "square"
  static let spotlightEllipse = "circle"
  static let dimOpacity = "sun-dim"
  static let stepNumbers = "list-ordered"
  static let stepLetters = "case-sensitive"
  static let minus = "minus"
  static let plus = "plus"
  static let crop = "crop"
  static let palette = "palette"
  static let chevronDown = "chevron-down"
  static let globe = "globe"
  static let reset = "rotate-ccw"
  static let textSelect = "text-select"

  private static let rainbowDiskImage: CGImage? = makeRainbowDiskImage(pixels: 64)

  /// Draws a subtle neutral checkerboard inside the current graphics context clip.
  static func drawCheckerboard(in rect: NSRect, cell: CGFloat = 4) {
    let light = NSColor(white: 0.84, alpha: 0.36)
    let dark = NSColor(white: 0.45, alpha: 0.24)
    let cols = Int(ceil(rect.width / cell))
    let rows = Int(ceil(rect.height / cell))
    for row in 0..<rows {
      for col in 0..<cols {
        ((row + col).isMultiple(of: 2) ? light : dark).setFill()
        NSRect(
          x: rect.minX + CGFloat(col) * cell,
          y: rect.minY + CGFloat(row) * cell,
          width: cell,
          height: cell
        ).fill()
      }
    }
  }

  /// Renders a crisp conic rainbow ring at `16×16 pt`, with an active custom color dot in its center.
  static func colorWheel(activeCustom: AnnotationRGBA?, label: String) -> NSImage {
    let side: CGFloat = 16
    let image = NSImage(size: NSSize(width: side, height: side), flipped: false) { rect in
      let center = CGPoint(x: rect.midX, y: rect.midY)
      let outerR: CGFloat = 7.4
      let innerR: CGFloat = activeCustom == nil ? 3.2 : 4.2
      let outerRect = CGRect(
        x: center.x - outerR, y: center.y - outerR, width: outerR * 2, height: outerR * 2)
      let innerRect = CGRect(
        x: center.x - innerR, y: center.y - innerR, width: innerR * 2, height: innerR * 2)

      let ringPath = NSBezierPath(ovalIn: outerRect)
      ringPath.append(NSBezierPath(ovalIn: innerRect))
      ringPath.windingRule = .evenOdd

      NSGraphicsContext.saveGraphicsState()
      ringPath.addClip()
      if let disk = rainbowDiskImage, let ctx = NSGraphicsContext.current?.cgContext {
        ctx.draw(disk, in: outerRect)
      }
      NSGraphicsContext.restoreGraphicsState()

      let outerRim = NSBezierPath(ovalIn: outerRect.insetBy(dx: 0.35, dy: 0.35))
      outerRim.lineWidth = 0.7
      NSColor.labelColor.withAlphaComponent(0.22).setStroke()
      outerRim.stroke()

      if let custom = activeCustom {
        let dotR: CGFloat = 3.5
        let dotRect = CGRect(
          x: center.x - dotR, y: center.y - dotR, width: dotR * 2, height: dotR * 2)
        let dotPath = NSBezierPath(ovalIn: dotRect)
        NSGraphicsContext.saveGraphicsState()
        dotPath.addClip()
        if custom.alpha < 0.999 { drawCheckerboard(in: dotRect, cell: 2.5) }
        custom.nsColor.setFill()
        dotRect.fill()
        NSGraphicsContext.restoreGraphicsState()

        let dotRim = NSBezierPath(ovalIn: dotRect.insetBy(dx: 0.3, dy: 0.3))
        dotRim.lineWidth = 0.6
        NSColor.labelColor.withAlphaComponent(0.28).setStroke()
        dotRim.stroke()
      } else {
        let innerRim = NSBezierPath(ovalIn: innerRect.insetBy(dx: -0.3, dy: -0.3))
        innerRim.lineWidth = 0.6
        NSColor.labelColor.withAlphaComponent(0.18).setStroke()
        innerRim.stroke()
      }
      return true
    }
    image.accessibilityDescription = label
    return image
  }

  /// Fallback SF Symbol glyph configured as a template toolbar image when needed.
  static func symbol(_ systemName: String, label: String) -> NSImage? {
    guard let base = NSImage(systemSymbolName: systemName, accessibilityDescription: label) else {
      return nil
    }
    let config = NSImage.SymbolConfiguration(pointSize: 13.5, weight: .medium)
    let configured = base.withSymbolConfiguration(config) ?? base
    configured.isTemplate = true
    configured.accessibilityDescription = label
    return configured
  }

  private static func makeRainbowDiskImage(pixels: Int) -> CGImage? {
    guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
    var bytes = [UInt8](repeating: 0, count: pixels * pixels * 4)
    let center = Double(pixels) / 2.0 - 0.5
    for y in 0..<pixels {
      for x in 0..<pixels {
        let dx = Double(x) - center
        let dy = Double(y) - center
        let angle = atan2(dy, dx)
        let hue = (angle / (2.0 * .pi) + 1.0).truncatingRemainder(dividingBy: 1.0)
        let (r, g, b) = hsbToSRGB(hue: hue, saturation: 0.92, brightness: 0.98)
        let idx = (y * pixels + x) * 4
        bytes[idx] = UInt8((r * 255).rounded())
        bytes[idx + 1] = UInt8((g * 255).rounded())
        bytes[idx + 2] = UInt8((b * 255).rounded())
        bytes[idx + 3] = 255
      }
    }
    let data = Data(bytes) as CFData
    guard let provider = CGDataProvider(data: data) else { return nil }
    return CGImage(
      width: pixels,
      height: pixels,
      bitsPerComponent: 8,
      bitsPerPixel: 32,
      bytesPerRow: pixels * 4,
      space: space,
      bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
      provider: provider,
      decode: nil,
      shouldInterpolate: true,
      intent: .defaultIntent)
  }

  /// Converts normalized HSB coordinates in `0...1` to linear-range sRGB components.
  static func hsbToSRGB(hue: Double, saturation: Double, brightness: Double) -> (
    r: Double, g: Double, b: Double
  ) {
    let h = (hue - floor(hue)) * 6.0
    let i = Int(floor(h))
    let f = h - Double(i)
    let p = brightness * (1.0 - saturation)
    let q = brightness * (1.0 - saturation * f)
    let t = brightness * (1.0 - saturation * (1.0 - f))
    switch i % 6 {
    case 0: return (brightness, t, p)
    case 1: return (q, brightness, p)
    case 2: return (p, brightness, t)
    case 3: return (p, q, brightness)
    case 4: return (t, p, brightness)
    default: return (brightness, p, q)
    }
  }

  /// Renders a circular filled swatch for any sampled `AnnotationRGBA` color.
  static func customSwatch(_ color: AnnotationRGBA, label: String) -> NSImage {
    let image = NSImage(size: NSSize(width: 14, height: 14), flipped: false) { rect in
      NSColor(srgbRed: color.red, green: color.green, blue: color.blue, alpha: 1).setFill()
      NSBezierPath(ovalIn: rect).fill()
      let dot = NSBezierPath(ovalIn: rect.insetBy(dx: 0.5, dy: 0.5))
      NSColor.tertiaryLabelColor.setStroke()
      dot.lineWidth = 1
      dot.stroke()
      return true
    }
    image.accessibilityDescription = label
    return image
  }

  /// The Lucide glyph for pixelate and blur; a drawn black box for solid, which depicts itself.
  static func redaction(_ redaction: AnnotationRedaction, label: String) -> NSImage {
    switch redaction {
    case .pixelate: return glyph("grid-3x3", label: label)
    case .blur: return glyph("droplet", label: label)
    case .solid:
      let image = NSImage(size: NSSize(width: 16, height: 16), flipped: false) { rect in
        NSColor.black.setFill()
        NSBezierPath(roundedRect: rect.insetBy(dx: 2, dy: 3), xRadius: 2, yRadius: 2).fill()
        return true
      }
      image.isTemplate = true
      image.accessibilityDescription = label
      return image
    }
  }

  static func lucideName(for tool: AnnotationTool) -> String {
    switch tool {
    case .select: "mouse-pointer-2"
    case .rectangle: "square"
    case .ellipse: "circle"
    case .arrow: "arrow-up-right"
    case .line: "slash"
    case .pen: "pencil"
    case .highlighter: "highlighter"
    case .text: "type"
    case .mosaic: "grid-3x3"
    case .spotlight: "focus"
    case .step: "list-ordered"
    }
  }

  /// The Lucide glyph `name` at toolbar size, described for VoiceOver as `label`.
  static func glyph(_ name: String, label: String) -> NSImage {
    let image =
      (NSImage(named: "lucide-\(name)")?.copy() as? NSImage)
      ?? NSImage(size: NSSize(width: 16, height: 16))
    image.size = NSSize(width: 16, height: 16)
    image.accessibilityDescription = label
    return image
  }

  /// A filled colour dot with a hairline edge in the label colour, so white stays visible on a
  /// light glass and black on a dark one (the image is drawn in the current appearance).
  static func swatch(_ color: AnnotationColor, label: String) -> NSImage {
    let image = NSImage(size: NSSize(width: 14, height: 14), flipped: false) { rect in
      color.nsColor.setFill()
      NSBezierPath(ovalIn: rect).fill()
      let dot = NSBezierPath(ovalIn: rect.insetBy(dx: 0.5, dy: 0.5))
      NSColor.tertiaryLabelColor.setStroke()
      dot.lineWidth = 1
      dot.stroke()
      return true
    }
    image.accessibilityDescription = label
    return image
  }
}

extension AnnotationColor {
  nonisolated var nsColor: NSColor {
    let rgb = components
    return NSColor(srgbRed: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
  }
}

extension AnnotationRGBA {
  nonisolated var nsColor: NSColor {
    NSColor(srgbRed: red, green: green, blue: blue, alpha: alpha)
  }
}
