import AtdAI
import AtdActions
import AtdModel
import Foundation

/// The card side of a run: 提取日程's event, 记一笔's expense and 整理白板's notes, each with its one
/// action (添加到日历, 记入「记账本」, 加到提醒事项), its 撤销 and its copy.
extension ShareRun {
  /// Asks for the card, then checks what its action can do.
  func findCard() async {
    phase = .working(.finding(command.output.cardKind))
    do {
      let card = try await CardRunner(generator: services.generator).run(
        command, input: content.cardInput, context: CardContext(now: services.now()),
        values: axis.map { [$0.key: choice] } ?? [:])
      try Task.checkCancellation()
      self.card = card
      issue = nil
      switch card {
      case .event: denied = services.calendar.access == .denied
      case .notes(let notes): denied = !notes.todos.isEmpty && services.reminders.access == .denied
      default: denied = false
      }
      phase = .card
      await checkClash()
    } catch {
      if !Task.isCancelled { phase = .failed(ShareFailure(error)) }
    }
  }

  /// Whether the card's fields can be changed before its action: a command that previews its
  /// result (`review`) shows them editable, one that does not shows them as read (A16).
  var isEditable: Bool {
    command.output.review
  }

  // MARK: 提取日程

  var event: EventDraft? {
    get { if case .event(let draft) = card { draft } else { nil } }
    set { if let newValue { card = .event(newValue) } }
  }

  /// The 提醒 choice on show, as the command's option spells it.
  var alertChoice: String? {
    guard let option = command.option(EventAlert.optionKey), let alert = event?.alert,
      let index = EventAlert.allCases.firstIndex(of: alert), option.choices.indices.contains(index)
    else { return nil }
    return option.choices[index]
  }

  /// Takes a 提醒 choice made on the card, which the command remembers as its default.
  func setAlert(_ value: String) {
    guard let option = command.option(EventAlert.optionKey),
      let alert = command.choice(EventAlert.self, values: [option.key: value])
    else { return }
    event?.alert = alert
    services.remember(value, option.key, command.id)
  }

  /// Moves the start and the end with it, so the event keeps its length.
  func setStart(_ start: Date) {
    guard var event else { return }
    if let end = event.end {
      event.end = start.addingTimeInterval(end.timeIntervalSince(event.start))
    }
    event.start = start
    self.event = event
  }

  /// Sets the end, never before the start.
  func setEnd(_ end: Date) {
    guard let start = event?.start else { return }
    event?.end = max(end, start)
  }

  /// The event already in the calendar when the found one would start; Atd can see it only with
  /// the full access the app may have been given, and never asks for it here.
  func checkClash() async {
    guard let event, !event.isAllDay else {
      clash = nil
      return
    }
    let found = await services.today.events(
      in: DateInterval(start: event.start, end: event.effectiveEnd))
    guard self.event == event else { return }
    clash =
      found?.first { !$0.isAllDay && $0.start < event.effectiveEnd && event.start < $0.end }?
      .title.oneLine
  }

  /// Adds the event to the default calendar, asking for write-only access the first time.
  func addEvent() async {
    guard let event, !isBusy else { return }
    isBusy = true
    defer { isBusy = false }
    do {
      addition = try await services.calendar.add(event)
      issue = nil
      phase = .done
    } catch {
      issue = CardIssue(error, kind: .event)
      if issue == .denied(.calendar) { denied = true }
    }
  }

  /// Takes the event back, which only works with full calendar access (A14).
  func undoEvent() async {
    guard let addition, addition.canRemove, !isBusy else { return }
    isBusy = true
    defer { isBusy = false }
    if await services.calendar.remove(addition) {
      self.addition = nil
      phase = .card
    } else {
      self.addition?.canRemove = false
    }
  }

  /// Copies the event as text (拷贝日程), for when Calendar is off limits.
  func copyEvent() {
    guard let event else { return }
    services.copy(event.plainText())
    copied = true
  }

  // MARK: 记一笔

  var expense: ExpenseDraft? {
    get { if case .expense(let draft) = card { draft } else { nil } }
    set { if let newValue { card = .expense(newValue) } }
  }

  /// Takes a 记到 choice made on an editable card, which the command remembers.
  func setBook(_ value: String) {
    let key = BuiltinCommands.OptionKey.book
    guard let option = command.option(key), option.choices.contains(value) else { return }
    expense?.book = value
    services.remember(value, key, command.id)
  }

  /// Logs the expense in the ledger (记入「记账本」).
  func logExpense() {
    guard let expense, let ledger = services.ledger else { return }
    do {
      logged = try ledger.add(expense, source: .share, at: services.now())
      issue = nil
      phase = .done
    } catch {
      issue = CardIssue(error, kind: .expense)
    }
  }

  func undoExpense() {
    guard let logged, let ledger = services.ledger, (try? ledger.remove(id: logged.id)) == true
    else { return }
    self.logged = nil
    phase = .card
  }

  // MARK: 整理白板

  var notes: NotesCard? {
    if case .notes(let notes) = card { notes } else { nil }
  }

  /// Adds the to-dos to the default reminders list, asking for access the first time.
  func addReminders() async {
    guard let notes, !isBusy else { return }
    isBusy = true
    defer { isBusy = false }
    do {
      reminderIDs = try await services.reminders.add(notes.todos)
      issue = nil
    } catch {
      issue = CardIssue(error, kind: .notes)
      if issue == .denied(.reminders) { denied = true }
    }
  }

  func undoReminders() async {
    guard let reminderIDs, !isBusy else { return }
    isBusy = true
    defer { isBusy = false }
    if await services.reminders.remove(ids: reminderIDs) { self.reminderIDs = nil }
  }

  /// Copies the notes and to-dos as text.
  func copyNotes() {
    guard let notes else { return }
    services.copy(ShareText.copyText(notes))
    copied = true
  }
}
