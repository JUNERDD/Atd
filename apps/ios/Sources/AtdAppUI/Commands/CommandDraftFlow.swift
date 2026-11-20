import AtdAI
import AtdInk
import AtdModel
import Foundation
import Observation
import UIKit

/// Drafting a command: the sentence that describes it, the default model's draft, then the draft
/// under review until it is saved. 新建指令 starts from an empty sentence or a blank form;
/// 存为指令 starts from a question in 问 Atd and sends its answer along as an example.
@Observable
final class CommandDraftFlow {
  enum Step {
    case describe, drafting, review
  }

  private(set) var step = Step.describe
  /// The sentence the command is drafted from.
  var text: String
  /// The command under review; the editor changes it.
  var draft = CommandDraft.blank(tint: .purple)
  /// Why the last attempt did not produce a command, shown under the sentence.
  private(set) var failure: ModelFailure?
  /// An answer whose kind of result the command should give (存为指令).
  @ObservationIgnored let example: String?
  @ObservationIgnored private var drafting: Task<Void, Never>?

  init(text: String = "", example: String? = nil) {
    self.text = text
    self.example = example
  }

  /// A draft is saved only with a name.
  var canSave: Bool {
    step == .review && !draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  /// The command to save: the draft with its name trimmed.
  var finished: Command {
    var command = draft
    command.name = command.name.trimmingCharacters(in: .whitespacesAndNewlines)
    return command
  }

  /// 生成: asks the default model for a command and shows it for review, or goes back to the
  /// sentence with the reason it did not work.
  func generate(runner: some TextGenerating, onFailure: @escaping (ModelFailure) -> Void) {
    let description = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !description.isEmpty else { return }
    drafting?.cancel()
    failure = nil
    step = .drafting
    let request =
      example.map { CommandDraft.request(description, example: $0) }
      ?? CommandDraft.request(description)
    drafting = Task {
      var answer = ""
      do {
        for try await delta in runner.stream(request, choice: .appDefault) {
          answer += delta
        }
        guard !Task.isCancelled else { return }
        guard var command = CommandDraft.command(from: answer) else {
          failure = .unreadable(detail: nil)
          step = .describe
          return
        }
        // The model may name a symbol this system does not have.
        if UIImage(systemName: command.symbol) == nil { command.symbol = "sparkles" }
        draft = command
        step = .review
      } catch let error as ModelFailure {
        guard !Task.isCancelled else { return }
        failure = error
        onFailure(error)
        step = .describe
      } catch {
        // Cancelled: the person went back to the sentence.
      }
    }
  }

  /// 从空白开始: an empty command in a hue of its own, straight to the editor.
  func startBlank() {
    let id = UUID().uuidString
    let tints = CommandTint.allCases.filter { $0 != .gray }
    draft = CommandDraft.blank(id: id, tint: tints[inkSeed(id) % tints.count])
    step = .review
  }

  /// Back to the sentence; a draft on its way is dropped.
  func back() {
    cancel()
    step = .describe
  }

  func cancel() {
    drafting?.cancel()
    drafting = nil
  }
}
