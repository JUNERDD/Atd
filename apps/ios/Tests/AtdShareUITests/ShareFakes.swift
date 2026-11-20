import AtdAI
import AtdActions
import AtdModel
import Foundation
import Synchronization

@testable import AtdShareUI

/// A model that answers each request with what `answer` says, in a few deltas, and keeps the
/// requests it was sent.
final class FakeModel: TextGenerating {
  enum Answer: Sendable {
    case text(String)
    /// Part of an answer, then the failure.
    case failing(String, ModelFailure)
    /// Part of an answer, then nothing until the request is stopped.
    case hanging(String)
  }

  private let answer: @Sendable (ModelRequest) -> Answer
  private let sent = Mutex<[ModelRequest]>([])

  init(_ answer: @escaping @Sendable (ModelRequest) -> Answer) {
    self.answer = answer
  }

  convenience init(answering text: String) {
    self.init { _ in .text(text) }
  }

  var requests: [ModelRequest] { sent.withLock { $0 } }

  func stream(_ request: ModelRequest, choice: ModelChoice) -> AsyncThrowingStream<
    String, any Error
  > {
    sent.withLock { $0.append(request) }
    let answer = answer(request)
    return AsyncThrowingStream { continuation in
      switch answer {
      case .text(let text):
        for delta in Self.deltas(text) { continuation.yield(delta) }
        continuation.finish()
      case .failing(let text, let failure):
        if !text.isEmpty { continuation.yield(text) }
        continuation.finish(throwing: failure)
      case .hanging(let text):
        continuation.yield(text)
      }
    }
  }

  /// The text in three pieces, as a stream delivers it.
  private static func deltas(_ text: String) -> [String] {
    let third = max(text.count / 3, 1)
    var rest = Substring(text)
    var pieces: [String] = []
    while !rest.isEmpty {
      pieces.append(String(rest.prefix(third)))
      rest = rest.dropFirst(third)
    }
    return pieces
  }
}

/// Calendar as EventKit behaves: access changes only by asking, the person grants or declines as
/// told, and reading or removing needs full access.
final class FakeCalendar: CalendarStore {
  private struct State {
    var access: DataAccess
    var grants: Bool
    var events: [AgendaEvent]
    var requests: [Bool] = []
    var added: [String: NewEvent] = [:]
    var failure: ActionError?
  }

  private let state: Mutex<State>

  init(_ access: DataAccess, grants: Bool = true, events: [AgendaEvent] = []) {
    state = Mutex(State(access: access, grants: grants, events: events))
  }

  var requests: [Bool] { state.withLock { $0.requests } }
  var added: [String: NewEvent] { state.withLock { $0.added } }

  func fail(with error: ActionError) {
    state.withLock { $0.failure = error }
  }

  var eventAccess: DataAccess { state.withLock { $0.access } }

  func requestEventAccess(full: Bool) async throws -> Bool {
    state.withLock { state in
      state.requests.append(full)
      if state.access == .notDetermined { state.access = state.grants ? .writeOnly : .denied }
      return state.access == .writeOnly || state.access == .full
    }
  }

  func addEvent(_ event: NewEvent) async throws -> String {
    try state.withLock { state in
      if let failure = state.failure { throw failure }
      let identifier = "event-\(state.added.count + 1)"
      state.added[identifier] = event
      return identifier
    }
  }

  func removeEvent(_ identifier: String) async -> Bool {
    state.withLock { $0.access == .full && $0.added.removeValue(forKey: identifier) != nil }
  }

  func events(in interval: DateInterval) async -> [AgendaEvent] {
    state.withLock { state in
      state.events.filter { $0.start < interval.end && interval.start < $0.end }
    }
  }
}

/// Reminders as EventKit behaves: full access or none, given by asking once.
final class FakeReminders: ReminderStore {
  private struct State {
    var access: DataAccess
    var grants: Bool
    var added: [String: NewReminder] = [:]
  }

  private let state: Mutex<State>

  init(_ access: DataAccess, grants: Bool = true) {
    state = Mutex(State(access: access, grants: grants))
  }

  var added: [String: NewReminder] { state.withLock { $0.added } }
  var reminderAccess: DataAccess { state.withLock { $0.access } }

  func requestReminderAccess() async throws -> Bool {
    state.withLock { state in
      if state.access == .notDetermined { state.access = state.grants ? .full : .denied }
      return state.access == .full
    }
  }

  func addReminders(_ reminders: [NewReminder]) async throws -> [String] {
    state.withLock { state in
      reminders.map { reminder in
        let identifier = "reminder-\(state.added.count + 1)"
        state.added[identifier] = reminder
        return identifier
      }
    }
  }

  func removeReminders(_ identifiers: [String]) async -> Bool {
    state.withLock { state in
      identifiers.allSatisfy { state.added.removeValue(forKey: $0) != nil }
    }
  }

  func incompleteReminders(dueBefore end: Date) async -> [AgendaReminder] { [] }
}

/// Pages behind shared links, by address.
@MainActor final class FakePages: PageReading {
  var pages: [URL: SharedPage] = [:]
  var failure: PageFailure?
  private(set) var reads: [URL] = []

  func read(_ url: URL) async throws -> SharedPage {
    reads.append(url)
    if let failure { throw failure }
    guard let page = pages[url] else { throw PageFailure.unreadable }
    return page
  }
}

/// Everything a share changes outside itself, for the test to look at.
@MainActor final class ShareWorld {
  let model: FakeModel
  let calendar: FakeCalendar
  let reminders: FakeReminders
  let pages = FakePages()
  let ledgerStore: SharedStore
  var library = CommandLibrary.initial()
  var hasModel = true
  /// Each `(value, key, command id)` remembered.
  private(set) var remembered: [[String]] = []
  private(set) var copied: [String] = []
  /// 2031-03-01 09:00 here.
  let now = Local.at(3, 1, 9)

  init(
    model: FakeModel, calendar: FakeCalendar = FakeCalendar(.writeOnly),
    reminders: FakeReminders = FakeReminders(.full)
  ) {
    self.model = model
    self.calendar = calendar
    self.reminders = reminders
    ledgerStore = SharedStore(
      directory: URL.temporaryDirectory.appending(path: "share-tests-\(UUID().uuidString)"),
      notificationName: nil)
  }

  var ledger: Ledger { ledgerStore.load(Ledger.self).document }

  /// The world's services; they keep it alive as long as a run uses them.
  var services: ShareServices {
    ShareServices(
      library: { [self] in library },
      settings: { [self] in
        guard hasModel else { return .initial() }
        let connection = ProviderConnection(
          id: "test", presetID: "custom", name: "Test", api: .openAICompatible,
          baseURL: URL(string: "https://models.invalid/v1")!, model: "test-model")
        return AppSettings(connections: [connection], defaultConnectionID: connection.id)
      },
      remember: { [self] value, key, id in
        remembered.append([value, key, id])
        library.setValue(value, for: key, in: id)
      },
      generator: model, calendar: CalendarWriter(store: calendar, calendar: Local.calendar),
      today: TodayReader(calendarStore: calendar, reminderStore: reminders),
      reminders: ReminderWriter(store: reminders),
      ledger: LedgerBook(store: ledgerStore, reloadWidgets: {}), pages: pages,
      copy: { [self] in copied.append($0) }, now: { [self] in now })
  }

  func command(_ id: String) -> Command {
    library.command(id)!
  }
}
