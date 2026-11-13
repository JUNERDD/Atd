import AICore
import AppKit
import UniformTypeIdentifiers

/// App-modal save panel presented above the capture overlays (``ToolbarWindow/aboveCapture``)
/// when saving a screenshot with no configured save folder ("Ask each time").
final class CaptureSavePanel: NSObject {
  private var panel: NSSavePanel?

  /// Runs the save panel; returns the chosen file URL, or `nil` when cancelled.
  func choose(suggestedName: String, contentType: UTType) -> URL? {
    let panel = NSSavePanel()
    panel.title = ShellStrings.shared.text(.fileSaveTitle)
    panel.allowedContentTypes = [contentType]
    panel.canCreateDirectories = true
    panel.isExtensionHidden = false
    panel.nameFieldStringValue = suggestedName
    panel.level = ToolbarWindow.aboveCapture
    self.panel = panel
    let center = NotificationCenter.default
    center.addObserver(
      self, selector: #selector(raise(_:)), name: NSWindow.didBecomeKeyNotification,
      object: panel)
    defer {
      center.removeObserver(self, name: NSWindow.didBecomeKeyNotification, object: panel)
      self.panel = nil
    }
    return panel.runModal() == .OK ? panel.url : nil
  }

  /// Cancels an active modal save panel when the capture session ends.
  func cancel() {
    panel?.cancel(nil)
  }

  @objc private func raise(_ notification: Notification) {
    (notification.object as? NSWindow)?.level = ToolbarWindow.aboveCapture
  }
}
