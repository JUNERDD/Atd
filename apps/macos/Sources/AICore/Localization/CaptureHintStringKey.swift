/// The capture overlay's hint line keys, kept with their independently owned surface. Each one
/// is a short label; the key to press is drawn as a keycap by the overlay and is not translated.
public enum CaptureHintStringKey: String, CaseIterable, Sendable {
  case captureHintPick = "capture.hint.pick"
  case captureHintScroll = "capture.hint.scroll"
  case captureHintScreen = "capture.hint.screen"
  case captureHintCancel = "capture.hint.cancel"
  case captureHintRecall = "capture.hint.recall"
  case captureHintWindowsOnly = "capture.hint.windowsOnly"
  case captureHintElements = "capture.hint.elements"
  case captureHintAccessibility = "capture.hint.accessibility"
  case captureHintResize = "capture.hint.resize"
  case captureHintConfirm = "capture.hint.confirm"
  case captureHintBack = "capture.hint.back"
  case captureHintAllDisplays = "capture.hint.allDisplays"
}
