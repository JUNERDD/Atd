import AtdAutomations
import AtdInk
import SwiftUI

/// The automation's latest run: where it is, each step with what it found, and what the person
/// can do now: 跳过 or 发送 while a message waits, 继续 once it stopped. With Atd in front the
/// system hides Atd's own Live Activity, so the same choices are here.
struct RunSection: View {
  let run: AutomationRun
  let send: () -> Void
  let skip: () -> Void
  let resume: () -> Void

  var body: some View {
    SectionHeader(AutomationText.string("run.title"))
    VStack(alignment: .leading, spacing: 10) {
      Text(run.status)
        .font(.subheadline.weight(.semibold))
      ForEach(Array(run.steps.enumerated()), id: \.offset) { _, step in
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          Image(systemName: Self.symbol(step.status))
            .foregroundStyle(Self.color(step.status))
            .accessibilityHidden(true)
          Text(step.text)
            .foregroundStyle(
              step.status == .waiting || step.status == .skipped ? .secondary : .primary
            )
            .lineLimit(3)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(step.text), \(Self.label(step.status))")
      }
      actions
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .inkCard(seed: 7)
    .padding(.horizontal, 16)
  }

  @ViewBuilder private var actions: some View {
    switch run.phase {
    case .awaiting:
      HStack(spacing: 10) {
        Button(AutomationText.string("run.skip"), action: skip)
          .buttonStyle(InkButtonStyle(form: .block))
        Button(AutomationText.string("run.send"), action: send)
          .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
      }
      .padding(.top, 4)
    case .interrupted:
      Button(AutomationText.string("run.continue"), action: resume)
        .buttonStyle(InkButtonStyle(kind: .filled, form: .block))
        .padding(.top, 4)
    case .running, .finished:
      EmptyView()
    }
  }

  static func symbol(_ status: StepRecord.Status) -> String {
    switch status {
    case .waiting: "circle"
    case .running: "circle.dotted"
    case .done: "checkmark.circle"
    case .skipped: "minus.circle"
    case .failed: "exclamationmark.circle"
    }
  }

  static func color(_ status: StepRecord.Status) -> Color {
    switch status {
    case .waiting, .skipped: .secondary
    case .running, .done: .primary
    case .failed: InkColor.alert
    }
  }

  static func label(_ status: StepRecord.Status) -> String {
    switch status {
    case .waiting: AutomationText.string("status.waiting")
    case .running: AutomationText.string("status.running")
    case .done: AutomationText.string("status.done")
    case .skipped: AutomationText.string("status.skipped")
    case .failed: AutomationText.string("status.failed")
    }
  }
}

/// A focus automation's sessions, newest first: the one timing with 结束, then how long each
/// ran, or that it was never ended.
struct FocusSessions: View {
  let sessions: [FocusSession]
  let end: (FocusSession) -> Void

  var body: some View {
    SectionHeader(AutomationText.string("focus.title"))
    if sessions.isEmpty {
      SectionFooter(AutomationText.string("focus.none"))
    } else {
      InkList {
        ForEach(sessions.prefix(5)) { session in
          HStack(spacing: 12) {
            Text(session.start.formatted(date: .abbreviated, time: .shortened))
              .frame(maxWidth: .infinity, alignment: .leading)
            if session.isOpen {
              Button(AutomationText.string("focus.end")) { end(session) }
                .buttonStyle(InkButtonStyle())
            } else if let duration = session.duration {
              Text(FocusTime.text(duration))
                .monospacedDigit()
                .foregroundStyle(.secondary)
            } else {
              Text(AutomationText.string("focus.lost"))
                .foregroundStyle(.secondary)
            }
          }
          .padding(.horizontal, 20)
          .frame(minHeight: 48)
        }
      }
    }
  }
}
