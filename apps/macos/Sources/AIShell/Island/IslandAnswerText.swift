import AICore
import SwiftUI

/// The answer: the label type at regular weight in the label colour, wrapping, selectable; as
/// Markdown while the user's Markdown in results setting is on (``ResultMarkdown``), plain text
/// otherwise (``ResultText``).
struct IslandAnswerText: View {
  let text: String

  var body: some View {
    ResultText(
      content: ResultTextContent(text: text, markdown: ResultMarkdown.shared.enabled),
      maxWidth: IslandMetrics.resultTextWidth - IslandMetrics.rowPadding * 2
    )
    .fixedSize(horizontal: false, vertical: true)
    .padding(.horizontal, IslandMetrics.rowPadding)
    .frame(maxWidth: IslandMetrics.resultTextWidth, alignment: .leading)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  /// Ideal unclipped width including horizontal row padding, measured directly via TextKit.
  static func measuredIdealWidth(text: String) -> Double {
    let maxTextWidth = IslandMetrics.resultTextWidth - IslandMetrics.rowPadding * 2
    let content = ResultTextContent(text: text, markdown: ResultMarkdown.shared.enabled)
    let textWidth = ResultTextMeasure.size(
      of: content.rendered, width: nil, maxWidth: maxTextWidth
    ).width
    return min(textWidth + IslandMetrics.rowPadding * 2, IslandMetrics.resultTextWidth)
  }

  /// Wrapped height at `width` (the answer column's inner width), measured directly via TextKit.
  static func measuredHeight(text: String, width: Double) -> Double {
    let maxTextWidth = IslandMetrics.resultTextWidth - IslandMetrics.rowPadding * 2
    let content = ResultTextContent(text: text, markdown: ResultMarkdown.shared.enabled)
    let textWidth = max(min(width, IslandMetrics.resultTextWidth) - IslandMetrics.rowPadding * 2, 1)
    return ResultTextMeasure.size(
      of: content.rendered, width: textWidth, maxWidth: maxTextWidth
    ).height
  }
}

extension IslandType {
  /// The answer card's answer: the label size at regular weight.
  static let answer = Font.system(size: 13)
}
