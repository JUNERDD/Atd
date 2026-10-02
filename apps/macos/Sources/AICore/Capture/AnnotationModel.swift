import CoreGraphics
import Foundation

// The screenshot annotation model: plain values in the capture overlay's view points (origin at
// the display's top-left, y down), so the live canvas, hit-testing and export all read the same
// data. Annotations are anchored to the screen: the selection moves and resizes over them and
// only decides what is exported (decision D14). AICore stays free of AppKit; the shell turns
// colours and text into drawing objects.

/// The six swatches of the annotation toolbar. The raw values are what style memory stores
/// (``AnnotationStyleMemory``), so they must not change.
public enum AnnotationColor: String, CaseIterable, Sendable {
  case red, yellow, green, blue, black, white

  /// sRGB components in 0...1, matching the system accent palette.
  public var components: (red: Double, green: Double, blue: Double) {
    switch self {
    case .red: (1, 0.231, 0.188)
    case .yellow: (1, 0.8, 0)
    case .green: (0.204, 0.78, 0.349)
    case .blue: (0, 0.478, 1)
    case .black: (0, 0, 0)
    case .white: (1, 1, 1)
    }
  }

  /// Light swatches carry dark text on a step badge or a text plate, and a dark edge on the
  /// toolbar swatch.
  public var isLight: Bool {
    let rgb = components
    return 0.2126 * rgb.red + 0.7152 * rgb.green + 0.0722 * rgb.blue > 0.6
  }
}

/// The three stroke widths; each tool reads the measure it draws with. The raw values are what
/// style memory stores, so they must not change.
public enum AnnotationStroke: String, CaseIterable, Sendable {
  case thin, medium, thick

  /// Outline width of rectangles, ellipses, arrows, lines and the pen.
  public var lineWidth: CGFloat {
    switch self {
    case .thin: 2
    case .medium: 4
    case .thick: 7
    }
  }

  /// The highlighter is a broad translucent marker, several times the line width.
  public var highlighterWidth: CGFloat {
    switch self {
    case .thin: 12
    case .medium: 20
    case .thick: 30
    }
  }

  /// Point size of text annotations.
  public var fontSize: CGFloat {
    switch self {
    case .thin: 16
    case .medium: 22
    case .thick: 30
    }
  }

  /// How coarse a mosaic's blocks are, relative to the region's own block size
  /// (``AnnotationPath/mosaicBlock(for:stroke:)``).
  public var mosaicScale: CGFloat {
    switch self {
    case .thin: 0.75
    case .medium: 1
    case .thick: 1.6
    }
  }

  /// Diameter of a step-number badge.
  public var stepDiameter: CGFloat {
    switch self {
    case .thin: 22
    case .medium: 28
    case .thick: 36
    }
  }

  /// The stroke one step thinner (`-1`) or thicker (`1`); the same stroke at either end, so
  /// stepping never wraps.
  public func stepped(by direction: Int) -> AnnotationStroke {
    let all = Self.allCases
    guard let index = all.firstIndex(of: self) else { return self }
    return all[min(max(index + direction, 0), all.count - 1)]
  }

  /// Width of a step badge's tail, scaled with the badge.
  public var stepTailWidth: CGFloat { stepDiameter / 8 }

  /// Length of a step badge tail's arrowhead: small, so it does not outweigh the badge.
  public var stepTailHeadLength: CGFloat { stepDiameter * 0.4 }
}

/// Colour, stroke and text background of one annotation; also the style bar's current choice
/// for new ones.
public struct AnnotationStyle: Equatable, Sendable {
  public var color: AnnotationColor
  public var stroke: AnnotationStroke
  /// Text only: the text sits on a rounded plate in ``color`` and its glyphs turn black or
  /// white for contrast (decision E9). Other shapes ignore it.
  public var textBackground: Bool

  public init(
    color: AnnotationColor = .red, stroke: AnnotationStroke = .medium, textBackground: Bool = false
  ) {
    self.color = color
    self.stroke = stroke
    self.textBackground = textBackground
  }

  /// This style with only what the style bar changed replaced, so picking a colour keeps an
  /// annotation's stroke and the other way round.
  public func with(
    color: AnnotationColor? = nil, stroke: AnnotationStroke? = nil, textBackground: Bool? = nil
  ) -> Self {
    Self(
      color: color ?? self.color, stroke: stroke ?? self.stroke,
      textBackground: textBackground ?? self.textBackground)
  }
}

/// One change the style bar makes: only the parts it names.
public struct AnnotationStyleChange: Equatable, Sendable {
  public var color: AnnotationColor?
  public var stroke: AnnotationStroke?
  public var textBackground: Bool?

  public init(
    color: AnnotationColor? = nil, stroke: AnnotationStroke? = nil, textBackground: Bool? = nil
  ) {
    self.color = color
    self.stroke = stroke
    self.textBackground = textBackground
  }

  public func applied(to style: AnnotationStyle) -> AnnotationStyle {
    style.with(color: color, stroke: stroke, textBackground: textBackground)
  }
}

/// What an annotation draws, with its geometry.
public enum AnnotationShape: Equatable, Sendable {
  case rectangle(CGRect)
  case ellipse(CGRect)
  case arrow(from: CGPoint, to: CGPoint)
  case line(from: CGPoint, to: CGPoint)
  /// Raw pointer samples; the renderer smooths them (``AnnotationPath``).
  case pen([CGPoint])
  case highlighter([CGPoint])
  /// `frame` is the laid-out text's box: its origin is where the first line starts and its size
  /// is what the editor measured, so hit-testing needs no text layout.
  case text(String, frame: CGRect)
  /// Pixelates the screenshot under the rect.
  case mosaic(CGRect)
  /// A numbered badge, optionally with a tail from its edge to `tip` that ends in a small
  /// arrowhead (``AnnotationPath/stepTailStart(center:tip:diameter:)``). The number is not
  /// stored: it is the badge's position among the document's step badges, so deleting one
  /// renumbers the rest (and undo restores them).
  case step(center: CGPoint, tip: CGPoint? = nil)
  /// Keeps the rect bright: once any spotlight exists, the screenshot outside the union of all
  /// spotlights is dimmed (decision E11). It has no style and paints nothing of its own.
  case spotlight(CGRect)
}

/// One annotation on the frozen display.
public struct Annotation: Equatable, Identifiable, Sendable {
  public let id: UUID
  public var shape: AnnotationShape
  public var style: AnnotationStyle

  public init(id: UUID = UUID(), shape: AnnotationShape, style: AnnotationStyle) {
    self.id = id
    self.shape = shape
    self.style = style
  }
}

/// The annotation tools (D9, E11), in toolbar order.
public enum AnnotationTool: CaseIterable, Sendable {
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
