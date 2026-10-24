import AICore
import SwiftUI

/// A card's action bar: Stop on the leading edge, then a plain secondary action and the one
/// prominent action for the phase on the trailing edge; a running task that does not operate the
/// computer has only the prominent one. A task whose wait the card decides in place shows its
/// first request's decisions there instead, unless its stack is spread out and each request
/// decides on its own line; its conversation and screen are in the card's More menu. Each
/// control retains the run key, so a later run cannot receive an earlier action.
struct TaskActivityActions: View {
  let item: TaskActivityItem
  let model: TaskActivityModel
  /// The first request's decisions travel between this bar and their own line.
  let decisions: Namespace.ID
  /// The keyboard is on the card: the default decision shows ↩.
  var keyboard = false
  private var labels: TaskActivityLabels { model.labels }

  var body: some View {
    // Actions replace directly with the phase; only the list's layout around them springs.
    HStack(spacing: 4) {
      TaskActivityStopControl(item: item, model: model)
      Spacer(minLength: 8)
      if item.decidesInPlace {
        if let first = item.requests.first,
          item.requests.count == 1 || !model.expanded.contains(item.key)
        {
          TaskActivityDecisions(
            item: item, request: first, index: 0, placement: .bar, model: model,
            keyboard: keyboard
          )
          .modifier(
            TaskActivityTravel(
              id: first.id, first: true, in: decisions, reduced: model.reducedMotion))
        }
      } else if item.phase == .running && item.usesComputer {
        TaskActivityTextAction(
          title: labels.text(.activityOpenConversation),
          tooltip: labels.format(.activityOpenConversationTooltip, item.conversationTitle)
        ) { model.open(item.key) }
        .accessibilityLabel(labels.format(.activityOpenConversationTooltip, item.conversationTitle))
        .accessibilityIdentifier(identifier("open"))
        .transition(.identity)
        monitor(prominent: true).transition(.identity)
      } else if item.phase == .running {
        // Without a screen to show, the conversation is the run's one action.
        IslandTextButton(
          title: labels.text(.activityOpenConversation),
          tooltip: labels.format(.activityOpenConversationTooltip, item.conversationTitle),
          rest: 0.08, action: { model.open(item.key) }
        ) { EmptyView() }
        .accessibilityLabel(labels.format(.activityOpenConversationTooltip, item.conversationTitle))
        .accessibilityIdentifier(identifier("open"))
        .transition(.identity)
      } else {
        if item.canShowPreview && !item.phase.isTerminal {
          monitor(prominent: false).transition(.identity)
        }
        primary.transition(.identity)
      }
    }
  }

  /// The phase's prominent action, which opens the task: Review, Answer, View result and so on.
  private var primary: some View {
    IslandTextButton(
      title: labels.primaryTitle(item),
      tooltip: labels.format(.activityOpenTaskTooltip, item.title), rest: 0.08,
      action: { model.open(item.key) }
    ) { EmptyView() }
    .accessibilityLabel(
      labels.format(.activityOpenAccessibility, labels.primaryTitle(item), item.conversationTitle)
    )
    .accessibilityIdentifier(identifier("open"))
  }

  /// Running work's prominent action is its screen, disabled with a reason until a source
  /// exists; other live phases offer it as a plain action only when there is something to show.
  @ViewBuilder
  private func monitor(prominent: Bool) -> some View {
    let tooltip =
      item.canShowPreview
      ? labels.format(.activityMonitorTooltip, item.computer?.name ?? item.title)
      : labels.text(.activityPreviewUnavailable)
    Group {
      if prominent {
        IslandTextButton(
          title: labels.text(.activityViewScreen), tooltip: tooltip, rest: 0.08,
          action: { model.monitor(item.key) }
        ) { EmptyView() }
        .opacity(item.canShowPreview ? 1 : 0.4)
      } else {
        TaskActivityTextAction(title: labels.text(.activityViewScreen), tooltip: tooltip) {
          model.monitor(item.key)
        }
      }
    }
    .disabled(!item.canShowPreview)
    .accessibilityLabel(labels.format(.activityMonitorAccessibility, item.conversationTitle))
    .accessibilityIdentifier(identifier("monitor"))
  }

  private func identifier(_ action: String) -> String {
    "activity.\(action).\(item.key.taskID)/\(item.key.runID)"
  }
}

/// A plain text action with no fill in any state: a secondary label that comes forward under
/// the pointer and dims while pressed. Disabled, it dims and keeps its tooltip as the reason.
struct TaskActivityTextAction<Trailing: View>: View {
  let title: String
  var tooltip: String?
  let action: () -> Void
  @ViewBuilder var trailing: () -> Trailing
  @State private var hovered = false
  @Environment(\.isEnabled) private var isEnabled

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        Text(verbatim: title).font(IslandType.label).lineLimit(1)
        trailing()
      }
      .padding(.horizontal, 4)
      .frame(height: IslandMetrics.controlSide)
      .contentShape(Rectangle())
    }
    .buttonStyle(TaskActivityTextActionStyle(hovered: hovered && isEnabled))
    .opacity(isEnabled ? 1 : 0.7)
    .onHover { hovered = $0 }
    .pointerStyle(isEnabled ? .link : nil)
    .help(tooltip ?? title)
  }
}

extension TaskActivityTextAction where Trailing == EmptyView {
  init(title: String, tooltip: String? = nil, action: @escaping () -> Void) {
    self.init(title: title, tooltip: tooltip, action: action) { EmptyView() }
  }
}

private struct TaskActivityTextActionStyle: ButtonStyle {
  let hovered: Bool

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .foregroundStyle(hovered ? Color.primary : Color.secondary)
      .opacity(configuration.isPressed ? 0.55 : 1)
  }
}
