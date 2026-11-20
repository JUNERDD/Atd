import AtdAI
import AtdActions
import AtdModel
import Foundation
import Testing

@testable import AtdIntents

struct CommandRunTests {
  /// An event today, whatever the time the tests run.
  private let meeting: AgendaEvent = {
    let today = Calendar.current.startOfDay(for: .now)
    return AgendaEvent(
      title: "Design review", start: today.addingTimeInterval(10 * 3_600),
      end: today.addingTimeInterval(11 * 3_600), isAllDay: false)
  }()

  private func context(_ calendar: FakeCalendar, answer: String) -> (EntryContext, FakeGenerator) {
    let generator = FakeGenerator(answer)
    let reader = TodayReader(calendarStore: calendar, reminderStore: FakeReminders(.full))
    return (EntryContext(store: temporaryStore(), generator: generator, reader: reader), generator)
  }

  @Test func theBriefingReadsTheAgenda() async throws {
    let calendar = FakeCalendar(.full, events: [meeting])
    let (context, generator) = context(calendar, answer: #"{"sentences": ["Review at ten."]}"#)
    let briefing = try #require(BuiltinCommands.all().first { $0.id == BuiltinCommands.briefingID })
    let card = try await CommandRun(context).card(briefing, asking: false)
    #expect(card == .briefing(BriefingCard(sentences: ["Review at ten."])))
    #expect(calendar.readCount == 1)
    #expect(generator.requests.first?.messages.last?.text.contains("Design review") == true)
  }

  /// A person's command that reads nothing runs on its instructions alone.
  @Test func aPersonsCommandWithoutInputReadsNoAgenda() async throws {
    let calendar = FakeCalendar(.full, events: [meeting])
    let (context, generator) = context(calendar, answer: "Drink water.")
    let command = personCommand("Nudge", input: .none, action: .copy)
    let card = try await CommandRun(context).card(command, asking: false)
    #expect(card == .text(TextCard(text: "Drink water.")))
    #expect(calendar.readCount == 0)
    #expect(generator.requests.first?.messages.last?.text.contains("Design review") == false)
  }

  @Test func theBriefingAsksFirstWhereAccessWasNeverSettled() {
    let full = TodayReader(calendarStore: FakeCalendar(.full), reminderStore: FakeReminders(.full))
    let writeOnly = TodayReader(
      calendarStore: FakeCalendar(.writeOnly), reminderStore: FakeReminders(.full))
    let denied = TodayReader(
      calendarStore: FakeCalendar(.denied), reminderStore: FakeReminders(.notDetermined))
    #expect(!CommandRun.briefingNeedsAsking(full))
    #expect(CommandRun.briefingNeedsAsking(writeOnly))
    #expect(CommandRun.briefingNeedsAsking(denied))
  }

  @Test func inputNeedsSayWhatIsMissing() {
    #expect(CommandInputNeed(.text, text: " \n", hasImage: false) == .text)
    #expect(CommandInputNeed(.shared, text: "Hi", hasImage: false) == .ready)
    #expect(CommandInputNeed(.copied, text: nil, hasImage: false) == .clipboard)
    #expect(CommandInputNeed(.copied, text: "Hi", hasImage: false) == .ready)
    #expect(CommandInputNeed(.image, text: "Hi", hasImage: false) == .image)
    #expect(CommandInputNeed(.image, text: nil, hasImage: true) == .ready)
    #expect(CommandInputNeed(.none, text: nil, hasImage: false) == .ready)
  }

  @Test func failuresReadAsThePersonSeesThem() {
    #expect(IntentFailure(ModelFailure.noModel) == .model(ModelFailure.noModel.message))
    #expect(IntentFailure(ActionError.denied(.reminders)) == .denied(.reminders))
    #expect(
      IntentFailure(CardFailure.nothingFound(.event))
        == .model(CardFailure.nothingFound(.event).message))
    #expect(IntentFailure(CancellationError()) == nil)
  }
}
