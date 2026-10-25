import AICore
import SwiftUI

/// A question answered in place: its title, its suggested answers and a one-line reply field
/// (Return sends). In a row it shows the title's first two lines and the first three suggested
/// answers, with links to the request's page for the rest; on the page it shows everything.
/// Skip is one of the decisions beside it (``TaskActivityDecisions``).
struct TaskActivityQuestionView: View {
  let item: TaskActivityItem
  let request: TaskActivityPendingRequest
  let question: TaskActivityQuestion
  let index: Int
  let model: TaskActivityModel
  /// On the request's page: every line and every suggested answer.
  var complete = false
  @State private var draft = ""
  @FocusState private var focused: Bool
  private var labels: TaskActivityLabels { model.labels }
  private var sending: TaskActivitySending? { model.sending[item.key] }
  private var typed: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let subagent = request.subagent {
        TaskActivitySubagent(name: subagent, labels: labels)
      }
      if !question.title.isEmpty {
        Text(verbatim: question.title).font(TaskActivityRequestStyle.body)
          .lineLimit(complete ? nil : 2).truncationMode(.tail)
          .fixedSize(horizontal: false, vertical: true)
          .textSelection(.enabled)
      }
      if !complete && question.title.count > TaskActivityQuestion.rowTitleLimit {
        link(labels.text(.activityShowAll))
      }
      let shown = complete ? question.options : Array(question.options.prefix(rowOptions))
      ForEach(Array(shown.enumerated()), id: \.offset) { option, title in
        TaskActivityChoice(
          title: title, label: labels.format(.activityAnswerWith, title),
          busy: isSending(.option(option)) ? labels.busy(.option(option)) : nil
        ) { model.perform(.option(option), on: request, at: index, of: item.key) }
        .disabled(sending != nil && !isSending(.option(option)))
      }
      if !complete && question.options.count > rowOptions {
        link(labels.count(.activityMoreOptions, question.options.count - rowOptions))
      }
      field
    }
    .accessibilityElement(children: .contain)
  }

  private var rowOptions: Int { TaskActivityQuestion.rowOptions }

  private func isSending(_ control: TaskActivityControl) -> Bool {
    sending?.requestID == request.id && sending?.control == control
  }

  /// Opens the question on the card's page, where the rest of it shows.
  private func link(_ title: String) -> some View {
    TaskActivityLink(title: title) { model.openPage(item.key, index) }
  }

  /// One line, so typing never changes the card's measured height.
  private var field: some View {
    HStack(spacing: 4) {
      TextField(text: $draft, prompt: Text(verbatim: labels.text(.activityReplyPlaceholder))) {
        Text(verbatim: labels.text(.activityReplyPlaceholder))
      }
      .textFieldStyle(.plain).font(TaskActivityRequestStyle.body).lineLimit(1)
      .focused($focused)
      .onSubmit { model.reply(typed, to: request, of: item.key) }
      .disabled(sending != nil)
      .accessibilityIdentifier("activity.reply.\(item.key.taskID)/\(item.key.runID)/\(request.id)")
      ZStack {
        if isSending(.reply) {
          IslandSpinner(side: 13)
        } else {
          IslandIconButton(glyph: "arrow-up", label: labels.text(.activitySend)) {
            model.reply(typed, to: request, of: item.key)
          }
          .disabled(typed.isEmpty || sending != nil)
        }
      }
      .frame(width: IslandMetrics.controlSide, height: IslandMetrics.controlSide)
    }
    .padding(.leading, 10)
    .padding(.trailing, 2)
    .background {
      IslandWash(
        level: focused ? 0.09 : 0.05,
        shape: RoundedRectangle(cornerRadius: IslandMetrics.controlSide / 2, style: .continuous))
    }
  }
}

/// A suggested answer: its full text on a quiet wash, answering with it on click. While that
/// answer is on its way it shows the progress in place of its text after 400 ms.
private struct TaskActivityChoice: View {
  let title: String
  let label: String
  var busy: String?
  let action: () -> Void
  @State private var hovered = false
  @State private var progress = false
  @Environment(\.isEnabled) private var isEnabled

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        if progress { IslandSpinner(side: 13) }
        Text(verbatim: progress ? busy ?? title : title).font(TaskActivityRequestStyle.body)
          .lineLimit(2).multilineTextAlignment(.leading)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 10).padding(.vertical, 6)
    }
    .buttonStyle(
      IslandWashStyle(
        shape: RoundedRectangle(cornerRadius: 9, style: .continuous), hovered: hovered,
        rest: 0.05)
    )
    .foregroundStyle(.primary)
    .opacity(isEnabled || busy != nil ? 1 : 0.55)
    .allowsHitTesting(busy == nil)
    .onHover { hovered = $0 }
    .pointerStyle(isEnabled ? .link : nil)
    .help(title)
    .accessibilityLabel(Text(verbatim: label))
    .task(id: busy != nil) {
      progress = false
      guard busy != nil else { return }
      do { try await Task.sleep(for: .milliseconds(400)) } catch { return }
      progress = true
    }
  }
}
