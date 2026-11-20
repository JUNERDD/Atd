import AtdAI
import AtdActions
import AtdModel
import Foundation

/// Performs one step that runs by itself: the agenda, the ledger, the briefing or a command.
/// Messages and the focus timer are the engine's, since they wait for the person or outlive the
/// run.
///
/// A step that cannot be done fails with a line saying why, and the run goes on; only
/// cancellation (the time ran out, or the run was stopped) is thrown.
struct StepPerformer: Sendable {
  let environment: AutomationEnvironment
  /// Whether the system may ask for calendar and reminders access: only for a run the person
  /// started in the app, never for one Shortcuts started in the background.
  let asking: Bool

  func perform(_ step: AutomationStep, input: String?) async throws -> StepOutcome {
    let now = environment.now()
    switch step {
    case .agenda(let day):
      do {
        let agenda = try await environment.agenda.agenda(
          for: day.date(from: now, calendar: environment.calendar), asking: asking)
        return .done(
          text: StepText.agenda(agenda, day: day), output: StepText.listing(agenda, day: day))
      } catch {
        try Task.checkCancellation()
        return .failed(text: StepText.agendaDenied)
      }
    case .ledgerToday:
      let ledger = environment.store.load(Ledger.self).document
      let text = StepText.spending(ledger.spending(onDayOf: now, calendar: environment.calendar))
      return .done(text: text, output: text)
    case .briefing(let day):
      return try await briefing(on: day, at: now)
    case .command(let id):
      return try await command(id, input: input)
    case .message, .focus:
      // The engine stops at a message, and a focus timer is an automation of its own; neither
      // runs as a plain step.
      return .skipped(text: StepText.notRun)
    }
  }

  /// 今日简报 on the day's agenda, with the briefing command's options as the person left them.
  private func briefing(on day: AgendaDay, at now: Date) async throws -> StepOutcome {
    let commands = environment.store.load(CommandLibrary.self).document
    guard
      let command = commands.command(BuiltinCommands.briefingID)
        ?? BuiltinCommands.all().first(where: { $0.id == BuiltinCommands.briefingID })
    else { return .failed(text: StepText.commandDeleted) }
    // Without access the prompt says the calendar could not be read, rather than looking empty.
    let agenda = try? await environment.agenda.agenda(
      for: day.date(from: now, calendar: environment.calendar), asking: asking)
    try Task.checkCancellation()
    do {
      let card = try await CardRunner(generator: environment.generator)
        .run(command, input: CardInput(agenda: agenda), context: CardContext(now: now))
      guard case .briefing(let briefing) = card, let first = briefing.sentences.first else {
        return .failed(text: StepText.noResult)
      }
      return .done(text: first, output: briefing.sentences.joined(separator: "\n"))
    } catch {
      return try failure(error)
    }
  }

  /// A library command on the previous step's result, or on its instructions alone when it reads
  /// nothing (A27: no calendar or ledger data goes with it).
  private func command(_ id: String, input: String?) async throws -> StepOutcome {
    guard let command = environment.store.load(CommandLibrary.self).document.command(id) else {
      return .failed(text: StepText.commandDeleted)
    }
    var text = ""
    if command.input != .none {
      guard let input, !input.isEmpty else { return .failed(text: StepText.nothingToWorkOn) }
      text = input
    }
    do {
      var answer = ""
      let request = CommandPrompt.request(.command(command), input: text)
      for try await delta in environment.generator.stream(request, choice: command.model) {
        answer += delta
      }
      try Task.checkCancellation()
      let result = answer.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !result.isEmpty else { return .failed(text: StepText.noResult) }
      return .done(text: StepText.firstLine(result), output: result)
    } catch {
      return try failure(error)
    }
  }

  /// The failed step's line for what a model run threw; cancellation goes on up.
  private func failure(_ error: any Error) throws -> StepOutcome {
    try Task.checkCancellation()
    switch error {
    case is CancellationError: throw error
    case let failure as ModelFailure: return .failed(text: failure.message)
    case let failure as CardFailure: return .failed(text: failure.message)
    default: return .failed(text: StepText.noResult)
    }
  }
}
