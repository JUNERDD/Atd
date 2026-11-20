import AtdActions
import AtdModel
import SwiftUI

/// 提取日程's card: the event found, editable when the command previews its result, its 提醒,
/// one footnote, and 添加到日历 (or 拷贝日程 where Calendar is off limits).
struct EventCardView: View {
  let run: ShareRun

  var body: some View {
    if let event = run.event {
      Form {
        Section {
          fields(event)
        } footer: {
          if let note = footnote(event) { Text(note) }
        }
        if !run.denied, let option = run.command.option(EventAlert.optionKey),
          let choice = run.alertChoice
        {
          Section {
            OptionPicker(option: option, selection: choice, select: { run.setAlert($0) })
          } header: {
            Text(option.label)
          }
        }
      }
      .onChange(of: event.start) { Task { await run.checkClash() } }
      .onChange(of: event.end) { Task { await run.checkClash() } }
      .safeAreaBar(edge: .bottom) { actions }
    }
  }

  @ViewBuilder private func fields(_ event: EventDraft) -> some View {
    let components: DatePickerComponents = event.isAllDay ? .date : [.date, .hourAndMinute]
    if run.isEditable {
      LabeledContent(String(localized: "event.title", bundle: .module)) {
        TextField(
          String(localized: "event.title", bundle: .module),
          text: Binding(get: { event.title }, set: { run.event?.title = $0 })
        )
        .multilineTextAlignment(.trailing)
      }
      DatePicker(
        String(localized: "event.start", bundle: .module),
        selection: Binding(get: { event.start }, set: { run.setStart($0) }),
        displayedComponents: components)
      DatePicker(
        String(localized: "event.end", bundle: .module),
        selection: Binding(get: { event.effectiveEnd }, set: { run.setEnd($0) }),
        in: event.start..., displayedComponents: components)
      LabeledContent(String(localized: "event.location", bundle: .module)) {
        TextField(
          String(localized: "event.location", bundle: .module),
          text: Binding(
            get: { event.location ?? "" },
            set: { run.event?.location = $0.trimmed.isEmpty ? nil : $0 })
        )
        .multilineTextAlignment(.trailing)
      }
    } else {
      LabeledContent(String(localized: "event.title", bundle: .module), value: event.title)
      LabeledContent(String(localized: "event.when", bundle: .module), value: when(event))
      if let location = event.location {
        LabeledContent(String(localized: "event.location", bundle: .module), value: location)
      }
    }
  }

  /// The one thing to know before adding, most important first.
  private func footnote(_ event: EventDraft) -> String? {
    if run.denied { return CardIssue.denied(.calendar).message }
    if let issue = run.issue { return issue.message }
    if let clash = run.clash {
      return String(localized: "event.clash \(clash)", bundle: .module)
    }
    if event.end == nil, !event.isAllDay {
      return String(localized: "event.noEnd", bundle: .module)
    }
    return nil
  }

  @ViewBuilder private var actions: some View {
    ActionBar {
      if run.denied {
        // Copying is all that is left, so it is the screen's action.
        CopyButton(copied: run.copied, kind: .event, action: run.copyEvent)
      } else {
        PrimaryButton(
          title: String(localized: "event.add", bundle: .module), symbol: "calendar.badge.plus",
          isBusy: run.isBusy
        ) {
          Task { await run.addEvent() }
        }
        if run.issue != nil {
          CopyButton(copied: run.copied, kind: .event, isProminent: false, action: run.copyEvent)
        }
      }
    }
  }

  private func when(_ event: EventDraft) -> String {
    let day = Date.FormatStyle.dateTime.month(.abbreviated).day().weekday(.abbreviated)
    if event.isAllDay {
      return Calendar.current.isDate(event.effectiveEnd, inSameDayAs: event.start)
        ? event.start.formatted(day)
        : (event.start..<max(event.start, event.effectiveEnd))
          .formatted(.interval.month(.abbreviated).day())
    }
    return (event.start..<max(event.start, event.effectiveEnd)).formatted(
      .interval.month(.abbreviated).day().weekday(.abbreviated).hour().minute())
  }
}
