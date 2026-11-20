import AtdModel
import Foundation

/// Calendar as the actions use it. `EventKitStore` is the real one; tests and previews use their
/// own, so the logic runs without the person's permission.
public protocol CalendarStore: Sendable {
  var eventAccess: DataAccess { get }
  /// Asks for full access, or for write-only access (`full: false`); returns whether it was
  /// granted. The system shows its prompt only the first time for each.
  func requestEventAccess(full: Bool) async throws -> Bool
  /// Adds the event to the default calendar and returns its identifier.
  func addEvent(_ event: NewEvent) async throws -> String
  /// Removes the event, which needs full access; returns whether it is gone.
  func removeEvent(_ identifier: String) async -> Bool
  /// The events that overlap `interval`, in no particular order.
  func events(in interval: DateInterval) async -> [AgendaEvent]
}

/// An event as Calendar stores it.
public struct NewEvent: Sendable, Equatable {
  public var title: String
  public var start: Date
  /// For an all-day event, the start of its last day.
  public var end: Date
  public var isAllDay: Bool
  public var location: String?
  public var notes: String?
  /// When Calendar alerts, in seconds from the start (negative: before it); nil for no alert.
  public var alarmOffset: TimeInterval?

  public init(
    title: String, start: Date, end: Date, isAllDay: Bool, location: String? = nil,
    notes: String? = nil, alarmOffset: TimeInterval? = nil
  ) {
    self.title = title
    self.start = start
    self.end = end
    self.isAllDay = isAllDay
    self.location = location
    self.notes = notes
    self.alarmOffset = alarmOffset
  }

  /// The event a draft makes. A timed event without an end lasts an hour. An all-day event runs
  /// from the start of its first day to its last day, and its alert follows Calendar's all-day
  /// ones: 提前 1 天 is 9:00 the day before and 提前 1 小时, which has no all-day equivalent, 9:00
  /// on the day.
  public init(_ draft: EventDraft, calendar: Calendar) {
    let hour: TimeInterval = 60 * 60
    let start = draft.isAllDay ? calendar.startOfDay(for: draft.start) : draft.start
    let end = draft.isAllDay ? calendar.startOfDay(for: draft.effectiveEnd) : draft.effectiveEnd
    let offset: TimeInterval? =
      switch (draft.alert, draft.isAllDay) {
      case (.off, _): nil
      case (.hourBefore, false): -hour
      case (.dayBefore, false): -24 * hour
      case (.hourBefore, true): 9 * hour
      case (.dayBefore, true): -15 * hour
      }
    self.init(
      title: draft.title, start: start, end: end, isAllDay: draft.isAllDay,
      location: draft.location, notes: draft.notes, alarmOffset: offset)
  }
}

/// An event `CalendarWriter` added.
public struct CalendarAddition: Sendable, Equatable, Hashable {
  /// The event's identifier in Calendar.
  public var identifier: String
  /// Whether `CalendarWriter.remove(_:)` can take it back (撤销): only with full access, since
  /// write-only access cannot read or delete events, Atd's own included. Without it the card
  /// shows only 已添加.
  public var canRemove: Bool

  public init(identifier: String, canRemove: Bool) {
    self.identifier = identifier
    self.canRemove = canRemove
  }
}

/// Adds a found event to the person's calendar (提取日程 → 添加到日历). Adding needs only
/// write-only access, which is what it asks for; it never asks for full access.
public struct CalendarWriter: Sendable {
  private let store: any CalendarStore
  private let calendar: Calendar

  public init(store: any CalendarStore = EventKitStore.shared, calendar: Calendar = .current) {
    self.store = store
    self.calendar = calendar
  }

  /// Whether adding can work without asking (`.writeOnly`, `.full`), needs asking first, or
  /// needs Settings.
  public var access: DataAccess { store.eventAccess }

  /// Adds the event, with its alert, to the default calendar, asking for write-only access the
  /// first time.
  /// - Throws: `ActionError.denied(.calendar)` when access is off or the person declines now,
  ///   `ActionError.noDefaultCalendar(.calendar)`, or Calendar's own error.
  public func add(_ draft: EventDraft) async throws -> CalendarAddition {
    switch store.eventAccess {
    case .writeOnly, .full:
      break
    case .notDetermined:
      guard try await store.requestEventAccess(full: false) else {
        throw ActionError.denied(.calendar)
      }
    case .denied:
      throw ActionError.denied(.calendar)
    }
    let identifier = try await store.addEvent(NewEvent(draft, calendar: calendar))
    return CalendarAddition(identifier: identifier, canRemove: store.eventAccess == .full)
  }

  /// Takes back an event `add` added (撤销); returns whether it is gone, which it cannot be
  /// without full access.
  public func remove(_ addition: CalendarAddition) async -> Bool {
    await store.removeEvent(addition.identifier)
  }
}
