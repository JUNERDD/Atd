import AICore
import AppKit

extension PointerMark.Appearance {
  /// How `frame`'s mark looks, in the current language and accessibility settings. A step that
  /// ended unverified keeps the neutral look of the input it sent (`feedback`), which claims no
  /// success. `badge` is nil while only one task has marks.
  init(frame: PointerFrame, feedback: PointerFrame? = nil, badge: String?) {
    let held = frame.phase == .done && !frame.verified ? feedback : nil
    let shown = held ?? frame
    let key = held == nil ? PointerStyle.label(shown.phase, action: shown.action) : .pointerSent
    let label = key.map { ShellStrings.shared.text($0) } ?? ""
    self.init(
      phase: shown.phase, action: shown.action, label: label, badge: badge,
      reduceMotion: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
      increaseContrast: NSWorkspace.shared.accessibilityDisplayShouldIncreaseContrast)
  }
}
