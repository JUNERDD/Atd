import ActivityKit
import AtdAutomations
import AtdModel
import SwiftUI
import WidgetKit

/// An automation run's Live Activity on the Lock Screen and in the Dynamic Island. A tap opens
/// Atd on the automation (`atd://automation/<id>`), where a run waiting for a message offers the
/// compose sheet and a stopped run continues.
public struct AutomationActivityWidget: Widget {
  public init() {}

  public var body: some WidgetConfiguration {
    ActivityConfiguration(for: AutomationActivityAttributes.self) { context in
      AutomationLockScreenView(
        attributes: context.attributes, state: context.state, isStale: context.isStale
      )
      .widgetURL(Self.link(context.attributes))
    } dynamicIsland: { context in
      let attributes = context.attributes
      let state = context.state
      let tint = Color(uiColor: attributes.tint.uiColor)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          ActivityTile(symbol: attributes.symbol, tint: attributes.tint, size: 30)
        }
        DynamicIslandExpandedRegion(.trailing) {
          RunProgress(state: state, isStale: context.isStale)
        }
        DynamicIslandExpandedRegion(.center) {
          Text(attributes.name)
            .font(.headline)
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          ExpandedRun(attributes: attributes, state: state, isStale: context.isStale)
        }
      } compactLeading: {
        Image(systemName: attributes.symbol)
          .foregroundStyle(tint)
          .accessibilityLabel(attributes.name)
      } compactTrailing: {
        CompactProgress(state: state, isStale: context.isStale)
      } minimal: {
        Image(systemName: attributes.symbol)
          .foregroundStyle(tint)
          .accessibilityLabel(attributes.name)
      }
      .widgetURL(Self.link(attributes))
      .keylineTint(tint)
    }
  }

  static func link(_ attributes: AutomationActivityAttributes) -> URL? {
    AtdRoute.automation(id: attributes.automationID).url()
  }
}

/// The expanded Dynamic Island under the head: the question with real buttons, the current
/// step, or the way to continue.
private struct ExpandedRun: View {
  let attributes: AutomationActivityAttributes
  let state: RunState
  let isStale: Bool

  var body: some View {
    Group {
      if let ask = state.ask, !isStale {
        AskView(
          attributes: attributes, state: state, ask: ask,
          link: AutomationActivityWidget.link(attributes))
      } else if state.phase == .interrupted || isStale {
        ContinueLine(state: state)
      } else if state.steps.indices.contains(state.current) {
        let step = state.steps[state.current]
        HStack(spacing: 8) {
          StepMark(status: step.status)
          Text(step.text)
            .lineLimit(1)
        }
      }
    }
    .font(.subheadline.weight(.medium))
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.top, 4)
  }
}

/// The compact Dynamic Island's trailing side: 2/3, 待确认, a check, or a mark that it stopped.
private struct CompactProgress: View {
  let state: RunState
  let isStale: Bool

  var body: some View {
    switch (state.phase, isStale) {
    case (.finished, _):
      Image(
        systemName: state.failures > 0 ? "exclamationmark.circle.fill" : "checkmark.circle.fill"
      )
      .foregroundStyle(state.failures > 0 ? .orange : .green)
      .accessibilityLabel(
        state.failures > 0
          ? ActivityText.string("activity.failures \(state.failures)")
          : ActivityText.string("activity.done"))
    case (.interrupted, _), (_, true):
      Image(systemName: "exclamationmark.circle")
        .foregroundStyle(.orange)
        .accessibilityLabel(ActivityText.string("activity.notFinished"))
    case (.awaiting, _):
      Text(ActivityText.string("activity.waiting"))
        .font(.caption.weight(.semibold))
    case (.running, _):
      Text(verbatim: "\(state.current + 1)/\(state.steps.count)")
        .font(.caption.weight(.semibold))
        .monospacedDigit()
    }
  }
}
