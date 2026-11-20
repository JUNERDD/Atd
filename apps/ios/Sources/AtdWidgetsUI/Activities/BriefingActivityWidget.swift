import ActivityKit
import AtdInk
import AtdIntents
import AtdModel
import SwiftUI
import WidgetKit

/// The Live Activity of a command run without opening Atd (今日简报, or a command that reads
/// nothing from the 运行指令 control): its progress, then its result, on Atd's paper on the Lock
/// Screen and in the Dynamic Island. Tapping it opens the command in Atd.
public struct BriefingActivityWidget: Widget {
  public init() {}

  public var body: some WidgetConfiguration {
    ActivityConfiguration(for: BriefingActivityAttributes.self) { context in
      BriefingActivityLockView(
        attributes: context.attributes, state: context.state, isStale: context.isStale
      )
      .activityBackgroundTint(InkColor.paper)
      .activitySystemActionForegroundColor(.primary)
      .widgetURL(AtdRoute.command(id: context.attributes.commandID).url())
    } dynamicIsland: { context in
      island(context)
    }
  }

  private func island(_ context: ActivityViewContext<BriefingActivityAttributes>) -> DynamicIsland {
    let attributes = context.attributes
    return DynamicIsland {
      DynamicIslandExpandedRegion(.leading) {
        BriefingActivitySticker(attributes: attributes, size: 26)
          .padding(.leading, 4)
      }
      DynamicIslandExpandedRegion(.center) {
        Text(attributes.name)
          .font(.headline)
          .lineLimit(1)
      }
      DynamicIslandExpandedRegion(.trailing) {
        Text(BriefingActivityHeader.dayText(attributes.day))
          .font(.caption.weight(.medium))
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .padding(.trailing, 4)
      }
      DynamicIslandExpandedRegion(.bottom) {
        BriefingActivityBody(attributes: attributes, state: context.state, isStale: context.isStale)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 4)
          .dynamicTypeSize(...BriefingActivityBody.largestType)
      }
    } compactLeading: {
      BriefingActivitySticker(attributes: attributes, size: 22)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(attributes.name))
    } compactTrailing: {
      BriefingActivityStatus(state: context.state, isStale: context.isStale)
    } minimal: {
      Image(systemName: attributes.symbol)
        .foregroundStyle(InkColor.sticker(attributes.tint))
        .accessibilityLabel(Text(attributes.name))
    }
    .widgetURL(AtdRoute.command(id: attributes.commandID).url())
    .keylineTint(InkColor.sticker(attributes.tint))
  }
}
