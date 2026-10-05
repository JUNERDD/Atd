import AICore
import AppKit

/// The renderer's `userApp.*` calls and the shell's side of generated apps' windows.
extension ShellController {
  /// Connects the app windows to the shell's panels and pages. Runs from the initializer, after
  /// the panel's web view exists, which the data store removals retried here require.
  func wireUserApps() {
    userApps.bridge.systemPanels = systemPanels
    userApps.bridge.isBusy = { [weak self] in self?.isCapturingScreenshot ?? true }
    userApps.onState = { [weak self] appId, open, version in
      self?.broadcast(.userAppState(.init(appId: appId, open: open, version: version)))
    }
    userApps.storage.retryPendingRemovals()
  }

  /// `userApp.open`, or a widget tap with its route. Not while a capture runs: the window would
  /// order in above its overlays.
  func openUserApp(_ appId: String, route: String? = nil) async throws(BridgeError) {
    guard !isCapturingScreenshot else { throw BridgeError("Finish the screenshot first.") }
    try await userApps.open(appId: appId, route: route)
  }

  /// Undo and Redo for an app window: WebKit's own `undo:` and `redo:` through the responder
  /// chain, since an app page does not take the renderer's `edit.command`.
  func sendUserAppEditCommand(_ command: EditCommandEvent.Command) {
    guard userApps.keyHost != nil else { return }
    let action = command == .undo ? Selector(("undo:")) : Selector(("redo:"))
    NSApp.sendAction(action, to: nil, from: nil)
  }
}
