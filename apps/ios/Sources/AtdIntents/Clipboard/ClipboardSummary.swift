import AtdAI
import AtdModel
import Foundation

/// 总结剪贴板: the request for at most three points, and the points read back from the answer.
///
/// The request is fixed rather than 缩短's 要点 version, whose choices the person may edit.
public enum ClipboardSummary {
  public static let limit = 3

  public static func request(for text: String) -> ModelRequest {
    CommandPrompt.request(.request(EntryText.string("summary.request")), input: text)
  }

  /// Sums `text` up with the app's default model.
  /// - Throws: a `ModelFailure`, `.unreadable` for an answer without a single point, or
  ///   `CancellationError`.
  public static func summarize(_ text: String, with generator: some TextGenerating) async throws
    -> [String]
  {
    var answer = ""
    for try await delta in generator.stream(request(for: text), choice: .appDefault) {
      answer += delta
    }
    let points = points(from: answer)
    guard !points.isEmpty else { throw ModelFailure.unreadable(detail: nil) }
    return points
  }

  /// The answer's first points, one per line, without their bullets or numbers.
  public static func points(from answer: String) -> [String] {
    let lines = answer.split(whereSeparator: \.isNewline).map { point(String($0)) }
    return Array(lines.filter { !$0.isEmpty }.prefix(limit))
  }

  /// "- ", "• ", "1. ", "1、", "(1)" and the like taken off a line.
  static func point(_ line: String) -> String {
    let marker = /^\s*(?:[-–—•·*▪●]+|\d{1,2}[.、)）]|[(（]\d{1,2}[)）])\s*/
    var line = line
    if let match = line.prefixMatch(of: marker) {
      line.removeSubrange(match.range)
    }
    return line.trimmingCharacters(in: .whitespaces)
  }
}
