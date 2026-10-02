import Foundation

/// The style bar controls that apply to a shape or a tool.
public struct AnnotationStyleControls: OptionSet, Sendable {
  public let rawValue: Int
  public init(rawValue: Int) { self.rawValue = rawValue }

  public static let colors = Self(rawValue: 1 << 0)
  public static let strokes = Self(rawValue: 1 << 1)
  public static let textBackground = Self(rawValue: 1 << 2)
}

/// Which remembered style a tool draws with and the style bar edits (decision E8): the
/// highlighter keeps its own, so a broad yellow marker does not turn the next arrow yellow.
public enum AnnotationStyleSlot: Sendable {
  case shared, highlighter
}

extension AnnotationShape {
  /// What the style bar offers for this shape: a mosaic draws only the screenshot's pixels (its
  /// stroke sets the block size), a spotlight has no style, text also has its background.
  public var styleControls: AnnotationStyleControls {
    switch self {
    case .mosaic: .strokes
    case .spotlight: []
    case .text: [.colors, .strokes, .textBackground]
    case .rectangle, .ellipse, .arrow, .line, .pen, .highlighter, .step: [.colors, .strokes]
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
    case .select, .spotlight: []
    case .mosaic: .strokes
    case .text: [.colors, .strokes, .textBackground]
    case .rectangle, .ellipse, .arrow, .line, .pen, .highlighter, .step: [.colors, .strokes]
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

  /// Red at medium for everything; the highlighter starts yellow at medium.
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
/// `capture.annotation.` keys (decision E8). Values are the enums' raw values; a missing or
/// unknown value falls back to that slot's default, so a renamed case costs only the remembered
/// choice. The tool is deliberately not remembered: every session opens with none.
public enum AnnotationStyleMemory {
  public static let prefix = "capture.annotation."

  public static func load(from defaults: UserDefaults) -> AnnotationStyles {
    var styles = AnnotationStyles.defaults
    for slot in [AnnotationStyleSlot.shared, .highlighter] {
      let keys = Keys(slot)
      var style = styles[slot]
      if let color = defaults.string(forKey: keys.color).flatMap(AnnotationColor.init(rawValue:)) {
        style.color = color
      }
      if let stroke = defaults.string(forKey: keys.stroke).flatMap(AnnotationStroke.init(rawValue:))
      {
        style.stroke = stroke
      }
      if slot == .shared, defaults.object(forKey: keys.textBackground) != nil {
        style.textBackground = defaults.bool(forKey: keys.textBackground)
      }
      styles[slot] = style
    }
    return styles
  }

  public static func save(_ styles: AnnotationStyles, to defaults: UserDefaults) {
    for slot in [AnnotationStyleSlot.shared, .highlighter] {
      let keys = Keys(slot)
      defaults.set(styles[slot].color.rawValue, forKey: keys.color)
      defaults.set(styles[slot].stroke.rawValue, forKey: keys.stroke)
      // Text never uses the highlighter style, so only the shared slot keeps a background.
      if slot == .shared { defaults.set(styles.shared.textBackground, forKey: keys.textBackground) }
    }
  }

  private struct Keys {
    let color: String
    let stroke: String
    let textBackground: String

    init(_ slot: AnnotationStyleSlot) {
      let base = AnnotationStyleMemory.prefix + (slot == .highlighter ? "highlighter." : "style.")
      color = base + "color"
      stroke = base + "stroke"
      textBackground = base + "textBackground"
    }
  }
}
