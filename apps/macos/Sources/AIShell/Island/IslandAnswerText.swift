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
}

extension IslandType {
  /// The answer card's answer: the label size at regular weight.
  static let answer = Font.system(size: 13)
}
