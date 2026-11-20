import AtdModel
import Foundation
import Testing

@testable import AtdIntents

struct CardTextTests {
  private let english = Locale(identifier: "en_US")

  @Test func expenseReadsAmountThenWhatIsKnown() {
    let draft = ExpenseDraft(
      amount: 32, currency: "CNY", merchant: "Starbucks", category: .dining, date: day(9),
      book: "Daily", note: " Latte ")
    #expect(
      CardText.lines(.expense(draft), locale: english) == [
        "CN¥32.00 · Starbucks · \(ExpenseCategory.dining.name) · Daily", "Latte",
      ])
  }

  @Test func notesReadTitleHeadingsPointsAndTodos() {
    let notes = NotesCard(
      title: "Launch", sections: [.init(heading: "Plan", bullets: ["Ship", " "])],
      todos: [.init(text: "Book room", owner: "Li"), .init(text: "Send notes")])
    #expect(
      CardText.lines(.notes(notes)) == [
        "Launch", "Plan", "• Ship", "☐ Book room · Li", "☐ Send notes",
      ])
  }

  @Test func briefingAndTextReadAsTheyAre() {
    #expect(
      CardText.lines(.briefing(BriefingCard(sentences: ["One.", "Two."]))) == ["One.", "Two."])
    #expect(CardText.text(.text(TextCard(text: "Hello"))) == "Hello")
  }

  @Test func eventReadsAsCopiedWithoutBlankLines() throws {
    let draft = EventDraft(
      title: "Design review", start: day(15), end: day(16), location: "Room 2", alert: .off)
    let lines = CardText.lines(.event(draft), timeZone: shanghai.timeZone)
    #expect(lines.first == "Design review")
    #expect(!lines.contains(""))
  }
}
