import AICore
import SwiftUI

/// One task as a card: its source artwork, title, source and the phase's latest detail, a
/// waiting task's requests decided in place, then the run's own actions. Computer use belongs to
/// the task: the app it operates is a badge on the task's artwork and its screen is one of the
/// task's actions (in the More menu while the card decides the task's wait). Its section already
/// names the phase, so the card carries no status of its own beyond its detail and VoiceOver's
/// label. There is no list-level selection, so a card has no selected state; its actions retain
/// the run key. With the keyboard on a waiting card, Return takes its default decision.
struct TaskActivityTask: View {
  let item: TaskActivityItem
  let model: TaskActivityModel
  @Namespace private var decisions
  @FocusState private var focused: Bool
  private var labels: TaskActivityLabels { model.labels }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .top, spacing: 0) {
        summary
        if item.decidesInPlace { more }
      }
      if item.decidesInPlace {
        TaskActivityWaiting(item: item, model: model, decisions: decisions)
      }
      TaskActivityActions(item: item, model: model, decisions: decisions, keyboard: focused)
    }
    .padding(TaskActivityMetrics.cardPadding)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background {
      IslandWash(level: 0.035, shape: Self.shape)
    }
    // Text replaces directly even when the list's layout springs, and the card moves as one
    // piece: without the group its parts would travel separately, and actions it gained would
    // appear at its destination while it was still on its way.
    .contentTransition(.identity)
    .geometryGroup()
    // Only keyboard navigation focuses a card; a click never does, so ↩ never shows for one.
    .focusable(item.decidesInPlace, interactions: .activate)
    .focused($focused)
    .contentShape(.focusEffect, Self.shape)
    .onKeyPress(.return) { returnPressed() }
    .onChange(of: model.focusedRow) { _, key in
      guard key == item.key else { return }
      model.focusedRow = nil
      if item.decidesInPlace { focused = true }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(labels.format(.activityConversationAccessibility, item.conversationTitle))
    .accessibilityIdentifier("activity.row.\(item.key.taskID)/\(item.key.runID)")
  }

  private static var shape: RoundedRectangle {
    RoundedRectangle(cornerRadius: TaskActivityMetrics.rowRadius, style: .continuous)
  }

  /// The card itself has the keyboard (not one of its controls, which keeps its own Return):
  /// the first request's default decision, unless the stack is spread out.
  private func returnPressed() -> SwiftUI.KeyPress.Result {
    guard focused, let first = item.requests.first, model.sending[item.key] == nil,
      item.requests.count == 1 || !model.expanded.contains(item.key),
      let control = first.rowDefault
    else { return .ignored }
    model.perform(control, on: first, at: 0, of: item.key)
    return .handled
  }

  private var summary: some View {
    HStack(spacing: 10) {
      artwork
      VStack(alignment: .leading, spacing: 3) {
        Text(item.conversationTitle).font(.body.weight(.semibold))
          .lineLimit(1).truncationMode(.tail)
        HStack(spacing: 4) {
          Text(item.source.name).lineLimit(1).fixedSize()
          Text(verbatim: "·")
          Text(item.detail).lineLimit(1).truncationMode(.tail)
        }
        .font(.callout).foregroundStyle(.secondary)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(
      labels.format(
        .activityRowAccessibility, item.source.name, item.title, labels.status(item.phase),
        item.detail) + (using.map { " " + $0 } ?? "")
    )
    .help(
      labels.format(.activityRowHelp, item.title, item.source.name, item.detail)
        + [using, labels.note(item.phase)].compactMap { $0.map { "\n" + $0 } }.joined()
    )
  }

  /// While the card decides the wait, the conversation and the screen are secondary: they move
  /// to this menu at the card's top trailing corner.
  private var more: some View {
    TaskActivityMenuButton(
      glyph: "ellipsis", label: labels.text(.activityRowMore), glyphSide: 15
    ) {
      var entries = [
        TaskActivityMenuEntry(
          title: labels.text(.activityOpenConversation),
          tooltip: labels.format(.activityOpenConversationTooltip, item.conversationTitle)
        ) { model.open(item.key) }
      ]
      if item.usesComputer {
        entries.append(
          TaskActivityMenuEntry(
            title: labels.text(.activityViewScreen),
            tooltip: item.canShowPreview
              ? labels.format(.activityMonitorTooltip, item.computer?.name ?? item.title)
              : labels.text(.activityPreviewUnavailable),
            enabled: item.canShowPreview
          ) { model.monitor(item.key) })
      }
      return entries
    }
    .disabled(!model.cardInteractive)
    .accessibilityIdentifier("activity.more.\(item.key.taskID)/\(item.key.runID)")
  }

  private var using: String? {
    item.computer.map { labels.format(.activityUsingApplication, $0.name) }
  }

  /// An ended run's artwork recedes, so live work stands out in a mixed list.
  private var artwork: some View {
    TaskActivityArtwork(source: item.source, computer: item.computer)
      .animation(TaskActivityMotion.settle(reduced: model.reducedMotion)) {
        $0.saturation(item.phase.isTerminal ? 0 : 1).opacity(item.phase.isTerminal ? 0.6 : 1)
      }
  }
}
