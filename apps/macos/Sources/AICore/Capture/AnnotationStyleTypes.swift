import CoreGraphics
import Foundation

/// Selected font family for text annotations; `.system` preserves the platform UI font.
public enum AnnotationFontChoice: Equatable, Codable, Sendable {
  case system
  case family(String)

  public var familyName: String? {
    switch self {
    case .system: nil
    case .family(let name): name
    }
  }
}

/// Fill presentation for closed shapes (rectangle, ellipse).
public enum AnnotationFillMode: String, CaseIterable, Codable, Sendable {
  case outline
  case soft
  case solid
}

/// Corner geometry for rectangles and spotlights.
public enum AnnotationCornerStyle: String, CaseIterable, Codable, Sendable {
  case sharp
  case rounded
}

/// Head and shaft rendering variants for arrows.
public enum AnnotationArrowStyle: String, CaseIterable, Codable, Sendable {
  case tapered
  case classic
  case doubleHeaded
}

/// Background plate modes for text annotations.
public enum AnnotationTextPlate: String, CaseIterable, Codable, Sendable {
  case none
  case solid
  case frosted
  case outlined
}

/// Mask creation behavior for Mosaic / Blur redaction.
public enum AnnotationMosaicMode: String, CaseIterable, Codable, Sendable {
  case region
  case brush
}

/// Aperture shape for Spotlight cutouts.
public enum AnnotationSpotlightShape: String, CaseIterable, Codable, Sendable {
  case sharp
  case ellipse
}

/// Step counter numbering sequences.
public enum AnnotationStepFormat: String, CaseIterable, Codable, Sendable {
  case numbers
  case letters

  public func format(index: Int) -> String {
    let clamped = max(1, index)
    switch self {
    case .numbers:
      return "\(clamped)"
    case .letters:
      var value = clamped
      var chars: [Character] = []
      while value > 0 {
        value -= 1
        let code = 65 + (value % 26)
        if let scalar = UnicodeScalar(code) {
          chars.append(Character(scalar))
        }
        value /= 26
      }
      return String(chars.reversed())
    }
  }
}

/// Fixed aspect-ratio presets selectable from the selection dimension badge.
public enum SelectionAspectPreset: String, CaseIterable, Codable, Sendable {
  case free
  case r1x1
  case r4x3
  case r16x9
  case r9x16

  public var ratio: CGFloat? {
    switch self {
    case .free: nil
    case .r1x1: 1.0
    case .r4x3: 4.0 / 3.0
    case .r16x9: 16.0 / 9.0
    case .r9x16: 9.0 / 16.0
    }
  }

  /// Fixed ratio text when constrained, or nil for `.free` (whose localized text is ``CaptureToolsStringKey/aspectFree``).
  public var ratioLabel: String? {
    switch self {
    case .free: nil
    case .r1x1: "1:1"
    case .r4x3: "4:3"
    case .r16x9: "16:9"
    case .r9x16: "9:16"
    }
  }

  public func label(freeLabel: @autoclosure () -> String) -> String {
    ratioLabel ?? freeLabel()
  }
}

extension AnnotationColor {
  public var rgba: AnnotationRGBA {
    let c = components
    return AnnotationRGBA(red: c.red, green: c.green, blue: c.blue, alpha: 1)
  }
}

extension AnnotationRGBA {
  public var isLight: Bool { luminance > 0.45 }

  public var hexString: String {
    let r = Int((red * 255).rounded())
    let g = Int((green * 255).rounded())
    let b = Int((blue * 255).rounded())
    return String(format: "#%02X%02X%02X", r, g, b)
  }

  public var rgbString: String {
    let r = Int((red * 255).rounded())
    let g = Int((green * 255).rounded())
    let b = Int((blue * 255).rounded())
    return "rgb(\(r), \(g), \(b))"
  }

  /// Parses `#RGB`, `#RRGGBB`, or `#RRGGBBAA` hex strings (with or without leading `#`).
  public static func parseHex(_ raw: String, fallbackAlpha: Double = 1) -> AnnotationRGBA? {
    var trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.hasPrefix("#") { trimmed.removeFirst() }
    if trimmed.count == 3 { trimmed = trimmed.map { "\($0)\($0)" }.joined() }
    guard trimmed.count == 6 || trimmed.count == 8, let val = UInt64(trimmed, radix: 16) else {
      return nil
    }
    if trimmed.count == 8 {
      return AnnotationRGBA(
        red: Double((val >> 24) & 0xFF) / 255,
        green: Double((val >> 16) & 0xFF) / 255,
        blue: Double((val >> 8) & 0xFF) / 255,
        alpha: Double(val & 0xFF) / 255)
    }
    return AnnotationRGBA(
      red: Double((val >> 16) & 0xFF) / 255,
      green: Double((val >> 8) & 0xFF) / 255,
      blue: Double(val & 0xFF) / 255,
      alpha: fallbackAlpha)
  }
}

extension AnnotationStyle {
  /// Effective RGBA color taking custom RGBA override into account before falling back to swatch.
  public var effectiveRGBA: AnnotationRGBA { customColor ?? color.rgba }

