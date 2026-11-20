import AtdModel
import SwiftUI
import WidgetKit

/// 随手问 under the Lock Screen clock: opens 问 Atd once the iPhone unlocks.
public struct AskLockWidget: Widget {
  public init() {}

  public var body: some WidgetConfiguration {
    StaticConfiguration(kind: "lock.ask", provider: CommandsTimeline()) { _ in
      LockButtonView(symbol: "waveform", label: EntryCopy.string("widget.ask"))
        .widgetURL(AtdRoute.ask(text: nil).url())
    }
    .configurationDisplayName(Text(EntryCopy.string("widget.ask")))
    .supportedFamilies([.accessoryCircular])
  }
}

/// 记一笔 under the Lock Screen clock: opens Atd's camera on 记一笔 once the iPhone unlocks. To
/// shoot a receipt without unlocking, 拍了就办's capture control is the way.
public struct ExpenseLockWidget: Widget {
  public init() {}

  public var body: some WidgetConfiguration {
    StaticConfiguration(kind: "lock.expense", provider: CommandsTimeline()) { _ in
      LockButtonView(symbol: "receipt", label: EntryCopy.string("widget.expense"))
        .widgetURL(AtdRoute.camera(commandID: BuiltinCommands.expenseID).url())
    }
    .configurationDisplayName(Text(EntryCopy.string("widget.expense")))
    .supportedFamilies([.accessoryCircular])
  }
}

/// A round Lock Screen button: the command's glyph over its name. The Lock Screen draws
/// accessories in one tint over the wallpaper, so Atd's ink shows only as line.
struct LockButtonView: View {
  let symbol: String
  let label: String

  var body: some View {
    ZStack {
      AccessoryWidgetBackground()
      VStack(spacing: 1) {
        Image(systemName: symbol)
          .font(.system(size: 20, weight: .semibold))
        Text(label)
          .font(.system(size: 10, weight: .semibold))
          .lineLimit(1)
          .minimumScaleFactor(0.6)
          .padding(.horizontal, 6)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(Text(label))
    .accessibilityAddTraits(.isButton)
    .containerBackground(.clear, for: .widget)
  }
}
