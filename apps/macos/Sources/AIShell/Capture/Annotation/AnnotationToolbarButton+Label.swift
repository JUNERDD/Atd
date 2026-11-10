import AppKit

extension AnnotationToolbarButton {
  /// The labelled button's metrics (visual spec, contracts §6) and drawing.
  enum Label {
    static let padding: CGFloat = 10
    static let iconSide: CGFloat = 14
    static let iconGap: CGFloat = 6
    static let maxTextWidth: CGFloat = 160
    static let font = NSFont.systemFont(ofSize: 13, weight: .medium)

    static func width(text: String, hasImage: Bool) -> CGFloat {
      let textWidth = min(ceil(text.size(withAttributes: [.font: font]).width), maxTextWidth)
      return padding * 2 + (hasImage ? iconSide + iconGap : 0) + textWidth
    }

    /// The glyph tinted like the text (the label colour, as the capture toolbar's glyphs draw
    /// in its key window), then the text on one line, cut with an ellipsis.
    static func draw(
      text: String, image: NSImage?, in bounds: NSRect, enabled: Bool,
      textColor: NSColor? = nil, imageColor: NSColor? = nil
    ) {
      let color =
        textColor ?? (enabled ? NSColor.labelColor : AnnotationToolbarButton.disabledColor)
      var x = bounds.minX + padding
      if let image {
        let icon = NSRect(
          x: x, y: bounds.midY - iconSide / 2, width: iconSide, height: iconSide)
        tinted(image, imageColor ?? color, size: icon.size).draw(in: icon)
        x += iconSide + iconGap
      }
      let style = NSMutableParagraphStyle()
      style.lineBreakMode = .byTruncatingTail
      let attributes: [NSAttributedString.Key: Any] = [
        .font: font, .foregroundColor: color, .paragraphStyle: style,
      ]
      let height = ceil(font.ascender - font.descender + font.leading)
      let rect = NSRect(
        x: x, y: bounds.midY - height / 2, width: max(0, bounds.maxX - padding - x),
        height: height)
      NSAttributedString(string: text, attributes: attributes).draw(in: rect)
    }

    /// A template glyph in `color` at `size`; it draws in the appearance of the view being
    /// drawn.
    static func tinted(_ image: NSImage, _ color: NSColor, size: NSSize) -> NSImage {
      NSImage(size: size, flipped: false) { rect in
        image.draw(in: rect)
        color.set()
        rect.fill(using: .sourceAtop)
        return true
      }
    }
  }
}
