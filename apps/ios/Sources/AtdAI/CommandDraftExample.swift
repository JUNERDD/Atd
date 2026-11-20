import Foundation

extension CommandDraft {
  /// 存为指令: drafts a command from a sentence and an answer the person liked in 问 Atd. The
  /// answer follows the sentence as an example of the result, marked as one whose details change
  /// from run to run, so the drafted instructions describe the kind of result rather than repeat
  /// that one. Without an example this is the one-sentence request of 新建指令.
  public static func request(_ description: String, example: String) -> ModelRequest {
    var request = request(description)
    let example = example.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !example.isEmpty, let last = request.messages.indices.last else { return request }
    let label = String(localized: "draft.example", table: "CommandDraft", bundle: .module)
    request.messages[last].text += "\n\n\(label)\n\(example)"
    return request
  }
}