  /// Text plate style taking sampled paragraph `plate` into account.
  public var resolvedTextPlate: AnnotationTextPlate {
    if plate != nil && textPlate == .none { return .solid }
    return textPlate
  }

  /// Corner radius displayed by UI controls when no shape rect is present.
  public var displayCornerRadius: CGFloat { cornerStyle == .sharp ? 0 : (cornerRadius ?? 12) }

  /// Dynamic or explicit corner radius for rectangles and sharp spotlights.
  public func cornerRadius(for rect: CGRect) -> CGFloat {
    if cornerStyle == .sharp { return 0 }
    let minSide = min(abs(rect.width), abs(rect.height))
    let maxRadius = max(0, minSide / 2)
    if let explicit = cornerRadius {
      let clamped = explicit.isNaN ? 0 : max(0, explicit)
      return min(clamped, maxRadius)
    }
    return min(12, max(2, minSide * 0.22))
  }
}

/// One change the style bar makes: only the parts it names.
public struct AnnotationStyleChange: Equatable, Sendable {
  public var color: AnnotationColor?
  public var stroke: AnnotationStroke?
  public var textBackground: Bool?
  public var redaction: AnnotationRedaction?
  public var customColor: AnnotationRGBA??
  public var fillMode: AnnotationFillMode?
  public var cornerStyle: AnnotationCornerStyle?
  public var arrowStyle: AnnotationArrowStyle?
  public var isDashed: Bool?
  public var textPlate: AnnotationTextPlate?
  public var mosaicMode: AnnotationMosaicMode?
  public var spotlightShape: AnnotationSpotlightShape?
  public var fontChoice: AnnotationFontChoice?
  public var cornerRadius: CGFloat??

  public init(
    color: AnnotationColor? = nil, stroke: AnnotationStroke? = nil, textBackground: Bool? = nil,
    redaction: AnnotationRedaction? = nil, customColor: AnnotationRGBA?? = nil,
    fillMode: AnnotationFillMode? = nil, cornerStyle: AnnotationCornerStyle? = nil,
    arrowStyle: AnnotationArrowStyle? = nil, isDashed: Bool? = nil,
    textPlate: AnnotationTextPlate? = nil, mosaicMode: AnnotationMosaicMode? = nil,
    spotlightShape: AnnotationSpotlightShape? = nil, fontChoice: AnnotationFontChoice? = nil,
    cornerRadius: CGFloat?? = nil
  ) {
    self.color = color
    self.stroke = stroke
    self.textBackground = textBackground
    self.redaction = redaction
    self.customColor = customColor
    self.fillMode = fillMode
    self.cornerStyle = cornerStyle
    self.arrowStyle = arrowStyle
    self.isDashed = isDashed
    self.textPlate = textPlate
    self.mosaicMode = mosaicMode
    self.spotlightShape = spotlightShape
    self.fontChoice = fontChoice
    self.cornerRadius = cornerRadius
  }

  public func applied(to style: AnnotationStyle) -> AnnotationStyle {
    var next = style.with(
      color: color, stroke: stroke, textBackground: textBackground, redaction: redaction,
      customColor: customColor, fillMode: fillMode, cornerStyle: cornerStyle,
      arrowStyle: arrowStyle, isDashed: isDashed, textPlate: textPlate, mosaicMode: mosaicMode,
      spotlightShape: spotlightShape, cornerRadius: cornerRadius)
    if let fontChoice { next.fontFamily = fontChoice.familyName }
    return next
  }
}

extension AnnotationShape {
  public var bendPoint: CGPoint? {
    switch self {
    case .arrow(_, _, let bend), .line(_, _, let bend): bend
    default: nil
    }
  }

  public var lineEndpoints: (from: CGPoint, to: CGPoint, bend: CGPoint?)? {
    switch self {
    case .arrow(let from, let to, let bend), .line(let from, let to, let bend):
      (from, to, bend)
    default: nil
    }
  }

  public func withBend(_ bend: CGPoint?) -> AnnotationShape {
    switch self {
    case .arrow(let from, let to, _): .arrow(from: from, to: to, bend: bend)
    case .line(let from, let to, _): .line(from: from, to: to, bend: bend)
    default: self
    }
  }

  public var mosaicBrushPoints: [CGPoint]? {
    if case .mosaicBrush(let points) = self { return points }
    return nil
  }
}

/// The annotation tools (D9, E11), in toolbar order.
public enum AnnotationTool: String, CaseIterable, Codable, Sendable {
  case select, rectangle, ellipse, arrow, line, pen, highlighter, text, mosaic, spotlight, step

  /// The single-letter shortcut that picks the tool.
  public var key: Character {
    switch self {
    case .select: "v"
    case .rectangle: "r"
    case .ellipse: "o"
    case .arrow: "a"
    case .line: "l"
    case .pen: "p"
    case .highlighter: "h"
    case .text: "t"
    case .mosaic: "m"
    case .spotlight: "s"
    case .step: "n"
    }
  }

  /// The tool whose shortcut is `characters` (the key's characters ignoring modifiers), in
  /// either case; nil for any other key.
  public init?(key characters: String) {
    guard characters.count == 1, let typed = characters.lowercased().first,
      let tool = Self.allCases.first(where: { $0.key == typed })
    else { return nil }
    self = tool
  }
}
