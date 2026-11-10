import AICore
import AppKit

/// "Other…" in the Save Location menu (architecture R4): the system folder panel, for folders
/// only, which can make a new one, opened at the current save folder's parent with that folder
/// selected; with nothing selected, Choose takes the folder being browsed.
///
/// It runs app-modal, so the capture's selection and keys behind it wait and Escape closes only
/// the panel, and above the capture overlays (``ToolbarWindow/aboveCapture``), raised again
/// whenever it becomes key in case running it modally reset its level. It does not go through
/// ``SystemPanels``: the capture session already holds the interactive screen, which that path
/// would claim a second time and be refused.
final class RecordFolderPicker: NSObject {
  private var panel: NSOpenPanel?

  /// Runs the panel; the chosen folder's path, nil when cancelled.
  func choose(current: String) -> String? {
    let panel = NSOpenPanel()
    panel.message = RecordOptionsCopy.text(.folderMessage)
    panel.prompt = RecordOptionsCopy.text(.folderPrompt)
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    panel.canCreateDirectories = true
    panel.allowsMultipleSelection = false
    // The folder's own URL, not marked as a directory: the panel then opens on its parent with
    // it selected rather than inside it.
    panel.directoryURL = URL(filePath: current, directoryHint: .notDirectory)
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
    guard panel.runModal() == .OK, let url = panel.url else { return nil }
    return url.path(percentEncoded: false)
  }

  /// Ends a running panel as if cancelled (the bar went away).
  func cancel() {
    panel?.cancel(nil)
  }

  @objc private func raise(_ notification: Notification) {
    (notification.object as? NSWindow)?.level = ToolbarWindow.aboveCapture
  }
}
