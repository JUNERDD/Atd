/// The labels the capture overlay kept from the hint line its bottom bar replaced: the bar's key
/// labels (its other copy is ``CaptureBarStringKey``), the ask field's close and the
/// Accessibility request. Each one is a short label; the key to press is drawn as a keycap by
/// the overlay and is not translated.
public enum CaptureHintStringKey: String, CaseIterable, Sendable {
  case captureHintScreen = "capture.hint.screen"
  case captureHintCancel = "capture.hint.cancel"
  case captureHintRecall = "capture.hint.recall"
  case captureHintWindowsOnly = "capture.hint.windowsOnly"
  case captureHintElements = "capture.hint.elements"
  case captureHintAccessibility = "capture.hint.accessibility"
  case captureHintBack = "capture.hint.back"
}
