import AtdAI
import AtdActions
import AtdModel
import Foundation

/// What runs read and reach: the shared files, the person's models, their calendar and
/// reminders, the Live Activities and the clock. `live()` wires the real ones; tests pass fakes.
public struct AutomationEnvironment: Sendable {
  /// The automation files, with the command library, the ledger and the settings beside them.
  public var store: SharedStore
  public var generator: any TextGenerating
  public var agenda: any AgendaReading
  public var activities: any ActivityPresenting
  public var now: @Sendable () -> Date
  public var calendar: Calendar

  public init(
    store: SharedStore, generator: any TextGenerating, agenda: any AgendaReading,
    activities: any ActivityPresenting, now: @escaping @Sendable () -> Date = { .now },
    calendar: Calendar = .current
  ) {
    self.store = store
    self.generator = generator
    self.agenda = agenda
    self.activities = activities
    self.now = now
    self.calendar = calendar
  }

  /// The App Group's files, the models in its settings with their keys from the Keychain,
  /// EventKit and ActivityKit; nil where the process has no App Group.
  public static func live() -> AutomationEnvironment? {
    guard let store = AutomationStore.live() else { return nil }
    return AutomationEnvironment(
      store: store, generator: ModelRunner(settings: { store.load(AppSettings.self).document }),
      agenda: TodayReader(), activities: LiveActivityPresenter())
  }
}

/// Reads a day's agenda for an automation step.
public protocol AgendaReading: Sendable {
  /// The agenda of the day of `day`.
  /// - Parameter asking: whether the system may ask for access first, which only a run the
  ///   person started in the app does; a run Shortcuts starts reads what Atd may already read.
  /// - Throws: `ActionError.denied` when neither the calendar nor reminders can be read.
  func agenda(for day: Date, asking: Bool) async throws -> Agenda
}

extension TodayReader: AgendaReading {
  public func agenda(for day: Date, asking: Bool) async throws -> Agenda {
    try await agenda(for: day, calendar: .current, asking: asking)
  }
}
