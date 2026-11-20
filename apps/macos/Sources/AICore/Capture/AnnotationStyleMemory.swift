import Foundation

/// The style bar controls that apply to a shape or a tool.
public struct AnnotationStyleControls: OptionSet, Sendable {
  public let rawValue: Int
  public init(rawValue: Int) { self.rawValue = rawValue }

  public static let colors = Self(rawValue: 1 << 0)
  /// The size slider (``AnnotationStroke``).
  public static let strokes = Self(rawValue: 1 << 1)
  public static let textBackground = Self(rawValue: 1 << 2)
  public static let redaction = Self(rawValue: 1 << 3)
  public static let fillMode = Self(rawValue: 1 << 4)
  public static let cornerStyle = Self(rawValue: 1 << 5)
  public static let arrowStyle = Self(rawValue: 1 << 6)
  public static let dashed = Self(rawValue: 1 << 7)
  public static let mosaicMode = Self(rawValue: 1 << 8)
  public static let spotlightShape = Self(rawValue: 1 << 9)
  public static let spotlightDim = Self(rawValue: 1 << 10)
  public static let stepConfig = Self(rawValue: 1 << 11)
  public static let fontFamily = Self(rawValue: 1 << 12)

  /// These controls for an annotation in `style`: a solid box mosaic has no size to set,
  /// whereas a freehand solid brush uses `strokes` for its brush radius.
  public func shown(for style: AnnotationStyle) -> Self {
    contains(.redaction) && style.redaction == .solid && style.mosaicMode == .region
      ? subtracting(.strokes) : self
  }
}

/// Which remembered style a tool draws with and the style bar edits (decision E8): the
/// highlighter keeps its own, so a broad yellow marker does not turn the next arrow yellow.
public enum AnnotationStyleSlot: Sendable {
  case shared, highlighter
}

extension AnnotationShape {
  /// What the style bar offers for this shape; ``AnnotationStyleControls/shown(for:)`` drops
  /// what a particular style does not use.
  public var styleControls: AnnotationStyleControls {
    switch self {
    case .mosaic, .mosaicBrush: [.mosaicMode, .redaction, .strokes]
    case .spotlight: [.spotlightShape, .spotlightDim, .cornerStyle]
    case .text: [.colors, .strokes, .textBackground, .fontFamily]
    case .rectangle: [.colors, .strokes, .fillMode, .cornerStyle, .dashed]
    case .ellipse: [.colors, .strokes, .fillMode, .dashed]
    case .arrow: [.colors, .strokes, .arrowStyle, .dashed]
    case .line: [.colors, .strokes, .dashed]
    case .step: [.colors, .strokes, .stepConfig]
    case .pen, .highlighter: [.colors, .strokes]
    }
  }

  public var styleSlot: AnnotationStyleSlot {
    if case .highlighter = self { return .highlighter }
    return .shared
  }
}

extension AnnotationTool {
  /// What the style bar offers for the next annotation this tool makes; empty for the select
  /// tool, which makes none.
  public var styleControls: AnnotationStyleControls {
    switch self {
    case .select: []
    case .spotlight: [.spotlightShape, .spotlightDim, .cornerStyle]
    case .mosaic: [.mosaicMode, .redaction, .strokes]
    case .text: [.colors, .strokes, .textBackground, .fontFamily]
    case .rectangle: [.colors, .strokes, .fillMode, .cornerStyle, .dashed]
    case .ellipse: [.colors, .strokes, .fillMode, .dashed]
    case .arrow: [.colors, .strokes, .arrowStyle, .dashed]
    case .line: [.colors, .strokes, .dashed]
    case .step: [.colors, .strokes, .stepConfig]
    case .pen, .highlighter: [.colors, .strokes]
    }
  }

  public var styleSlot: AnnotationStyleSlot {
    self == .highlighter ? .highlighter : .shared
  }
}

/// The styles new annotations take, one per slot.
public struct AnnotationStyles: Equatable, Sendable {
  public var shared: AnnotationStyle
  public var highlighter: AnnotationStyle

