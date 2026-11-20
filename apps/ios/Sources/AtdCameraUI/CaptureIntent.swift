import AppIntents
import AtdModel

/// 拍了就办 from a control (Control Center, the Lock Screen, the Action button) or the Camera
/// Control: with the iPhone locked the system opens the capture extension (`Capture/`), unlocked
/// it opens the app, which shows the camera.
///
/// Apple requires the app, the capture extension and the widget extension (the control) to all
/// declare it; they all link this module, which is what puts it in each bundle's App Intents
/// metadata. Its title is in the `CameraIntents` table, compiled into all three bundles.
///
/// Conforming to `AppIntent`, which is `Sendable`, makes the type nonisolated even in this
/// main-actor module, so `perform()` says it runs on the main actor. Marking the type `nonisolated`
/// would also reach its `@Parameter` properties, which cannot be.
///
/// Stub (F0a): WS-C adds the `AppContext` the app hands the extension and the real hand-off.
public struct CaptureIntent: CameraCaptureIntent {
  public static let title = LocalizedStringResource("capture.title", table: "CameraIntents")

  public init() {}

  @MainActor
  public func perform() async throws -> some IntentResult {
    RouteCenter.shared.open(.camera(commandID: nil))
    return .result()
  }
}

/// This module's App Intents, listed by the app's, the capture extension's and the widget
/// extension's own packages.
nonisolated public struct AtdCameraUIPackage: AppIntentsPackage {}
