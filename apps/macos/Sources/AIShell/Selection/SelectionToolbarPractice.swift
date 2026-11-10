import AICore
import AppKit

/// The welcome guide owns its text selection; no global monitor or AX read can observe it.
/// Its page shows and hides the toolbar as the selection changes, with no dismissal monitor.
/// The controller retains the activation gate and hands this text to Ask Atd, which quotes it into a draft and sends
/// nothing. Practice commands only dismiss the toolbar, so the guide never spends tokens.
final class SelectionToolbarPractice {
  private(set) var text: String?

  func show(selection: CGRect, text: String, panel: SelectionToolbarPanel) {
    self.text = text
    let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
    // Use the pointer when it ended this selection, otherwise the selection's middle.
    let line = SelectionToolbarPlacement.pointerLineHalfHeight * 2
    let mouse = NSEvent.mouseLocation
    let pointer =
      selection.insetBy(dx: -line, dy: -line).contains(mouse)
      ? mouse : CGPoint(x: selection.midX, y: selection.midY)
    panel.show(
      selection: CaptureCoordinates.flip(selection, primaryHeight: primaryHeight), pointer: pointer)
  }

  func clear() {
    text = nil
  }
}
