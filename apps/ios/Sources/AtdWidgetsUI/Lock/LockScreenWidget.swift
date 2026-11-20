import AtdModel
import SwiftUI
import WidgetKit

/// Atd on the Lock Screen: a round button that opens 问 Atd.
///
/// Stub (F0a): WS-A replaces it with the 随手问 and 记一笔 buttons and the next item of the day.
public struct LockScreenWidget: Widget {
  public init() {}

  public var body: some WidgetConfiguration {
    StaticConfiguration(kind: "lock", provider: StubTimeline()) { _ in
      ZStack {
        AccessoryWidgetBackground()
        Image(systemName: "waveform")
          .font(.title3)
      }
      .accessibilityLabel(Text(Self.name))
      .widgetURL(AtdRoute.ask(text: nil).url())
      .containerBackground(.clear, for: .widget)
    }
    .configurationDisplayName(Text(Self.name))
    .supportedFamilies([.accessoryCircular])
  }

  private static var name: String {
    String(localized: "lock.name", table: "Entry", bundle: .module)
  }
}
