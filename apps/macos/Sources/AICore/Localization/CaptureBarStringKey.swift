/// The capture session's bottom bar keys (architecture C2), kept with their independently owned
/// surface. The keys to press are drawn as keycaps and are not translated; the shared keys
/// (⌘A, R, Esc, the Accessibility request) keep their `capture.hint.*` copy.
public enum CaptureBarStringKey: String, CaseIterable, Sendable {
  /// The bar's VoiceOver name.
  case captureBarLabel = "capture.bar.label"
  /// The mode pair's VoiceOver name.
  case captureBarModes = "capture.bar.modes"
  case captureBarScreenshot = "capture.bar.screenshot"
  case captureBarRecord = "capture.bar.record"
  /// Idle in either mode: elements are available and enabled.
  case captureBarPickElement = "capture.bar.pickElement"
  /// Idle in either mode: targeting is limited to windows, by capability or user choice.
  case captureBarPickWindow = "capture.bar.pickWindow"
  /// After the Return keycap with a screenshot selection.
  case captureBarFinishScreenshot = "capture.bar.finishScreenshot"
  /// After the registered screenshot shortcut keycap with a screenshot selection.
  case captureBarCopyScreenshot = "capture.bar.copyScreenshot"
  /// After the Return keycap with a record selection.
  case captureBarStartRecording = "capture.bar.startRecording"
}
