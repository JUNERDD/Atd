import AtdModel
import SwiftUI

/// The card a trial run gave, as the trial shows it: what the card holds, line by line (新日程,
/// 时间, 地点, 提醒 for an event; 记一笔, 类别, 记到 for an expense; the sentences of a briefing;
/// the sections and to-dos of notes). Its actions, such as 添加到日历 or 记入记账本, belong to
/// the entry points; a trial writes nothing.
struct TrialCardContent: View {
  let card: CardResult
  let command: Command

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      switch card {
      case .event(let event): eventLines(event)
      case .expense(let expense): expenseLines(expense)
      case .briefing(let briefing):
        ForEach(Array(briefing.sentences.enumerated()), id: \.offset) { _, sentence in
          Text(sentence)
        }
      case .notes(let notes): notesLines(notes)
      case .text(let text): Text(text.text)
      }
    }
    .lineSpacing(3)
    .textSelection(.enabled)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder private func eventLines(_ event: EventDraft) -> some View {
    field(AppText.string("trial.card.event"), event.title)
    field(AppText.string("trial.card.time"), when(event))
    if let location = event.location {
      field(AppText.string("trial.card.place"), location)
    }
    // 提醒 as the command's own option names it; a command without that option sets none.
    if let option = option(EventAlert.optionKey),
      let index = EventAlert.allCases.firstIndex(of: event.alert),
      option.choices.indices.contains(index)
    {
      field(option.label, option.choices[index])
    }
  }

  @ViewBuilder private func expenseLines(_ expense: ExpenseDraft) -> some View {
    let amount = expense.amount.formatted(.currency(code: expense.currency))
    let what = expense.merchant ?? expense.note
    field(AppText.string("trial.card.expense"), what.map { "\($0) \(amount)" } ?? amount)
    field(AppText.string("trial.card.category"), expense.category.name)
    field(
      option(BuiltinCommands.OptionKey.book)?.label ?? AppText.string("trial.card.book"),
      expense.book)
  }

  @ViewBuilder private func notesLines(_ notes: NotesCard) -> some View {
    if let title = notes.title {
      Text(title).fontWeight(.semibold)
    }
    ForEach(Array(notes.sections.enumerated()), id: \.offset) { _, section in
      Text(section.heading).fontWeight(.semibold)
      ForEach(Array(section.bullets.enumerated()), id: \.offset) { _, bullet in
        Text(verbatim: "· \(bullet)")
      }
    }
    if !notes.todos.isEmpty {
      Text(AppText.string("trial.card.todos")).fontWeight(.semibold)
      ForEach(Array(notes.todos.enumerated()), id: \.offset) { _, todo in
        // 小王：交设计稿, as the prototype writes a to-do with its owner.
        let line = todo.owner.map { AppText.string("trial.card.field \($0) \(todo.text)") }
        Text(verbatim: "· \(line ?? todo.text)")
      }
    }
  }

  /// 时间：周四 11月26日 15:00–16:00, in the person's language and time zone.
  private func when(_ event: EventDraft) -> String {
    let end = event.effectiveEnd
    guard event.isAllDay else {
      return (event.start..<end).formatted(.interval.month().day().weekday().hour().minute())
    }
    return Calendar.current.isDate(event.start, inSameDayAs: end)
      ? event.start.formatted(.dateTime.month().day().weekday())
      : (event.start..<end).formatted(.interval.month().day().weekday())
  }

  private func option(_ key: String) -> CommandOption? {
    command.options.first { $0.key == key }
  }

  private func field(_ label: String, _ value: String) -> Text {
    Text(AppText.string("trial.card.field \(label) \(value)"))
  }
}
