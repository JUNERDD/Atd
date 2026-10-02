import AICore
import AppKit

/// Images of the annotation toolbar. Functional glyphs are Lucide template image sets in the App
/// target's asset catalog (`App/Assets.xcassets/Capture/lucide-<name>.imageset`), found in the
/// main bundle by `NSImage(named:)` like the status item's images. Outside the app bundle
/// (`swift run`, tests) they are missing and the controls keep their tooltips and labels.
///
/// Source: unmodified SVGs from lucide-static 1.48.0 (ISC), the `lucide-react` version pinned in
/// `apps/desktop/package.json`, each from `https://unpkg.com/lucide-static@1.48.0/icons/<name>.svg`
/// for the names below. Swatches and stroke widths depict their values, so they are drawn here.
enum AnnotationIcons {
  static let undo = "undo-2"
  static let redo = "redo-2"
  static let cancel = "x"
  static let confirm = "check"
  static let textBackground = "square-text"

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
      let dot = NSBezierPath(ovalIn: rect.insetBy(dx: 1, dy: 1))
      color.nsColor.setFill()
      dot.fill()
      NSColor.labelColor.withAlphaComponent(0.4).setStroke()
      dot.lineWidth = 1
      dot.stroke()
      return true
    }
    image.accessibilityDescription = label
    return image
  }

  /// A template dot as wide as the stroke it stands for (scaled to fit the control).
  static func stroke(_ stroke: AnnotationStroke, label: String) -> NSImage {
    let diameter: CGFloat =
      switch stroke {
      case .thin: 4
      case .medium: 7
      case .thick: 11
      }
    let image = NSImage(size: NSSize(width: 14, height: 14), flipped: false) { rect in
      NSColor.black.setFill()
      let dot = CGRect(
        x: rect.midX - diameter / 2, y: rect.midY - diameter / 2, width: diameter,
        height: diameter)
      NSBezierPath(ovalIn: dot).fill()
      return true
    }
    image.isTemplate = true
    image.accessibilityDescription = label
    return image
  }
}

extension AnnotationColor {
  var nsColor: NSColor {
    let rgb = components
    return NSColor(srgbRed: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
  }
}
