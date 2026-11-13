import AppKit

/// What a result text shows: an answer's text, as Markdown or plain (the user's Markdown in
/// results setting, ``ResultMarkdown``), in a style, with the times it names linked to a
/// recording's player where the card has one, and a note after it (an answer's "Stopped").
struct ResultTextContent: Equatable {
  var text: String
  var markdown: Bool
  var style = ResultTextStyle()
  /// The URL scheme times named on their own link to (``RecordingAnswerTimes``); nil links none.
  var timeScheme: String?
  /// What follows the text in the secondary colour.
  var suffix: String?

  /// The rendered text, shared with every view and measurement of the same content
  /// (``ResultTextRenders``).
  var rendered: NSAttributedString { ResultTextRenders.text(for: self) }

  /// Texts compare byte for byte: String's equality normalizes text that is not ASCII, which
  /// the caches would pay for on every lookup.
  static func == (a: Self, b: Self) -> Bool {
    a.markdown == b.markdown && a.style == b.style && a.timeScheme == b.timeScheme
      && a.suffix == b.suffix && ResultTextRenders.same(a.text, b.text)
  }
}

/// The result texts rendered lately, so a card's views and the measurements of its size (each a
/// new view, every time the island shows or changes) render a content once, and an answer
/// streaming in renders only its last Markdown block anew (``ResultMarkdownDocument``). Plain
/// text is never parsed.
enum ResultTextRenders {
  /// Most recent first. A card shows a few texts at once (its answer, a measured prefix of it,
  /// an ask's answer), and a measurement of the content before them may still come.
  private static var renders: [(content: ResultTextContent, text: NSAttributedString)] = []
  private static var documents: [ResultMarkdownDocument] = []
  private static let kept = 8

  static func text(for content: ResultTextContent) -> NSAttributedString {
    if let index = renders.firstIndex(where: { $0.content == content }) {
      let render = renders.remove(at: index)
      renders.insert(render, at: 0)
      return render.text
    }
    let body =
      content.markdown
      ? document(content.text, style: content.style).text
      : content.style.plain(content.text)
    let text = decorate(body, content)
    renders.insert((content, text), at: 0)
    if renders.count > kept { renders.removeLast() }
    return text
  }

  /// `source` rendered as Markdown, after the longest one rendered lately that it extends.
  private static func document(_ source: String, style: ResultTextStyle)
    -> ResultMarkdownDocument
  {
    var previous: ResultMarkdownDocument?
    for document in documents where document.style == style {
      if same(document.source, source) { return document }
      guard source.utf8.count > document.source.utf8.count,
        source.utf8.starts(with: document.source.utf8),
        document.source.utf8.count > previous?.source.utf8.count ?? -1
      else { continue }
      previous = document
    }
    let document = ResultMarkdownDocument(source: source, style: style, after: previous)
    documents.insert(document, at: 0)
    if documents.count > kept { documents.removeLast() }
    return document
  }

  /// Whether `a` and `b` are the same bytes.
  static func same(_ a: String, _ b: String) -> Bool {
    guard a.utf8.count == b.utf8.count else { return false }
    let contiguous = a.utf8.withContiguousStorageIfAvailable { left in
      b.utf8.withContiguousStorageIfAvailable { right in
        left.count == 0 || memcmp(left.baseAddress!, right.baseAddress!, left.count) == 0
      }
    }
    return contiguous.flatMap { $0 } ?? a.utf8.elementsEqual(b.utf8)
  }

  private static func decorate(_ body: NSAttributedString, _ content: ResultTextContent)
    -> NSAttributedString
  {
    guard content.timeScheme != nil || content.suffix != nil else { return body }
    let text = NSMutableAttributedString(attributedString: body)
    if let scheme = content.timeScheme { ResultTextTimes.link(in: text, scheme: scheme) }
    if let suffix = content.suffix { content.style.append(suffix: suffix, to: text) }
    return text
  }
}
