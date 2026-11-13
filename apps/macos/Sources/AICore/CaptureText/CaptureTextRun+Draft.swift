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

    /// The draft `update` sends (none: its answer has not begun), keeping only pieces about a
    /// paragraph the run reads or normalized visual coordinates (`keeps`).
    init(_ update: CaptureTextProgressParams.Draft?, keeps: (Item) -> Bool) {
      text = update?.text ?? ""
      lead = update?.result?.lead ?? ""
      items = (update?.result?.items ?? []).filter(keeps)
    }
  }
}

extension CaptureTextRun.Item {
  /// A piece about a recognized paragraph, without normalized visual coordinates.
  public init(paragraph: String, tool: Tool, phrase: String?, text: String) {
    self.init(
      tool: tool, paragraph: paragraph, phrase: phrase, point: nil, coords: nil, text: text)
  }
}
