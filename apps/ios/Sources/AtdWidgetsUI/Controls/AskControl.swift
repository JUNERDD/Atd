import AppIntents
import AtdIntents
import SwiftUI
import WidgetKit

/// 随手问 in Control Center, on the Lock Screen and on the Action button: opens 问 Atd, after
/// Face ID when the iPhone is locked.
///
/// The pattern for a control that opens the app: its intent (`OpenAskIntent`) is declared by both
/// bundles, and its name is the intent's title, so it comes from the main bundle like every App
/// Intents string.
public struct AskControl: ControlWidget {
  public init() {}

  public var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "ask") {
      ControlWidgetButton(action: OpenAskIntent()) {
        Label {
          Text(OpenAskIntent.title)
        } icon: {
          Image(systemName: "waveform")
        }
      }
    }
    .displayName(OpenAskIntent.title)
  }
}
