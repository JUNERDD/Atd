import AtdAI
import AtdActions
import AtdModel
import Foundation
import Testing

@testable import AtdShareUI

/// The cards a share can end in: 提取日程's event into Calendar, 记一笔's expense into the ledger
/// and 整理白板's to-dos into Reminders, with 撤销 where it can work and copying where it cannot.
@MainActor @Suite struct ShareCardTests {
  private static let event = """
    {"title": "城市读书会", "start": "2031-03-08T14:00", "end": null, "location": "静安图书馆", \
    "notes": null}
    """
  private static let expense = """
    {"amount": 46, "currency": "CNY", "merchant": "南巷小馆", "category": "dining", "note": null, \
    "date": "2031-03-01T08:30"}
    """
  private static let notes = """
    {"title": "周五市集筹备", "sections": [{"heading": "摊位", "bullets": ["三号摊位"]}], \
    "todos": [{"text": "订桌布", "owner": "小周"}, {"text": "买胶带", "owner": null}]}
    """

  private func card(
    _ id: String, answer: String, calendar: FakeCalendar = FakeCalendar(.writeOnly),
    reminders: FakeReminders = FakeReminders(.full)
  ) async -> (ShareRun, ShareWorld) {
    let world = ShareWorld(
      model: FakeModel(answering: answer), calendar: calendar, reminders: reminders)
    let run = ShareRun(
      command: world.command(id), content: .text("3月8日周六下午两点，静安图书馆读书会"),
      services: world.services)
    run.start()
    await run.settle()
    return (run, world)
  }

  /// Write-only access is all adding asks for, and it cannot take the event back (A14): done
  /// shows no 撤销. The content gave no end, which the card says.
  @Test func addingAsksForWriteOnlyAccessAndCannotBeUndone() async throws {
    let (run, world) = await card(
      BuiltinCommands.eventID, answer: Self.event, calendar: FakeCalendar(.notDetermined))
    let event = try #require(run.event)
    #expect(event.title == "城市读书会" && event.start == Local.at(3, 8, 14) && event.end == nil)
    #expect(!run.denied)

    await run.addEvent()
    #expect(world.calendar.requests == [false])
    #expect(run.phase == .done)
    #expect(run.addition?.canRemove == false)
    #expect(world.calendar.added.count == 1)
  }

  /// With the full access the app may already have, the event can be taken back, and a clash
  /// with what is in the calendar shows.
  @Test func withFullAccessTheEventCanBeUndone() async throws {
    let lunch = AgendaEvent(
      title: "午饭", start: Local.at(3, 8, 13), end: Local.at(3, 8, 14, 30), isAllDay: false)
    let (run, world) = await card(
      BuiltinCommands.eventID, answer: Self.event,
      calendar: FakeCalendar(.full, events: [lunch]))
    #expect(run.clash == "午饭")

    await run.addEvent()
    #expect(run.addition?.canRemove == true)
    await run.undoEvent()
    #expect(run.phase == .card)
    #expect(world.calendar.added.isEmpty)
  }

  @Test func withoutAccessTheEventCanOnlyBeCopied() async throws {
    let (run, world) = await card(
      BuiltinCommands.eventID, answer: Self.event, calendar: FakeCalendar(.denied))
    #expect(run.denied)
    run.copyEvent()
    #expect(world.copied.first?.hasPrefix("城市读书会\n") == true)
  }

  @Test func decliningThePromptLeavesCopying() async {
    let (run, world) = await card(
      BuiltinCommands.eventID, answer: Self.event,
      calendar: FakeCalendar(.notDetermined, grants: false))
    await run.addEvent()
    #expect(run.phase == .card)
    #expect(run.denied && run.issue == .denied(.calendar))
    #expect(world.calendar.added.isEmpty)
  }

  @Test func aCalendarThatFailsSaysSo() async {
    let calendar = FakeCalendar(.writeOnly)
    calendar.fail(with: .noDefaultCalendar(.calendar))
    let (run, _) = await card(BuiltinCommands.eventID, answer: Self.event, calendar: calendar)
    await run.addEvent()
    #expect(run.issue == .noDefault(.calendar))
    #expect(!run.denied)
  }

  /// 提醒 chosen on the card goes into the event and is remembered as the command's default.
  @Test func theAlertChosenIsRemembered() async throws {
    let (run, world) = await card(BuiltinCommands.eventID, answer: Self.event)
    let option = try #require(run.command.option(EventAlert.optionKey))
    run.setAlert(option.choices[2])
    #expect(run.event?.alert == .dayBefore)
    #expect(run.alertChoice == option.choices[2])
    #expect(world.remembered == [[option.choices[2], option.key, BuiltinCommands.eventID]])
  }

  /// Moving the start keeps the length of an event that has an end.
  @Test func movingTheStartMovesTheEnd() async throws {
    let (run, _) = await card(BuiltinCommands.eventID, answer: Self.event)
    run.setEnd(Local.at(3, 8, 16))
    run.setStart(Local.at(3, 8, 15))
    #expect(run.event?.end == Local.at(3, 8, 17))
    run.setEnd(Local.at(3, 8, 9))
    #expect(run.event?.end == Local.at(3, 8, 15))
  }

  @Test func anExpenseIsLoggedFromTheShareAndCanBeUndone() async throws {
    let (run, world) = await card(BuiltinCommands.expenseID, answer: Self.expense)
    #expect(run.expense?.amount == 46)
    #expect(!run.isEditable)

    run.logExpense()
    #expect(run.phase == .done)
    let logged = try #require(world.ledger.expenses.first)
    #expect(logged.source == .share && logged.merchant == "南巷小馆")

    run.undoExpense()
    #expect(run.phase == .card)
    #expect(world.ledger.expenses.isEmpty)
  }

  @Test func todosGoToRemindersAndComeBack() async throws {
    let (run, world) = await card(BuiltinCommands.whiteboardID, answer: Self.notes)
    #expect(run.notes?.todos.count == 2)

    await run.addReminders()
    #expect(run.reminderIDs?.count == 2)
    #expect(world.reminders.added.values.map(\.title).sorted() == ["买胶带", "订桌布"])

    await run.undoReminders()
    #expect(run.reminderIDs == nil)
    #expect(world.reminders.added.isEmpty)
  }

  /// 整理成 asks for the notes again organized the chosen way, and the command remembers it.
  @Test func organizingTheNotesAnotherWayAsksAgain() async throws {
    let (run, world) = await card(BuiltinCommands.whiteboardID, answer: Self.notes)
    let axis = try #require(run.axis)
    let todos = axis.choices[try #require(NotesFormat.allCases.firstIndex(of: .todos))]
    run.select(todos)
    await run.settle()
    #expect(world.model.requests.count == 2)
    #expect(run.phase == .card)
    #expect(run.notes?.sections.isEmpty == true && run.notes?.todos.count == 2)
    #expect(world.remembered == [[todos, axis.key, BuiltinCommands.whiteboardID]])
  }

  @Test func withoutRemindersTheNotesAreCopied() async {
    let (run, world) = await card(
      BuiltinCommands.whiteboardID, answer: Self.notes, reminders: FakeReminders(.denied))
    #expect(run.denied)
    run.copyNotes()
    #expect(world.copied.first?.contains("订桌布") == true)
  }

  @Test func nothingFoundIsNotRetried() async {
    let (run, _) = await card(BuiltinCommands.eventID, answer: #"{"found": false}"#)
    #expect(run.phase == .failed(.nothingFound(.event)))
    #expect(!ShareFailure.nothingFound(.event).canRetry)
  }
}