  /// Red at the default size for everything; the highlighter starts yellow.
  public static let defaults = Self(
    shared: AnnotationStyle(), highlighter: AnnotationStyle(color: .yellow))

  public init(shared: AnnotationStyle, highlighter: AnnotationStyle) {
    self.shared = shared
    self.highlighter = highlighter
  }

  public subscript(slot: AnnotationStyleSlot) -> AnnotationStyle {
    get { slot == .highlighter ? highlighter : shared }
    set {
      if slot == .highlighter { highlighter = newValue } else { shared = newValue }
    }
  }
}

/// Keeps the annotation styles across capture sessions in `UserDefaults`, under the shell's
/// `capture.annotation.` keys (decision E8). Missing or unknown values fall back to that slot's
/// default. The tool is deliberately not remembered: every session opens with none.
public enum AnnotationStyleMemory {
  public static let prefix = "capture.annotation."

  public static func load(from defaults: UserDefaults = .standard) -> AnnotationStyles {
    var styles = AnnotationStyles.defaults
    for slot in [AnnotationStyleSlot.shared, .highlighter] {
      let keys = Keys(slot)
      var style = styles[slot]
      if let color = defaults.string(forKey: keys.color).flatMap(AnnotationColor.init(rawValue:)) {
        style.color = color
      }
      if let stroke = defaults.object(forKey: keys.stroke) as? NSNumber {
        style.stroke = AnnotationStroke(stroke.doubleValue)
      }
      style.customColor = loadCustomColor(keys: keys, from: defaults)
      if slot == .shared {
        loadSharedStyle(&style, keys: keys, from: defaults)
      }
      styles[slot] = style
    }
    return styles
  }

  public static func save(_ styles: AnnotationStyles, to defaults: UserDefaults = .standard) {
    for slot in [AnnotationStyleSlot.shared, .highlighter] {
      let keys = Keys(slot)
      let style = styles[slot]
      defaults.set(style.color.rawValue, forKey: keys.color)
      defaults.set(style.stroke.value, forKey: keys.stroke)
      saveCustomColor(style.customColor, keys: keys, to: defaults)
      if slot == .shared {
        saveSharedStyle(style, keys: keys, to: defaults)
      }
    }
  }

  private static func loadSharedStyle(
    _ style: inout AnnotationStyle, keys: Keys, from defaults: UserDefaults
  ) {
    if defaults.object(forKey: keys.textBackground) != nil {
      let bg = defaults.bool(forKey: keys.textBackground)
      style.textBackground = bg
      style.textPlate = bg ? .solid : .none
    }
    if let raw = defaults.string(forKey: keys.textPlate),
      let plate = AnnotationTextPlate(rawValue: raw)
    {
      style.textPlate = plate
      style.textBackground = plate != .none
    }
    if let redaction = defaults.string(forKey: keys.redaction).flatMap(
      AnnotationRedaction.init(rawValue:))
    {
      style.redaction = redaction
    }
    if let fill = defaults.string(forKey: keys.fillMode).flatMap(AnnotationFillMode.init(rawValue:))
    {
      style.fillMode = fill
    }
    if let corner = defaults.string(forKey: keys.cornerStyle).flatMap(
      AnnotationCornerStyle.init(rawValue:))
    {
      style.cornerStyle = corner
    }
    if let radius = defaults.object(forKey: keys.cornerRadius) as? NSNumber,
      radius.doubleValue.isFinite
    {
      style.cornerRadius = CGFloat(max(0, radius.doubleValue))
    }
    if let arrow = defaults.string(forKey: keys.arrowStyle).flatMap(
      AnnotationArrowStyle.init(rawValue:))
    {
      style.arrowStyle = arrow
    }
    if let dashed = defaults.object(forKey: keys.isDashed) as? NSNumber {
      style.isDashed = dashed.boolValue
    }
    if let mosaic = defaults.string(forKey: keys.mosaicMode).flatMap(
      AnnotationMosaicMode.init(rawValue:))
    {
      style.mosaicMode = mosaic
    }
    if let spot = defaults.string(forKey: keys.spotlightShape).flatMap(
      AnnotationSpotlightShape.init(rawValue:))
    {
      style.spotlightShape = spot
    }
    if let family = defaults.string(forKey: keys.fontFamily), !family.isEmpty {
      style.fontFamily = family
    }
  }

