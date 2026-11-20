import AppIntents
import AtdIntents
import SwiftUI
import WidgetKit

/// 今日简报 in Control Center, on the Lock Screen and on the Action button: runs the briefing in
/// the background, with its progress in a Live Activity.
///
/// Stub (F0a): the control runs `BriefingIntent`, a `LiveActivityIntent`, which the system runs
/// in the app's process without bringing it forward. WS-A replaces it.
public struct BriefingControl: ControlWidget {
  public init() {}

  public var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "briefing") {
      ControlWidgetButton(action: BriefingIntent()) {
        Label {
          Text(BriefingIntent.title)
        } icon: {
          Image(systemName: "sunrise")
        }
      }
    }
    .displayName(BriefingIntent.title)
  }
}
