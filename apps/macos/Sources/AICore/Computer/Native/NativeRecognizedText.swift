import Foundation

/// Locating a pointer step on text a window shows, for content no accessibility element holds,
/// such as an embedded-browser or custom-drawn view: a semantic locator that names only `text`
/// and matches no element of the observation is matched against the text the host recognizes in
/// the window. The host, not the model, picks the point, so the step is not visual and needs no
/// qualified model. Checking whether text appears compares text the same way
/// (``appears(_:in:)``), so a step finds and a condition checks one text alike.
public enum NativeRecognizedText {
  /// The text a semantic locator names when it names nothing else, which only recognized text
  /// can stand in for; nil for a ref, or for a locator with a role, name, label or placeholder
  /// that recognized text cannot have.
  public static func text(of locator: ComputerLocatorWire) -> String? {
    guard case .semantic(let semantic) = locator, semantic.role == nil, semantic.name == nil,
      semantic.label == nil, semantic.placeholder == nil
    else { return nil }
    return semantic.text
  }

  public enum Failure: Error, Equatable, Sendable {
    case notFound(text: String)
    /// The recognized texts that match `text` equally well.
    case ambiguous(text: String, candidates: [String])

    public var code: ComputerErrorCode {
      switch self {
      case .notFound: .notFound
      case .ambiguous: .ambiguous
      }
    }

    public var message: String {
      switch self {
      case .notFound(let text):
        "No element of the observation holds \(Self.quoted(text)), and the window shows no such "
          + "text now; nothing was sent. Observe again."
      case .ambiguous(let text, let candidates):
        "\(candidates.count) texts the window shows match \(Self.quoted(text)) equally: "
          + candidates.prefix(6).map(Self.quoted).joined(separator: ", ")
          + ". Nothing was sent; name the one you mean by more of its text."
      }
    }

    private static func quoted(_ text: String) -> String {
      "“\(text.count > 80 ? "\(text.prefix(80))…" : text)”"
    }
  }

  /// The one box `text` names. A box whose whole text it is wins, else one where it stands as
  /// whole words, else one containing it, ignoring case; the first rule that matches any box
  /// decides, and more than one box under it is ambiguous, since a later rule must not pick among
  /// them. Whole and partial text ignore white space, which recognition may drop or add between
  /// words from one read to the next (it rarely keeps any inside Chinese or Japanese text).
  public static func locate(_ text: String, in boxes: [ComputerTextBoxWire])
    -> Result<ComputerTextBoxWire, Failure>
  {
    let wanted = Form(text)
    guard !wanted.compact.isEmpty else { return .failure(.notFound(text: text)) }
    let rules: [(Form) -> Bool] = [
      { $0.compact == wanted.compact },
      { " \($0.words) ".contains(" \(wanted.words) ") },
      { $0.contains(wanted) },
    ]
    let forms = boxes.map { ($0, Form($0.text)) }
    for rule in rules {
      let matches = forms.filter { rule($0.1) }.map(\.0)
      if matches.count == 1 { return .success(matches[0]) }
      if matches.count > 1 {
        return .failure(.ambiguous(text: text, candidates: matches.map(\.text)))
      }
    }
    return .failure(.notFound(text: text))
  }

  /// Whether `text` shows in any of `texts` (accessibility names and values, or recognized
  /// text), compared as ``locate(_:in:)`` compares: ignoring case and white space. Checking that
  /// text appears and refusing such a check when the baseline already shows its text both use it,
  /// so a check can hold only on text the baseline did not show.
  public static func appears(_ text: String, in texts: [String]) -> Bool {
    let wanted = Form(text)
    return texts.contains { Form($0).contains(wanted) }
  }

  /// A text as compared: lowercased, as its words joined by one space, and with no white space.
  struct Form {
    let words: String
    let compact: String

    init(_ text: String) {
      let words = text.lowercased().split(whereSeparator: \.isWhitespace)
      self.words = words.joined(separator: " ")
      compact = words.joined()
    }

    /// Whether `other` is part of this text; text with nothing but white space is part of none.
    func contains(_ other: Form) -> Bool {
      !other.compact.isEmpty && compact.contains(other.compact)
    }
  }
}
