import Foundation

extension CaptureTextRun {
  /// The version being made of a run that has versions (`captureText.progress`'s `draft`), as its
  /// answer grows: the result card shows it as its newest page, which the person may page away
  /// from while it is made, and nothing of it lands on the image, previews there or is copied
  /// until it becomes a version (the run's ``review``). Empty until its answer begins.
  public struct Draft: Equatable, Sendable {
    /// Its answer so far, as the card shows an answer that stays on it.
    public let text: String
    /// The text before its first piece, for an output that lands on the image.
    public let lead: String
    /// Its pieces completed so far about a paragraph the run reads, in the answer's order.
    public let items: [Item]

    /// The draft `update` sends (none: its answer has not begun), keeping only the pieces about a
    /// paragraph the run `reads`, by its id in the run.
    init(_ update: CaptureTextProgressParams.Draft?, reads: (String) -> Bool) {
      text = update?.text ?? ""
      lead = update?.result?.lead ?? ""
      items = (update?.result?.items ?? []).map(Item.init(draft:)).filter { reads($0.paragraph) }
    }
  }
}

extension CaptureTextRun.Item {
  /// A piece of a draft as the run keeps the pieces of its versions.
  fileprivate init(draft item: CaptureTextProgressParams.Draft.Result.Item) {
    let tool: Tool =
      switch item.tool {
      case .replace: .replace
      case .step: .step
      case .highlight: .highlight
      }
    self.init(paragraph: item.paragraph, tool: tool, phrase: item.phrase, text: item.text)
  }
}
