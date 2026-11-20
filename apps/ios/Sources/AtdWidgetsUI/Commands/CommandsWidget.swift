import AtdModel
import SwiftUI
import WidgetKit

/// 常用指令 on the Home Screen.
///
/// Stub (F0a): names itself and opens the 指令 tab. WS-A replaces it with the command buttons
/// (prototype `home.js`).
public struct CommandsWidget: Widget {
  public init() {}

  public var body: some WidgetConfiguration {
    StaticConfiguration(kind: "commands", provider: StubTimeline()) { _ in
      StubWidgetView(symbol: "wand.and.sparkles", title: Self.name)
        .widgetURL(AtdRoute.commands.url())
    }
    .configurationDisplayName(Text(Self.name))
    .supportedFamilies([.systemSmall, .systemMedium])
  }

  private static var name: String {
    String(localized: "commands.name", table: "Entry", bundle: .module)
  }
}
