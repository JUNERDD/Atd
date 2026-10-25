import AICore
import AppKit
import SwiftUI

/// A request open on the card's page, in place of the list: everything the conversation's
/// approval shows for it (what it would allow, who asked, the notes and the review, the full
/// detail to read and copy) or the whole question, and every decision, with Allow once as the
/// Return default. The page takes the keyboard as it opens; Escape goes back to the list. Once
/// the request is settled the task's next one takes its place (``TaskActivityController``).
struct TaskActivityRequestPage: View {
  let item: TaskActivityItem
  let index: Int
  let model: TaskActivityModel
  @FocusState private var focused: Bool
  private var labels: TaskActivityLabels { model.labels }
  private var request: TaskActivityPendingRequest { item.requests[index] }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let notice = model.notices[item.key] {
        TaskActivityNoticeText(notice: notice, labels: labels)
      }
      content
      TaskActivityDecisions(
        item: item, request: request, index: index, placement: .page, model: model,
        keyboard: focused
      )
      .padding(.top, 2)
    }
    .padding(.horizontal, 8).padding(.top, 4).padding(.bottom, 6)
    .frame(maxWidth: .infinity, alignment: .leading)
    .focusable()
    .focusEffectDisabled()
    .focused($focused)
    .onKeyPress(.return) { returnPressed() }
    .onExitCommand { model.back(true) }
    .task {
      // The window takes the keyboard as the page opens; focus follows on the next turn.
      await Task.yield()
      focused = true
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("activity.page.\(item.key.taskID)/\(item.key.runID)/\(request.id)")
  }

  @ViewBuilder private var content: some View {
    switch request.kind {
    case .approval(let approval):
      Text(verbatim: labels.scope(approval.scope)).font(TaskActivityRequestStyle.pageTitle)
        .fixedSize(horizontal: false, vertical: true)
      if let subagent = request.subagent {
        TaskActivitySubagent(name: subagent, labels: labels)
      }
      ForEach(Array(notes(approval).enumerated()), id: \.offset) { _, note in
        Text(verbatim: note.text).font(TaskActivityRequestStyle.note)
          .foregroundStyle(note.warning ? TaskActivityRequestStyle.warning : Color.secondary)
          .fixedSize(horizontal: false, vertical: true)
          .textSelection(.enabled)
      }
      if !approval.detail.isEmpty {
        TaskActivityDetailBox(
          text: approval.detail + (approval.clipped ? "…" : ""), copy: approval.detail,
          labels: labels)
      }
    case .question(let question):
      TaskActivityQuestionView(
        item: item, request: request, question: question, index: index, model: model,
        complete: true)
    case .view(_, let title):
      if let subagent = request.subagent {
        TaskActivitySubagent(name: subagent, labels: labels)
      }
      Text(verbatim: labels.format(.activityViewWaiting, title))
        .font(TaskActivityRequestStyle.body).fixedSize(horizontal: false, vertical: true)
    }
  }

  /// The approval's notes, in the conversation's order: why a terminal command asks, what
  /// computer access allows and how Atd operates the target, then the review's warning.
  private func notes(_ approval: TaskActivityApproval) -> [(text: String, warning: Bool)] {
    var notes: [(text: String, warning: Bool)] = []
    if approval.isBash { notes.append((labels.text(.activityBashNotAllowlisted), false)) }
    if let access = approval.access {
      let key: TaskActivityStringKey =
        access.persistence == .saved ? .activityAccessSaved : .activityAccessRun
      notes.append((labels.format(key, access.targetLabel), false))
      let browser = access.targetKind == .browser
      notes.append(
        (labels.text(browser ? .activityAccessBackground : .activityAccessApplication), false))
      if browser && !access.origins.isEmpty {
        notes.append((access.origins.joined(separator: ", "), false))
      }
    }
    if let review = approval.review {
      let reason = review.reason.trimmingCharacters(in: .whitespacesAndNewlines)
      let text =
        review.outcome == .unavailable
        ? labels.text(.activityReviewUnavailable)
        : reason.isEmpty
          ? labels.text(.activityReviewFlaggedNoReason)
          : labels.format(.activityReviewFlagged, reason)
      notes.append((text, true))
    }
    return notes
  }

  /// The page's own keyboard (not one of its controls or its reply field): the default
  /// decision.
  private func returnPressed() -> SwiftUI.KeyPress.Result {
    guard focused, model.sending[item.key] == nil, let control = request.pageDefault else {
      return .ignored
    }
    model.pageAnsweredByKeyboard = true
    model.perform(control, on: request, at: index, of: item.key)
    return .handled
  }
}

/// A request's full detail in the monospaced type, selectable, with a Copy button in its
/// corner. The page scrolls; the box never does on its own.
private struct TaskActivityDetailBox: View {
  let text: String
  let copy: String
  let labels: TaskActivityLabels
  @State private var copied = false
  @State private var hovered = false

  var body: some View {
    Text(verbatim: text).font(TaskActivityRequestStyle.target)
      .lineSpacing(2)
      .textSelection(.enabled)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.leading, 8).padding(.trailing, 28).padding(.vertical, 6)
      .background {
        IslandWash(
          level: 0.05,
          shape: RoundedRectangle(
            cornerRadius: TaskActivityRequestStyle.boxRadius, style: .continuous))
      }
      .overlay(alignment: .topTrailing) {
        Button {
          NSPasteboard.general.clearContents()
          NSPasteboard.general.setString(copy, forType: .string)
          copied = true
        } label: {
          IslandGlyph(name: "copy", side: 12).frame(width: 22, height: 22)
        }
        .buttonStyle(
          IslandWashStyle(
            shape: RoundedRectangle(cornerRadius: 6, style: .continuous), hovered: hovered)
        )
        .foregroundStyle(hovered ? Color.primary : Color.secondary)
        .onHover { hovered = $0 }
        .pointerStyle(.link)
        .help(labels.text(copied ? .activityCopied : .activityCopy))
        .accessibilityLabel(Text(verbatim: labels.text(copied ? .activityCopied : .activityCopy)))
        .padding(3)
      }
  }
}
