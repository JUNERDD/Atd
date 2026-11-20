import AppIntents
import AtdCameraUI
import AtdModel
import SwiftUI
import WidgetKit

/// 拍了就办 in Control Center, on the Lock Screen and on the Action button: Atd's camera in the
/// mode used last. While the iPhone is locked the system opens the capture extension instead of
/// the app. The control runs `CaptureIntent` (AtdCameraUI), which the app, the capture extension
/// and this extension all declare.
public struct CaptureControl: ControlWidget {
  public init() {}

  public var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "capture") {
      ControlWidgetButton(action: CaptureIntent(commandID: nil)) {
        Label {
          Text(CaptureIntent.title)
        } icon: {
          Image(systemName: "camera.viewfinder")
        }
      }
    }
    .displayName(CaptureIntent.title)
  }
}

/// 记一笔 as a control: the camera opens in 记一笔 to photograph a receipt. Locked, the capture
/// extension cannot know which control opened it and starts in the mode used last.
public struct ExpenseCaptureControl: ControlWidget {
  public init() {}

  public var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "captureExpense") {
      ControlWidgetButton(action: CaptureIntent(commandID: BuiltinCommands.expenseID)) {
        Label {
          Text(CaptureControlName.expense)
        } icon: {
          Image(systemName: "receipt")
        }
      }
    }
    .displayName(CaptureControlName.expense)
  }
}
