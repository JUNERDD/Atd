import AICore
import AppKit

extension ShellController {
  /// Update progress and installed-release notes are independent replayable states. Progress
  /// goes first so a reloaded page applies its higher priority before showing any notes.
  func wireUpdates() {
    updater.onChange = { [weak self] in
      guard let self else { return }
      panelHost.setState(.updateState(updater.state))
    }
    releaseNotes.onChange = { [weak self] in self?.publishReleaseNotes() }
    panelHost.setState(.updateState(updater.state))
    publishReleaseNotes()
    // The panel's show/hide callback does not cover the yellow window control or Dock restore.
    // Observe those transitions without changing the panel's activation or focus behavior.
    for name in [NSWindow.didMiniaturizeNotification, NSWindow.didDeminiaturizeNotification] {
      NotificationCenter.default.addObserver(forName: name, object: panel.panel, queue: .main) {
        [weak self] _ in
        MainActor.assumeIsolated {
          guard let self else { return }
          let visible = self.panel.isVisible
          self.releaseNotes.panelVisibilityChanged(visible)
          self.panelHost.setState(.windowVisibility(.init(visible: visible)))
        }
      }
    }
  }

  func releaseNotesShown(version: String) {
    guard panel.isVisible, panelHost.isPageReady, case .idle = updater.state else { return }
    releaseNotes.shown(version: version)
  }

  private func publishReleaseNotes() {
    panelHost.setState(.updateReleaseNotes(releaseNotes.state))
  }
}
