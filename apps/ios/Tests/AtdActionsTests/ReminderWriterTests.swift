import AtdModel
import Foundation
import Testing

@testable import AtdActions

@Suite struct ReminderWriterTests {
  private let todos = [
    NotesCard.Todo(text: " 周三前出海报 ", owner: "小周"),
    NotesCard.Todo(text: "联系摊主", owner: " "),
    NotesCard.Todo(text: "  ", owner: "小王"),
  ]

  @Test func todosBecomeRemindersAndCanBeTakenBack() async throws {
    let store = FakeReminders(.full)
    let writer = ReminderWriter(store: store)
    let ids = try await writer.add(todos)
    #expect(ids.count == 2 && store.requests == 0)
    #expect(
      ids.map { store.added[$0] } == [
        NewReminder(title: "周三前出海报", notes: "小周"), NewReminder(title: "联系摊主"),
      ])
    #expect(await writer.remove(ids: ids))
    #expect(store.added.isEmpty)
    #expect(await !writer.remove(ids: ids))
  }

  @Test func theFirstAdditionAsksForAccess() async throws {
    let store = FakeReminders(.notDetermined)
    let ids = try await ReminderWriter(store: store).add([NotesCard.Todo(text: "买菜")])
    #expect(store.requests == 1 && ids.count == 1)
  }

  /// Nothing to add needs no permission, so the person is not asked.
  @Test func blankTodosAddNothingAndAskNothing() async throws {
    let store = FakeReminders(.notDetermined)
    #expect(try await ReminderWriter(store: store).add([NotesCard.Todo(text: " ")]).isEmpty)
    #expect(try await ReminderWriter(store: store).add([]).isEmpty)
    #expect(store.requests == 0)
  }

  @Test(arguments: [(DataAccess.denied, true), (.notDetermined, false), (.writeOnly, true)])
  func withoutAccessAddingIsDenied(_ access: DataAccess, grants: Bool) async {
    let store = FakeReminders(access, grants: grants)
    let todos = todos
    await #expect(throws: ActionError.denied(.reminders)) {
      try await ReminderWriter(store: store).add(todos)
    }
    #expect(store.added.isEmpty)
  }

  @Test func remindersErrorsComeThrough() async {
    let store = FakeReminders(.full)
    store.fail(with: .noDefaultCalendar(.reminders))
    let todos = todos
    await #expect(throws: ActionError.noDefaultCalendar(.reminders)) {
      try await ReminderWriter(store: store).add(todos)
    }
  }
}
