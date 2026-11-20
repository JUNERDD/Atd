import AtdAI
import AtdActions
import AtdModel
import Foundation
import Observation

/// One trial run at a time, the way the command's entry points run it: a command whose result
/// goes into a field streams its text; a card command, or one that reads a photo, gets its card
/// from `CardRunner`, as the share sheet, the camera and Siri show it. 今日简报 reads today's
/// agenda without asking for access, so what Atd may not read stays out, as it would. Nothing is
/// written anywhere: a card's actions (添加到日历, 记入记账本) belong to the entry points.
@Observable
final class TrialRun {
  /// What a run sends: the text for a command that reads text, the photo for one that reads a
  /// photo.
  struct Input {
    var text = ""
    var photo: ModelImage?
  }

  private(set) var output = ""
  private(set) var card: CardResult?
  private(set) var isRunning = false
  /// Why the last run stopped short, in a line.
  private(set) var failure: String?
  /// The option values of the last run.
  private(set) var ranWith: [String: String]?
  @ObservationIgnored private var task: Task<Void, Never>?
  /// The run whose output is on show; a stopped run's late answer is dropped.
  @ObservationIgnored private var current: UUID?

  var hasRun: Bool { ranWith != nil }

  /// Whether the run's result is a card: a card command's own, or a text card for a command that
  /// reads a photo, which never goes into a field.
  static func showsCard(_ command: Command) -> Bool {
    command.output.action == .card || command.input == .image
  }

  func start(
    _ command: Command, input: Input, runner: some TextGenerating,
    onFailure: @escaping (ModelFailure) -> Void
  ) {
    task?.cancel()
    output = ""
    card = nil
    failure = nil
    isRunning = true
    ranWith = command.values
    let text =
      command.input == .none ? "" : input.text.trimmingCharacters(in: .whitespacesAndNewlines)
    let run = UUID()
    current = run
    task = Task {
      do {
        if Self.showsCard(command) {
          let card = try await Self.card(command, text: text, photo: input.photo, runner: runner)
          guard current == run else { return }
          self.card = card
        } else {
          let request = CommandPrompt.request(.command(command), input: text)
          for try await delta in runner.stream(request, choice: command.model) {
            guard current == run else { return }
            output += delta
          }
          guard current == run else { return }
          if output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            failure = ModelFailure.unreadable(detail: nil).message
          }
        }
      } catch let error as ModelFailure {
        guard current == run else { return }
        failure = error.message
        onFailure(error)
      } catch let error as CardFailure {
        guard current == run else { return }
        failure = error.message
      } catch {
        // Stopped.
      }
      if current == run { isRunning = false }
    }
  }

  func stop() {
    task?.cancel()
    task = nil
    current = nil
    isRunning = false
  }

  private static func card(
    _ command: Command, text: String, photo: ModelImage?, runner: some TextGenerating
  ) async throws -> CardResult {
    var input = CardInput(text: text, images: photo.map { [$0] } ?? [])
    if command.id == BuiltinCommands.briefingID {
      // Without the calendar and reminders both, the prompt says Atd could read neither.
      input.agenda = try? await TodayReader().agenda(asking: false)
    }
    return try await CardRunner(generator: runner).run(command, input: input)
  }
}
