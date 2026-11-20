import AtdModel
import Foundation
import Testing

@testable import AtdAI

@Suite struct CardPromptTests {
  static let zone = TimeZone(identifier: "Asia/Shanghai") ?? .gmt
  private let photo = ModelImage(data: Data([0xFF, 0xD8, 0xFF]), mediaType: "image/jpeg")

  /// Saturday 21 November 2026, 14:05 in Shanghai.
  private var context: CardContext {
    get throws { CardContext(now: try at(21, 14, 5), timeZone: Self.zone, currency: "CNY") }
  }

  private func at(_ day: Int, _ hour: Int = 0, _ minute: Int = 0) throws -> Date {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = Self.zone
    return try #require(
      calendar.date(
        from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute)))
  }

  private func command(_ id: String) throws -> Command {
    try #require(BuiltinCommands.all().first { $0.id == id })
  }

  @Test func anEventAsksForItsKeysWithTheTimeAndTheContent() throws {
    let event = try command(BuiltinCommands.eventID)
    let input = CardInput(text: "周六下午两点，静安图书馆读书会", images: [photo])
    let request = CardPrompt.request(event, input: input, context: try context)
    let rules = CardPrompt.cards("card.json") + "\n" + CardPrompt.cards("card.event") + "\n\n"
    #expect(request.system.hasPrefix(rules))
    #expect(request.system.contains(event.instructions))
    #expect(request.system.contains("2026-11-21 14:05") && request.system.contains("Asia/Shanghai"))
    // 提醒 is the parser's to apply; the model is not asked about it.
    let alert = try #require(event.option(EventAlert.optionKey))
    #expect(!request.system.contains(alert.value))
    #expect(request.messages == [ModelMessage(.user, input.text, images: [photo])])
  }

  @Test func aPhotoAloneStillSendsATurn() throws {
    let expense = try command(BuiltinCommands.expenseID)
    var context = try context
    context.currency = "JPY"
    let request = CardPrompt.request(expense, input: CardInput(images: [photo]), context: context)
    #expect(request.system.contains(CardPrompt.cards("card.expense \("JPY")")))
    #expect(!request.system.contains(try #require(expense.option("book")).value))
    #expect(
      request.messages == [ModelMessage(.user, CardPrompt.cards("card.inPhoto"), images: [photo])])
    let empty = CardPrompt.request(expense, input: CardInput(text: "  "), context: context)
    #expect(empty.messages == [ModelMessage(.user, expense.instructions)])
  }

  @Test func aBriefingSendsTheAgendaAsTheTurn() throws {
    let context = try context
    let agenda = Agenda(
      day: try at(21),
      events: [
        AgendaEvent(title: "夜班", start: try at(20, 22), end: try at(21, 6), isAllDay: false),
        AgendaEvent(title: "团建", start: try at(21), end: try at(22), isAllDay: true),
        AgendaEvent(
          title: "产品周会", start: try at(21, 15), end: try at(21, 16), isAllDay: false,
          location: "3 楼会议室"),
      ],
      reminders: [
        AgendaReminder(title: "报销单", due: try at(15), hasDueTime: false),
        AgendaReminder(title: "买菜", due: try at(21), hasDueTime: false),
        AgendaReminder(title: "取快递", due: try at(21, 19), hasDueTime: true),
      ])
    let briefing = try command(BuiltinCommands.briefingID)
    let request = CardPrompt.request(briefing, input: CardInput(agenda: agenda), context: context)
    let lines = try #require(request.messages.first?.text).components(separatedBy: "\n")
    let weekday = context.weekday(try at(21))
    #expect(
      lines == [
        CardPrompt.cards("card.agenda.day \("2026-11-21") \(weekday)"),
        CardPrompt.cards("card.agenda.events"),
        "- 11-20 22:00–06:00 · 夜班",
        "- \(CardPrompt.cards("card.agenda.allDay")) · 团建",
        "- 15:00–16:00 · 产品周会 · 3 楼会议室",
        CardPrompt.cards("card.agenda.reminders"),
        "- \(CardPrompt.cards("card.agenda.overdue")) 11-15 报销单",
        "- 买菜",
        "- 19:00 取快递",
      ])
    #expect(request.system.contains(CardPrompt.cards("card.briefing.brief")))
    #expect(request.system.contains("2026-11-21 14:05"))

    let detail = try #require(briefing.option(BriefingDetail.optionKey))
    let full = CardPrompt.request(
      briefing, input: CardInput(agenda: agenda), context: context,
      values: [detail.key: detail.choices[1]])
    #expect(full.system.contains(CardPrompt.cards("card.briefing.full")))
    #expect(!full.system.contains(CardPrompt.cards("card.briefing.brief")))
  }

  /// A list Atd cannot read must not look like an empty day.
  @Test func unreadableListsSaySo() throws {
    let context = try context
    let partial = Agenda(day: try at(21), events: nil, reminders: [])
    let text = CardPrompt.agendaText(partial, context: context).components(separatedBy: "\n")
    #expect(text.contains(CardPrompt.cards("card.agenda.noCalendar")))
    #expect(text.last == CardPrompt.cards("card.agenda.none"))
    let none = CardPrompt.agendaText(nil, context: context)
    #expect(none.contains(CardPrompt.cards("card.agenda.noCalendar")))
    #expect(none.contains(CardPrompt.cards("card.agenda.noReminders")))
  }

  @Test func notesFollowTheFormatAndNeedNoClock() throws {
    let whiteboard = try command(BuiltinCommands.whiteboardID)
    let format = try #require(whiteboard.option(NotesFormat.optionKey))
    let request = { (values: [String: String]) in
      CardPrompt.request(
        whiteboard, input: CardInput(images: [photo]), context: try context, values: values
      ).system
    }
    let both = try request([:])
    #expect(both.contains(CardPrompt.cards("card.notes")))
    #expect(!both.contains(CardPrompt.cards("card.notes.sectionsOnly")))
    #expect(!both.contains(CardPrompt.cards("card.notes.todosOnly")))
    #expect(!both.contains("2026-11-21"))
    let notes = try request([format.key: format.choices[0]])
    #expect(notes.contains(CardPrompt.cards("card.notes.sectionsOnly")))
    let todos = try request([format.key: format.choices[1]])
    #expect(todos.contains(CardPrompt.cards("card.notes.todosOnly")))
  }

  /// 润色 in the share sheet, or the person's own card command: plain text, as in the keyboard.
  @Test func otherCommandsAskForPlainText() throws {
    let polish = try command(BuiltinCommands.polishID)
    let input = CardInput(text: "原文", images: [photo])
    #expect(
      CardPrompt.request(polish, input: input, context: try context)
        == CommandPrompt.request(.command(polish), input: "原文", images: [photo]))
    let tone = CommandOption(key: "option1", label: "语气", choices: ["正式", "随意"], value: "随意")
    let own = Command(
      id: "own", name: "整理待办", symbol: "checklist", tint: .mint, instructions: "按负责人分组",
      options: [tone], input: .shared, output: CommandOutput(action: .card),
      placement: CommandPlacement(share: true))
    let request = CardPrompt.request(own, input: input, context: try context)
    #expect(request == CommandPrompt.request(.command(own), input: "原文", images: [photo]))
    #expect(request.system.contains("语气") && request.system.contains("随意"))
  }

  @Test func commandPromptsCarryImagesOnlyWhenGiven() {
    let plain = CommandPrompt.request(.request("翻译成英文"), input: "你好")
    #expect(plain.messages == [ModelMessage(.user, "你好")])
    let screenshot = CommandPrompt.request(.request("翻译成英文"), input: "", images: [photo])
    #expect(screenshot.messages == [ModelMessage(.user, "翻译成英文", images: [photo])])
  }
}
