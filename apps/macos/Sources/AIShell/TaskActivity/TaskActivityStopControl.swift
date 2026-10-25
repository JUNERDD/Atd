import AICore
import SwiftUI

/// Stop, always shown while the run can stop, as plain text with no fill. A requested stop takes
/// the card out of the list (``ShellTaskActivity``); the label only lingers on an unconfirmed
/// stop, as Retry, or on a stop requested elsewhere, where the busy state stays inside the
/// control: a spinner after 400 ms of continuous pending, without a minimum busy duration.
/// An ended run keeps the empty slot.
struct TaskActivityStopControl: View {
  let item: TaskActivityItem
  let model: TaskActivityModel
  @State private var indicatorRun: TaskActivityRunKey?

  private static let indicatorSide = 13.0
  private static let labelGap = 6.0
  private var labels: TaskActivityLabels { model.labels }
  private var available: Bool { item.canStop || item.phase == .stopping }
  private var progress: ProgressIdentity {
    .init(key: item.key, pending: item.phase == .stopping && model.cardInteractive)
  }

  var body: some View {
    TaskActivityTextAction(title: title, tooltip: tooltip) {
      guard model.cardInteractive, item.canStop else { return }
      model.stop(item.key)
    } trailing: {
      if item.phase == .stopping {
        ZStack {
          if progress.pending && indicatorRun == item.key {
            IslandSpinner(side: Self.indicatorSide)
          }
        }
        .frame(width: Self.indicatorSide, height: Self.indicatorSide)
        .accessibilityHidden(true)
      }
    }
    .disabled(!item.canStop || !model.cardInteractive)
    .opacity(available ? 1 : 0)
    .allowsHitTesting(available && model.cardInteractive)
    .accessibilityLabel(accessibilityLabel)
    .accessibilityHidden(!available || !model.cardInteractive)
    .accessibilityIdentifier("activity.stop.\(item.key.taskID)/\(item.key.runID)")
    .task(id: progress) {
      indicatorRun = nil
      guard progress.pending else { return }
      do { try await Task.sleep(for: .milliseconds(400)) } catch { return }
      guard !Task.isCancelled else { return }
      indicatorRun = item.key
    }
    .onDisappear { indicatorRun = nil }
    .frame(width: slotWidth, alignment: .leading)
  }

  /// The widest localized state, reserved outside the button: its hit region keeps the label's
  /// own width while the actions beside it stay anchored.
  private var slotWidth: Double {
    let width: (TaskActivityStringKey) -> Double = {
      IslandType.width(of: labels.text($0), limit: .greatestFiniteMagnitude)
    }
    return 8
      + max(
        width(.activityStopTask), width(.activityRetryStop),
        width(.activityStopping) + Self.labelGap + Self.indicatorSide)
  }

  private var title: String {
    let key: TaskActivityStringKey =
      switch item.phase {
      case .stopping: .activityStopping
      case .stopPending: .activityRetryStop
      default: .activityStopTask
      }
    return labels.text(key)
  }

  private var tooltip: String {
    switch item.phase {
    case .stopping, .stopped: accessibilityLabel
    case .stopPending: labels.format(.activityRetryStopTooltip, item.title)
    default: labels.format(.activityStopTooltip, item.title)
    }
  }

  private var accessibilityLabel: String {
    let key: TaskActivityStringKey =
      switch item.phase {
      case .stopping: .activityStoppingAccessibility
      case .stopPending: .activityRetryStopAccessibility
      case .stopped: .activityStoppedAccessibility
      default: .activityStopAccessibility
      }
    return labels.format(key, item.conversationTitle)
  }

  private struct ProgressIdentity: Equatable {
    let key: TaskActivityRunKey
    let pending: Bool
  }
}
