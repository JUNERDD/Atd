import AICore
import AppKit
import SwiftUI

/// The request texts' type and colours: titles and targets as the panel's approval shows them,
/// notes in the secondary colour, and the review's warning in an amber that keeps its contrast
/// on light and dark glass.
enum TaskActivityRequestStyle {
  static let title = Font.system(size: 13, weight: .semibold)
  static let body = Font.system(size: 13)
  static let note = Font.system(size: 12)
  static let target = Font.system(size: 11.5, design: .monospaced)
  static let pageTitle = Font.system(size: 15, weight: .semibold)
  /// A request's box inside a row: a quiet wash, concentric with the row.
  static let boxRadius = 8.0
  static let boxLevel = 0.04

  static let warning = Color(
    nsColor: NSColor(name: nil) { appearance in
      appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        ? NSColor(srgbRed: 1, green: 168 / 255, blue: 64 / 255, alpha: 1)
        : NSColor(srgbRed: 168 / 255, green: 78 / 255, blue: 0, alpha: 1)
    })
  static let error = Color(nsColor: .systemRed)
}

/// A request's essentials: what it asks, who asked, and its target on one line, with the
/// review's warning when there is one. A question shows its first line, a view says it waits in
/// its window.
struct TaskActivityEssentials: View {
  let request: TaskActivityPendingRequest
  let labels: TaskActivityLabels

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      switch request.kind {
      case .approval(let approval):
        Text(verbatim: labels.scope(approval.scope)).font(TaskActivityRequestStyle.title)
          .lineLimit(1)
        subagent
        if !approval.target.isEmpty {
          Text(verbatim: approval.target).font(TaskActivityRequestStyle.target)
            .lineLimit(1).truncationMode(.tail)
        }
        if let review = approval.review {
          Text(
            verbatim: labels.text(
              review.outcome == .unavailable
                ? .activityReviewUnavailableShort : .activityReviewFlaggedShort)
          )
          .font(TaskActivityRequestStyle.note).foregroundStyle(TaskActivityRequestStyle.warning)
          .lineLimit(1)
        }
      case .question(let question):
        subagent
        Text(verbatim: question.title).font(TaskActivityRequestStyle.body).lineLimit(1)
      case .view(_, let title):
        subagent
        Text(verbatim: labels.format(.activityViewWaiting, title))
          .font(TaskActivityRequestStyle.note).foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .multilineTextAlignment(.leading)
  }

  @ViewBuilder private var subagent: some View {
    if let name = request.subagent {
      TaskActivitySubagent(name: name, labels: labels)
    }
  }
}

/// Where a subagent's request comes from.
struct TaskActivitySubagent: View {
  let name: String
  let labels: TaskActivityLabels

  var body: some View {
    Text(verbatim: labels.format(.activityFromSubagent, name))
      .font(TaskActivityRequestStyle.note).foregroundStyle(.secondary).lineLimit(1)
  }
}

/// A request's essentials in their box, which opens the request on the card's page.
struct TaskActivityRequestBox<Trailing: View>: View {
  let request: TaskActivityPendingRequest
  let labels: TaskActivityLabels
  let open: () -> Void
  /// Below the essentials, inside the box: a spread stack's decisions.
  @ViewBuilder var trailing: () -> Trailing
  @State private var hovered = false

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Button(action: open) {
        TaskActivityEssentials(request: request, labels: labels)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .foregroundStyle(.primary)
      .onHover { hovered = $0 }
      .pointerStyle(.link)
      .help(labels.text(.activityDetails))
      trailing()
    }
    .padding(.horizontal, 8).padding(.vertical, 6)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background {
      IslandWash(
        level: hovered ? 0.06 : TaskActivityRequestStyle.boxLevel,
        shape: RoundedRectangle(
          cornerRadius: TaskActivityRequestStyle.boxRadius, style: .continuous))
    }
  }
}

extension TaskActivityRequestBox where Trailing == EmptyView {
  init(request: TaskActivityPendingRequest, labels: TaskActivityLabels, open: @escaping () -> Void)
  {
    self.init(request: request, labels: labels, open: open) { EmptyView() }
  }
}

/// What the card says under a task's requests after an answer did not land: that the request
/// was handled elsewhere, or an error while it stays pending.
struct TaskActivityNoticeText: View {
  let notice: TaskActivityNotice
  let labels: TaskActivityLabels

  var body: some View {
    Text(verbatim: labels.notice(notice))
      .font(TaskActivityRequestStyle.note)
      .foregroundStyle(notice == .stale ? Color.secondary : TaskActivityRequestStyle.error)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// A quiet text link in the notes' type, with an optional trailing glyph: the way to the rest
/// of a request, and a stack's toggle.
struct TaskActivityLink: View {
  let title: String
  var glyph: String?
  let action: () -> Void
  @State private var hovered = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 4) {
        Text(verbatim: title).font(TaskActivityRequestStyle.note).lineLimit(1)
        if let glyph { IslandGlyph(name: glyph, side: 12) }
      }
      .frame(minHeight: 20)
      .contentShape(Rectangle())
    }
    .buttonStyle(TaskActivityDecisionStyle(kind: .plain, hovered: hovered))
    .onHover { hovered = $0 }
    .pointerStyle(.link)
    .fixedSize()
  }
}
