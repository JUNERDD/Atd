import ActivityKit
import AppIntents
import AtdAutomations
import AtdInk
import AtdModel
import SwiftUI
import WidgetKit

/// The focus timer's Live Activity: the running time with 结束, then how long it ran. A tap opens
/// Atd on the automation that started it.
public struct FocusActivityWidget: Widget {
  public init() {}

  public var body: some WidgetConfiguration {
    ActivityConfiguration(for: FocusActivityAttributes.self) { context in
      FocusLockScreenView(attributes: context.attributes, state: context.state)
        .widgetURL(Self.link(context.attributes))
    } dynamicIsland: { context in
      let attributes = context.attributes
      let state = context.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          ActivityTile(symbol: "timer", tint: .purple, size: 30)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(attributes.label)
            .font(.subheadline.weight(.semibold))
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.center) {
          Text(ActivityText.string("focus.title"))
            .font(.headline)
        }
        DynamicIslandExpandedRegion(.bottom) {
          FocusBody(attributes: attributes, state: state)
            .padding(.top, 4)
        }
      } compactLeading: {
        InkSymbol("timer", size: 20)
          .foregroundStyle(.purple)
          .accessibilityLabel(ActivityText.string("focus.title"))
      } compactTrailing: {
        if let end = state.end {
          Text(FocusTime.text(.seconds(end.timeIntervalSince(attributes.start))))
            .monospacedDigit()
        } else {
          Text(attributes.start, style: .timer)
            .monospacedDigit()
            .multilineTextAlignment(.trailing)
            .frame(maxWidth: 52)
        }
      } minimal: {
        InkSymbol("timer", size: 20)
          .foregroundStyle(.purple)
          .accessibilityLabel(ActivityText.string("focus.title"))
      }
      .widgetURL(Self.link(attributes))
      .keylineTint(.purple)
    }
  }

  static func link(_ attributes: FocusActivityAttributes) -> URL? {
    AtdRoute.automation(id: attributes.automationID).url()
  }
}

/// The focus timer on the Lock Screen: 专注记录 and what it is for, then the time.
struct FocusLockScreenView: View {
  let attributes: FocusActivityAttributes
  let state: FocusActivityAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        ActivityTile(symbol: "timer", tint: .purple)
        Text(ActivityText.string("focus.title"))
          .font(.subheadline.weight(.semibold))
        Spacer(minLength: 4)
        Text(attributes.label)
          .font(.subheadline.weight(.semibold))
          .lineLimit(1)
      }
      FocusBody(attributes: attributes, state: state)
    }
    .padding(14)
  }
}

/// The running time with 结束, or, once ended, how long the session ran.
struct FocusBody: View {
  let attributes: FocusActivityAttributes
  let state: FocusActivityAttributes.ContentState

  var body: some View {
    if let end = state.end {
      let time = FocusTime.text(.seconds(max(end.timeIntervalSince(attributes.start), 0)))
      Text(ActivityText.string("focus.done \(time)"))
        .font(.headline)
    } else {
      HStack(spacing: 12) {
        Text(attributes.start, style: .timer)
          .font(.system(size: 40, weight: .semibold))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.6)
        Spacer(minLength: 0)
        Button(intent: EndFocusIntent(sessionID: attributes.sessionID)) {
          ActivityButtonLabel(title: ActivityText.string("focus.end"), primary: true)
            .frame(width: 96)
        }
        .buttonStyle(.plain)
      }
    }
  }
}
