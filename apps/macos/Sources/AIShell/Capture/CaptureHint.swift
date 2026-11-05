import AppKit

/// One piece of a capture hint line: what to do, with the key to press drawn as a keycap in
/// front of it when there is one.
struct CaptureHintSegment: Equatable {
  /// The keycap's text (⌘A, R, Esc, ↵); nil for a gesture or a status.
  var key: String?
  var label: String
  /// When the line is wider than its display, the highest rank is dropped first; 0 stays.
  var rank = 0
}

/// A hint line: its segments, left to right, on one plate.
typealias CaptureHintLine = [CaptureHintSegment]

/// A hint line on a dark rounded plate, keys as keycaps and segments set apart by a dot. The
/// plate is as wide as its segments, which lose the highest ranks first until it fits
/// `maxWidth`; it never takes the mouse.
final class CaptureHintBadge: NSView {
  private let segments: [CaptureHintSegment]

  private static let labelFont = NSFont.systemFont(ofSize: 13)
  private static let keyFont = NSFont.systemFont(ofSize: 11, weight: .semibold)
  private static let padding = CGSize(width: 10, height: 3)
  private static let keyInset: CGFloat = 5
  private static let keyGap: CGFloat = 6
  private static let separatorGap: CGFloat = 8
  private static let separator = "·"

  init(segments: CaptureHintLine, maxWidth: CGFloat) {
    let fitted = Self.fitted(segments, in: maxWidth)
    self.segments = fitted
    super.init(frame: CGRect(origin: .zero, size: Self.size(of: fitted)))
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override var isFlipped: Bool { true }
  override var fittingSize: NSSize { frame.size }
  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func draw(_ dirtyRect: NSRect) {
    NSColor(white: 0, alpha: 0.72).setFill()
    NSBezierPath(roundedRect: bounds, xRadius: 6, yRadius: 6).fill()
    var x = Self.padding.width
    for (index, segment) in segments.enumerated() {
      if index > 0 {
        x += Self.separatorGap
        Self.draw(
          Self.separator, font: Self.labelFont, color: NSColor(white: 1, alpha: 0.45), x: x,
          in: bounds)
        x += Self.width(of: Self.separator, font: Self.labelFont) + Self.separatorGap
      }
      if let key = segment.key {
        let cap = CGRect(
          x: x, y: (bounds.height - Self.keyHeight) / 2, width: Self.keyWidth(key),
          height: Self.keyHeight)
        NSColor(white: 1, alpha: 0.22).setFill()
        NSBezierPath(roundedRect: cap, xRadius: 4, yRadius: 4).fill()
        let textWidth = Self.width(of: key, font: Self.keyFont)
        Self.draw(
          key, font: Self.keyFont, color: .white, x: cap.minX + (cap.width - textWidth) / 2,
          in: bounds)
        x += cap.width + Self.keyGap
      }
      Self.draw(segment.label, font: Self.labelFont, color: .white, x: x, in: bounds)
      x += Self.width(of: segment.label, font: Self.labelFont)
    }
  }

  // MARK: Measuring

  /// `segments` without the highest ranks, one at a time (the last of equals first), while
  /// they are wider than `maxWidth`.
  private static func fitted(_ segments: CaptureHintLine, in maxWidth: CGFloat) -> CaptureHintLine {
    var kept = segments
    while size(of: kept).width > maxWidth, let highest = kept.map(\.rank).max(), highest > 0,
      let index = kept.lastIndex(where: { $0.rank == highest })
    {
      kept.remove(at: index)
    }
    return kept
  }

  private static func size(of segments: CaptureHintLine) -> CGSize {
    let separators =
      CGFloat(max(segments.count - 1, 0))
      * (separatorGap * 2 + width(of: separator, font: labelFont))
    let content = segments.reduce(CGFloat.zero) { total, segment in
      let key = segment.key.map { keyWidth($0) + keyGap } ?? 0
      return total + key + width(of: segment.label, font: labelFont)
    }
    return CGSize(
      width: (padding.width * 2 + separators + content).rounded(.up),
      height: (max(textHeight, keyHeight) + padding.height * 2).rounded(.up))
  }

  private static var textHeight: CGFloat {
    NSAttributedString(string: " ", attributes: [.font: labelFont]).size().height.rounded(.up)
  }

  /// A little taller than the line's text, so the cap reads as a key rather than a highlight.
  private static var keyHeight: CGFloat { textHeight + 2 }

  /// A single character is a square cap; longer text (⌘A, Esc) takes its width and the inset.
  private static func keyWidth(_ key: String) -> CGFloat {
    max(keyHeight, width(of: key, font: keyFont) + keyInset * 2)
  }

  private static func width(of text: String, font: NSFont) -> CGFloat {
    NSAttributedString(string: text, attributes: [.font: font]).size().width.rounded(.up)
  }

  private static func draw(
    _ text: String, font: NSFont, color: NSColor, x: CGFloat, in frame: CGRect
  ) {
    let string = NSAttributedString(
      string: text, attributes: [.font: font, .foregroundColor: color])
    string.draw(at: CGPoint(x: x, y: ((frame.height - string.size().height) / 2).rounded()))
  }
}
