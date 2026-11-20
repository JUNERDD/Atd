import AppIntents
import AtdIntents
import SwiftUI
import WidgetKit

/// 运行指令 in Control Center, on the Lock Screen and on the Action button: runs the command the
/// person picked when adding it, from those placed in controls. A command that reads nothing
/// answers in a Live Activity without unlocking; any other opens Atd (A25).
public struct RunCommandControl: ControlWidget {
  public init() {}

  public var body: some ControlWidgetConfiguration {
    AppIntentControlConfiguration(
      kind: EntryWidgetKind.runControl, intent: RunCommandControlConfiguration.self
    ) { configuration in
      ControlWidgetButton(action: RunControlIntent(commandID: configuration.command?.id ?? "")) {
        Label {
          if let command = configuration.command {
            Text(command.name)
          } else {
            Text(RunControlIntent.title)
          }
        } icon: {
          Image(systemName: configuration.command?.symbol ?? "wand.and.sparkles")
        }
      }
    }
    .displayName(RunControlIntent.title)
    .promptsForUserConfiguration()
  }
}
