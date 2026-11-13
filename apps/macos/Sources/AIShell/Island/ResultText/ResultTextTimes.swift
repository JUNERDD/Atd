import AICore
import AppKit
import CoreText

/// A recording's times in a result text (``RecordingAnswerTimes``): each time named on its own,
/// outside a link, links to `scheme://<seconds>`, which the card's player seeks to, and takes
/// digits of one width.
enum ResultTextTimes {
  static func link(in text: NSMutableAttributedString, scheme: String) {
    let string = text.string
    var index = string.startIndex
    var offset = 0
    for mark in RecordingAnswerTimes.marks(in: string) {
      index = string.index(index, offsetBy: mark.offset - offset)
      offset = mark.offset
      let end = string.index(index, offsetBy: mark.length)
      let range = NSRange(index..<end, in: string)
      guard text.attribute(.link, at: range.location, effectiveRange: nil) == nil,
        let url = URL(string: "\(scheme)://\(Int(mark.seconds))")
      else { continue }
      text.addAttribute(.link, value: url, range: range)
      text.enumerateAttribute(.font, in: range) { value, run, _ in
        guard let font = value as? NSFont else { return }
        text.addAttribute(.font, value: monospacedDigits(font), range: run)
      }
    }
  }

  private static var fonts: [NSFont: NSFont] = [:]

  /// `font` with digits of one width.
  private static func monospacedDigits(_ font: NSFont) -> NSFont {
    if let digits = fonts[font] { return digits }
    let feature: [NSFontDescriptor.FeatureKey: Int] = [
      .typeIdentifier: kNumberSpacingType, .selectorIdentifier: kMonospacedNumbersSelector,
    ]
    let descriptor = font.fontDescriptor.addingAttributes([.featureSettings: [feature]])
    let digits = NSFont(descriptor: descriptor, size: font.pointSize) ?? font
    fonts[font] = digits
    return digits
  }
}
