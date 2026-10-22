import AICore
import Foundation

/// Matches the whole observed OCR text, allowing a separate leading icon to change recognition.
/// The caller must first restrict fresh boxes to the observed window region and validate the
/// observation, surface and capture geometry. This never supplies or chooses a point itself.
nonisolated enum NativeOCRTextMatch {
  static func locate(_ text: String, in boxes: [ComputerTextBoxWire])
    -> Result<ComputerTextBoxWire, NativeRecognizedText.Failure>
  {
    let wanted = normalized(text)
    guard !wanted.isEmpty else { return .failure(.notFound(text: text)) }
    let wantedForm = form(text)
    let matches = boxes.filter { box in
      if normalized(box.text) == wanted { return true }
      guard let wantedForm, let candidate = form(box.text),
        wantedForm.removedPrefix || candidate.removedPrefix
      else { return false }
      return candidate.body == wantedForm.body
    }
    switch matches.count {
    case 0: return .failure(.notFound(text: text))
    case 1: return .success(matches[0])
    default: return .failure(.ambiguous(text: text, candidates: matches.map(\.text)))
    }
  }

  private static let prefixes: Set<Character> = ["•", "▶", "►"]

  private static func normalized(_ text: String) -> String {
    text.lowercased().split(whereSeparator: \.isWhitespace).joined()
  }

  /// Remove exactly one allow-listed, whitespace-separated prefix. Keep every other symbol
  /// and the whole body; semantic signs, internal punctuation and OCR letter errors stay distinct.
  private static func form(_ text: String) -> (body: String, removedPrefix: Bool)? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    var body = trimmed
    var removedPrefix = false
    if let first = trimmed.first, prefixes.contains(first) {
      let rest = trimmed.dropFirst()
      guard rest.first?.isWhitespace == true else { return nil }
      body = rest.trimmingCharacters(in: .whitespacesAndNewlines)
      guard let start = body.first, !prefixes.contains(start) else { return nil }
      removedPrefix = true
    }
    guard body.filter({ $0.isLetter || $0.isNumber }).count >= 2 else { return nil }
    return (normalized(body), removedPrefix)
  }
}
