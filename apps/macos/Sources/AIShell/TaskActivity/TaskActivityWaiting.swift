import AICore
import SwiftUI

/// A waiting task's requests in its row, in the text column under its summary. One request
/// shows its essentials in a box that opens it on the card's page; a question is answered right
/// there instead. Further requests stack under the first, as grouped notifications do: two
/// receding edges and a count, which spreads them out into one box each, with each request's
/// decisions on their own line under its text, so the text keeps its width either way. The
/// locked screen's note replaces the requests, and what an answer that did not land left
/// behind follows them.
struct TaskActivityWaiting: View {
  let item: TaskActivityItem
  let model: TaskActivityModel
  /// The first request's decisions travel between the action bar and their own line.
  let decisions: Namespace.ID
  private var labels: TaskActivityLabels { model.labels }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let first = item.requests.first {
        if item.requests.count == 1 { single(first) } else { stack }
      } else if item.locked {
        Text(verbatim: labels.text(.activityLocked)).font(TaskActivityRequestStyle.note)
          .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
      }
      if let notice = model.notices[item.key] {
        TaskActivityNoticeText(notice: notice, labels: labels)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    // The text column of the summary above.
    .padding(.leading, TaskActivityMetrics.artworkSide + 10)
  }

  @ViewBuilder
  private func single(_ request: TaskActivityPendingRequest) -> some View {
    if case .question(let question) = request.kind {
      TaskActivityQuestionView(
        item: item, request: request, question: question, index: 0, model: model)
    } else {
      TaskActivityRequestBox(request: request, labels: labels) { model.openPage(item.key, 0) }
    }
  }

  private var stack: some View {
    let expanded = model.expanded.contains(item.key)
    let shown = expanded ? item.requests : Array(item.requests.prefix(1))
    let reduced = model.reducedMotion
    return VStack(alignment: .leading, spacing: 6) {
      ForEach(Array(shown.enumerated()), id: \.element.id) { index, request in
        TaskActivityRequestBox(request: request, labels: labels) {
          model.openPage(item.key, index)
        } trailing: {
          if expanded {
            HStack(spacing: 0) {
              Spacer(minLength: 0)
              TaskActivityDecisions(
                item: item, request: request, index: index, placement: .line, model: model)
            }
            .padding(.trailing, -4)
            .modifier(
              TaskActivityTravel(
                id: request.id, first: index == 0, in: decisions, reduced: reduced))
          }
        }
        .background(alignment: .bottom) {
          if index == 0 && !expanded { TaskActivityStackEdges().transition(.opacity) }
        }
        .padding(.bottom, index == 0 && !expanded ? 8 : 0)
        .zIndex(Double(shown.count - index))
        .transition(
          index == 0 ? .identity : TaskActivityMotion.unfold(order: index, reduced: reduced))
      }
      TaskActivityLink(
        title: expanded
          ? labels.text(.activityShowLess) : labels.moreRequests(item.requests.count - 1),
        glyph: expanded ? "chevron-up" : "chevron-down"
      ) { model.setExpanded(item.key, !expanded) }
      .accessibilityValue(labels.text(expanded ? .activityExpanded : .activityCollapsed))
      .accessibilityIdentifier("activity.stack.\(item.key.taskID)/\(item.key.runID)")
    }
  }
}

/// The two receding edges under the first of several requests, as a notification group's.
private struct TaskActivityStackEdges: View {
  var body: some View {
    ZStack(alignment: .bottom) {
      edge(inset: 12, level: 0.03).offset(y: 8)
      edge(inset: 6, level: 0.045).offset(y: 4)
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }

  private func edge(inset: Double, level: Double) -> some View {
    IslandWash(
      level: level,
      shape: UnevenRoundedRectangle(
        bottomLeadingRadius: TaskActivityRequestStyle.boxRadius,
        bottomTrailingRadius: TaskActivityRequestStyle.boxRadius, style: .continuous)
    )
    .frame(height: 8)
    .padding(.horizontal, inset)
  }
}

/// The first request's decisions are one piece that travels between the action bar and its
/// own line as the stack spreads out or folds back; under Reduce Motion they cross-fade.
struct TaskActivityTravel: ViewModifier {
  let id: String
  let first: Bool
  let namespace: Namespace.ID
  let reduced: Bool

  init(id: String, first: Bool, in namespace: Namespace.ID, reduced: Bool) {
    self.id = id
    self.first = first
    self.namespace = namespace
    self.reduced = reduced
  }

  func body(content: Content) -> some View {
    if first && !reduced {
      content.matchedGeometryEffect(id: id, in: namespace)
    } else {
      content
    }
  }
}
