import AtdAI
import AtdActions
import AtdInk
import AtdModel
import SwiftUI

/// 提取日程's card: the event's title, when and where (with the numbers of the boxes on the
/// photo) and its 提醒, which also becomes the command's remembered choice. 添加到日历 adds it
/// with add-only access, asked for the first time; 撤销 shows only when Atd has full access and
/// can remove it again. Without access the card offers 拷贝日程 and 去设置.
struct CameraEventCard: View {
  let command: Command
  @State private var draft: EventDraft
  let marks: [CameraMark]
  @Environment(AppStore.self) private var store
  @State private var outcome: CameraActionOutcome<CalendarAddition>?
  @State private var adding = false

  init(command: Command, draft: EventDraft, marks: [CameraMark]) {
    self.command = command
    _draft = State(initialValue: draft)
    self.marks = marks
  }

  private var alertOption: CommandOption? { command.option(EventAlert.optionKey) }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      CameraCardHead(command: command, title: draft.title)
      InkList(inset: 0) {
        row(CameraCopy.string("camera.mark.time"), value: when, fields: [.date, .time])
        if let location = draft.location {
          row(CameraCopy.string("camera.mark.place"), value: location, fields: [.place])
        }
      }
      if let alertOption, outcome == nil {
        InkSegmented(label: alertOption.label, choices: alertOption.choices, selection: alert)
      }
      action
    }
  }

  @ViewBuilder private var action: some View {
    switch outcome {
    case nil:
      Button(CameraCopy.string("camera.event.add"), action: add)
        .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
        .disabled(adding)
    case .done(let addition):
      CameraDoneNote(
        text: CameraCopy.string("camera.event.added"),
        undo: addition.canRemove ? { remove(addition) } : nil)
    case .denied:
      CameraDeniedNote(
        text: CameraCopy.string("camera.event.denied"),
        copyTitle: CameraCopy.string("camera.event.copy")
      ) {
        CameraActions.copy(draft.plainText())
      }
    case .failed(let message):
      Text(message).font(.footnote).foregroundStyle(InkColor.alert)
      Button(CameraCopy.string("camera.event.add"), action: add)
        .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
    }
  }

  /// The 提醒 choice, by its place among the option's choices, so it reads the same in any
  /// language; choosing one changes this event and the command's remembered value.
  private var alert: Binding<String> {
    Binding(
      get: {
        let choices = alertOption?.choices ?? []
        let index = EventAlert.allCases.firstIndex(of: draft.alert) ?? 0
        return choices.indices.contains(index) ? choices[index] : ""
      },
      set: { choice in
        guard let option = alertOption, let index = option.choices.firstIndex(of: choice),
          EventAlert.allCases.indices.contains(index)
        else { return }
        draft.alert = EventAlert.allCases[index]
        var updated = store.library.command(command.id) ?? command
        updated.setValue(choice, for: option.key)
        store.save(updated)
      })
  }

  /// 11月21日 周六 14:00–16:00, or the day(s) of an all-day event.
  private var when: String {
    if draft.isAllDay {
      let start = draft.start.formatted(date: .abbreviated, time: .omitted)
      guard let end = draft.end, !Calendar.current.isDate(end, inSameDayAs: draft.start) else {
        return start
      }
      return start + " – " + end.formatted(date: .abbreviated, time: .omitted)
    }
    let start = draft.start.formatted(
      .dateTime.month(.abbreviated).day().weekday(.abbreviated).hour().minute())
    guard let end = draft.end else { return start }
    let sameDay = Calendar.current.isDate(end, inSameDayAs: draft.start)
    let endText =
      sameDay
      ? end.formatted(date: .omitted, time: .shortened)
      : end.formatted(date: .abbreviated, time: .shortened)
    return start + " – " + endText
  }

  private func row(_ label: String, value: String, fields: [CameraMarkField]) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      let numbers = Array(Set(fields.compactMap { CameraMarkName.number(of: $0, in: marks) }))
      ForEach(numbers.sorted(), id: \.self) { CameraBadge(number: $0) }
      Text(label).foregroundStyle(.secondary)
      Spacer(minLength: 12)
      Text(value).multilineTextAlignment(.trailing)
    }
    .padding(.vertical, 12)
    .accessibilityElement(children: .combine)
  }

  private func add() {
    adding = true
    Task {
      outcome = await CameraActions(store: store.store).addEvent(draft)
      adding = false
    }
  }

  private func remove(_ addition: CalendarAddition) {
    Task {
      if await CameraActions(store: store.store).removeEvent(addition) { outcome = nil }
    }
  }
}