  private static func saveSharedStyle(
    _ style: AnnotationStyle, keys: Keys, to defaults: UserDefaults
  ) {
    defaults.set(style.textBackground, forKey: keys.textBackground)
    defaults.set(style.redaction.rawValue, forKey: keys.redaction)
    defaults.set(style.fillMode.rawValue, forKey: keys.fillMode)
    defaults.set(style.cornerStyle.rawValue, forKey: keys.cornerStyle)
    if let radius = style.cornerRadius, radius.isFinite {
      defaults.set(Double(max(0, radius)), forKey: keys.cornerRadius)
    } else {
      defaults.removeObject(forKey: keys.cornerRadius)
    }
    defaults.set(style.arrowStyle.rawValue, forKey: keys.arrowStyle)
    defaults.set(style.isDashed, forKey: keys.isDashed)
    defaults.set(style.textPlate.rawValue, forKey: keys.textPlate)
    defaults.set(style.mosaicMode.rawValue, forKey: keys.mosaicMode)
    defaults.set(style.spotlightShape.rawValue, forKey: keys.spotlightShape)
    if let family = style.fontFamily, !family.isEmpty {
      defaults.set(family, forKey: keys.fontFamily)
    } else {
      defaults.removeObject(forKey: keys.fontFamily)
    }
  }

  private static func loadCustomColor(keys: Keys, from defaults: UserDefaults) -> AnnotationRGBA? {
    guard
      let r = defaults.object(forKey: keys.customR) as? NSNumber,
      let g = defaults.object(forKey: keys.customG) as? NSNumber,
      let b = defaults.object(forKey: keys.customB) as? NSNumber
    else { return nil }
    let a = (defaults.object(forKey: keys.customA) as? NSNumber)?.doubleValue ?? 1.0
    return AnnotationRGBA(red: r.doubleValue, green: g.doubleValue, blue: b.doubleValue, alpha: a)
  }

  private static func saveCustomColor(
    _ color: AnnotationRGBA?, keys: Keys, to defaults: UserDefaults
  ) {
    if let color {
      defaults.set(color.red, forKey: keys.customR)
      defaults.set(color.green, forKey: keys.customG)
      defaults.set(color.blue, forKey: keys.customB)
      defaults.set(color.alpha, forKey: keys.customA)
    } else {
      defaults.removeObject(forKey: keys.customR)
      defaults.removeObject(forKey: keys.customG)
      defaults.removeObject(forKey: keys.customB)
      defaults.removeObject(forKey: keys.customA)
    }
  }

  private struct Keys {
    let color, stroke, textBackground, redaction: String
    let fillMode, cornerStyle, cornerRadius, arrowStyle, isDashed, textPlate: String
    let mosaicMode, spotlightShape, fontFamily: String
    let customR, customG, customB, customA: String

    init(_ slot: AnnotationStyleSlot) {
      let base = AnnotationStyleMemory.prefix + (slot == .highlighter ? "highlighter." : "style.")
      color = base + "color"
      stroke = base + "stroke"
      textBackground = base + "textBackground"
      redaction = base + "redaction"
      fillMode = base + "fillMode"
      cornerStyle = base + "cornerStyle"
      cornerRadius = base + "cornerRadius"
      arrowStyle = base + "arrowStyle"
      isDashed = base + "isDashed"
      textPlate = base + "textPlate"
      mosaicMode = base + "mosaicMode"
      spotlightShape = base + "spotlightShape"
      fontFamily = base + "fontFamily"
      customR = base + "customR"
      customG = base + "customG"
      customB = base + "customB"
      customA = base + "customA"
    }
  }
}
