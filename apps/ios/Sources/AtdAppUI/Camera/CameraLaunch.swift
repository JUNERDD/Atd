/// The camera's work while the app launches (`AtdAppLaunch`).
enum CameraLaunch {
  /// Stub (F0a): nothing yet. WS-C: picks up photos the capture extension left
  /// (`LockedCameraCaptureManager`) and opens `.lockedCapture` for them.
  static func prepare() {}
}
