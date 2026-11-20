import AtdAI
import AtdActions
import AtdModel
import Foundation
import Synchronization

/// Answers every request with the same text and keeps the requests it was sent.
final class FakeGenerator: TextGenerating {
  private let answer: String
  private let sent = Mutex<[(ModelRequest, ModelChoice)]>([])

  init(_ answer: String) {
    self.answer = answer
  }

  var requests: [ModelRequest] { sent.withLock { $0.map(\.0) } }
  var choices: [ModelChoice] { sent.withLock { $0.map(\.1) } }

  func stream(_ request: ModelRequest, choice: ModelChoice) -> AsyncThrowingStream<
    String, any Error
  > {
    sent.withLock { $0.append((request, choice)) }
    let (stream, continuation) = AsyncThrowingStream<String, any Error>.makeStream()
    continuation.yield(answer)
    continuation.finish()
    return stream
  }
}

/// A calendar with fixed access and events, which counts how often it is read.
final class FakeCalendar: CalendarStore {
  private let access: DataAccess
  private let stored: [AgendaEvent]
  private let reads = Mutex(0)

  init(_ access: DataAccess, events: [AgendaEvent] = []) {
    self.access = access
    stored = events
  }

  var readCount: Int { reads.withLock { $0 } }
  var eventAccess: DataAccess { access }

  func requestEventAccess(full: Bool) async throws -> Bool { access == .full }
  func addEvent(_ event: NewEvent) async throws -> String { "event" }
  func removeEvent(_ identifier: String) async -> Bool { false }

  func events(in interval: DateInterval) async -> [AgendaEvent] {
    reads.withLock { $0 += 1 }
    return stored.filter { $0.start < interval.end && interval.start < $0.end }
  }
}

/// Reminders with fixed access and nothing due.
final class FakeReminders: ReminderStore {
  private let access: DataAccess

  init(_ access: DataAccess) {
    self.access = access
  }

  var reminderAccess: DataAccess { access }
  func requestReminderAccess() async throws -> Bool { access == .full }
  func addReminders(_ reminders: [NewReminder]) async throws -> [String] { [] }
  func removeReminders(_ identifiers: [String]) async -> Bool { false }
  func incompleteReminders(dueBefore end: Date) async -> [AgendaReminder] { [] }
}

/// A store in a fresh temporary directory.
func temporaryStore() -> SharedStore {
  let directory = URL.temporaryDirectory.appending(
    path: "AtdIntentsTests-\(UUID().uuidString)", directoryHint: .isDirectory)
  return SharedStore(directory: directory, notificationName: nil)
}

/// A person's own command with the given input and placement.
func personCommand(
  _ name: String, input: CommandInput = .text, action: CommandOutput.Action = .replace,
  placement: CommandPlacement = CommandPlacement()
) -> Command {
  Command(
    id: name, name: name, symbol: "sparkles", tint: .blue, instructions: "Do \(name).",
    input: input, output: CommandOutput(action: action, review: false), placement: placement)
}

/// 2026-11-21 (a Saturday) at `hour`:`minute` in Shanghai.
func day(_ hour: Int, _ minute: Int = 0, plusDays days: Int = 0) -> Date {
  var components = DateComponents(year: 2026, month: 11, day: 21 + days, hour: hour, minute: minute)
  components.timeZone = shanghai.timeZone
  return shanghai.date(from: components) ?? .distantPast
}

let shanghai: Calendar = {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .gmt
  return calendar
}()
