import AppIntents
import AtdCameraUI
import SwiftUI
import WidgetKit

/// 拍了就办 in Control Center, on the Lock Screen and on the Action button: Atd's camera, which
/// the system opens as the capture extension while the iPhone is locked.
///
/// Stub (F0a): the control runs `CaptureIntent` (AtdCameraUI), which the app, the capture
/// extension and this extension all declare. WS-C replaces it.
public struct CaptureControl: ControlWidget {
  public init() {}

  public var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "capture") {
      ControlWidgetButton(action: CaptureIntent()) {
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
