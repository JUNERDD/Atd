import AtdModel
import EventKit
import Foundation

/// Calendar and Reminders through EventKit, for the app and its extensions.
///
/// One store serves a process, since an event store is costly to create; the actor keeps its
/// non-Sendable EventKit objects to itself. EventKit's own "not authorized" error comes out as
/// `ActionError.denied`, like every other missing access.
public actor EventKitStore: CalendarStore, ReminderStore {
  public static let shared = EventKitStore()

  private let store = EKEventStore()

  private init() {}

  public nonisolated var eventAccess: DataAccess {
    DataAccess(EKEventStore.authorizationStatus(for: .event))
  }

  public nonisolated var reminderAccess: DataAccess {
    DataAccess(EKEventStore.authorizationStatus(for: .reminder))
  }

  // MARK: Calendar

  public func requestEventAccess(full: Bool) async throws -> Bool {
    try await withCheckedThrowingContinuation { continuation in
      let answer: @Sendable (Bool, (any Error)?) -> Void = { granted, error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: granted)
        }
      }
      if full {
        store.requestFullAccessToEvents(completion: answer)
      } else {
        store.requestWriteOnlyAccessToEvents(completion: answer)
      }
    }
  }

  public func addEvent(_ event: NewEvent) throws -> String {
    guard let calendar = store.defaultCalendarForNewEvents else {
      throw ActionError.noDefaultCalendar(.calendar)
    }
    let item = EKEvent(eventStore: store)
    item.calendar = calendar
    item.title = event.title
    item.startDate = event.start
    item.endDate = event.end
    item.isAllDay = event.isAllDay
    item.location = event.location
    item.notes = event.notes
    if let offset = event.alarmOffset { item.addAlarm(EKAlarm(relativeOffset: offset)) }
    do {
      try store.save(item, span: .thisEvent, commit: true)
    } catch {
      throw Self.translated(error, .calendar)
    }
    return item.calendarItemIdentifier
  }

  public func removeEvent(_ identifier: String) -> Bool {
    // Without full access the lookup finds nothing, not even the events Atd added.
    guard let event = store.calendarItem(withIdentifier: identifier) as? EKEvent else {
      return false
    }
    return (try? store.remove(event, span: .thisEvent, commit: true)) != nil
  }

  public func events(in interval: DateInterval) -> [AgendaEvent] {
    let predicate = store.predicateForEvents(
      withStart: interval.start, end: interval.end, calendars: nil)
    return store.events(matching: predicate).compactMap { event in
      guard let start = event.startDate, let end = event.endDate else { return nil }
      return AgendaEvent(
        title: event.title ?? "", start: start, end: end, isAllDay: event.isAllDay,
        location: event.location?.isEmpty == false ? event.location : nil)
    }
  }

  // MARK: Reminders

  public func requestReminderAccess() async throws -> Bool {
    try await withCheckedThrowingContinuation { continuation in
      store.requestFullAccessToReminders { @Sendable granted, error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: granted)
        }
      }
    }
  }

  public func addReminders(_ reminders: [NewReminder]) throws -> [String] {
    guard let list = store.defaultCalendarForNewReminders() else {
      throw ActionError.noDefaultCalendar(.reminders)
    }
    var items: [EKReminder] = []
    do {
      for reminder in reminders {
        let item = EKReminder(eventStore: store)
        item.calendar = list
        item.title = reminder.title
        item.notes = reminder.notes
        try store.save(item, commit: false)
        items.append(item)
      }
      try store.commit()
    } catch {
      // Nothing half-added: drop the saved but uncommitted ones.
      store.reset()
      throw Self.translated(error, .reminders)
    }
    return items.map(\.calendarItemIdentifier)
  }

  public func removeReminders(_ identifiers: [String]) -> Bool {
    var removedAll = true
    for identifier in identifiers {
      let reminder = store.calendarItem(withIdentifier: identifier) as? EKReminder
      let removed = reminder.map { (try? store.remove($0, commit: true)) != nil } ?? false
      removedAll = removedAll && removed
    }
    return removedAll
  }

  public func incompleteReminders(dueBefore end: Date) async -> [AgendaReminder] {
    let predicate = store.predicateForIncompleteReminders(
      withDueDateStarting: nil, ending: end, calendars: nil)
    return await withCheckedContinuation { continuation in
      // Read into plain values right here: the fetched reminders stay on EventKit's queue.
      store.fetchReminders(matching: predicate) { @Sendable reminders in
        continuation.resume(returning: (reminders ?? []).compactMap(AgendaReminder.init))
      }
    }
  }
}

extension EventKitStore {
  /// `ActionError.denied` for EventKit's "not authorized" (access taken away after Atd checked
  /// it), and EventKit's other errors as they are.
  static func translated(_ error: any Error, _ data: ProtectedData) -> any Error {
    (error as? EKError)?.code == .eventStoreNotAuthorized ? ActionError.denied(data) : error
  }
}

extension DataAccess {
  init(_ status: EKAuthorizationStatus) {
    switch status {
    case .notDetermined: self = .notDetermined
    case .writeOnly: self = .writeOnly
    case .fullAccess: self = .full
    case .denied, .restricted: self = .denied
    @unknown default: self = .denied
    }
  }
}

extension AgendaReminder {
  /// A reminder with a due date; nil for one without.
  init?(_ reminder: EKReminder) {
    guard let components = reminder.dueDateComponents,
      let due = (components.calendar ?? Calendar.current).date(from: components)
    else { return nil }
    self.init(title: reminder.title ?? "", due: due, hasDueTime: components.hour != nil)
  }
}
