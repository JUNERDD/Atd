import AICore
import SwiftUI

/// An answer's text, selectable, as Markdown while the user's Markdown in results setting is on
/// (``ResultMarkdown``) and plain otherwise (``ResultText``); with `seek`, each time named on its
/// own is a link that seeks the player (``RecordingAnswerTimes``). A stopped answer ends in
/// "Stopped", and a failure with nothing to say says so.
struct IslandAskAnswerText<Range: CardAskRange, Quick: IslandQuickAsk>: View {
  let answer: CardAnswer<Range, Quick>
  let labels: IslandAskLabels<Quick>
  /// Seeks the card's player; nil for a card without one, whose text links no times.
  let seek: ((Double) -> Void)?

  /// The scheme of the links times become; nothing outside this view opens it.
  private static var scheme: String { "atd-recording-seek" }

  /// A blank thinking/streaming page has no text line. Rendering and measurement must agree,
  /// or an empty text's line box overflows the six-point padding-only scroll viewport.
  var isEmpty: Bool {
    answer.text.isEmpty && answer.phase != .failed && answer.phase != .stopped
  }

  var body: some View {
    if !isEmpty {
      ResultText(content: content, maxWidth: IslandMetrics.resultTextWidth) { url in
        guard url.scheme == Self.scheme else { return false }
        if let seconds = Double(url.host() ?? "") { seek?(seconds) }
        return true
      }
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  private var content: ResultTextContent {
    let failed = answer.phase == .failed && answer.text.isEmpty
    return ResultTextContent(
      text: failed ? labels.failed : answer.text,
      markdown: !failed && ResultMarkdown.shared.enabled,
      style: ResultTextStyle(lineSpacing: 4),
      timeScheme: seek == nil ? nil : Self.scheme,
      suffix: answer.phase == .stopped ? labels.stopped : nil)
  }
}
