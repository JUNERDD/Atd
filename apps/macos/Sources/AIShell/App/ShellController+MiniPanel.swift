import AICore
import AppKit

/// The mini panel's side of the shell (``MiniPanelController``): its controls and drops reach the
/// existing summon, panel and import flows, it leaves the screen during capture sessions and
/// system open and save panels, and its shown and open-on settings reach every page as
/// `miniPanel.state`.
extension ShellController {
  /// Connects the mini panel to the shell. Runs from the initializer; the panel itself shows
  /// from ``start(revealPanel:)``.
  func wireMiniPanel() {
    miniPanel.actions = MiniPanelController.Actions(
      toggle: { [weak self] in self?.summon(.toggle) },
      newTask: { [weak self] in self?.startNewTask() },
      ask: { [weak self] in self?.summon(.ask) },
      screenshot: { [weak self] in self?.summon(.screenshot) },
      command: { [weak self] id in self?.summon(.command(id: id)) },
      openSettings: { [weak self] in self?.openSettings(commandId: nil, section: "general") },
      openItems: { [weak self] urls in self?.openItems(urls) },
      importImage: { [weak self] data in self?.importDroppedImage(data) },
      askAbout: { [weak self] text in self?.summon(.ask, selectedText: text) },
      showPanel: { [weak self] in self?.showPanel() },
      reportFailures: { [weak self] failures in self?.reportDropFailures(failures) },
      panelIsKey: { [weak self] in self?.panel.isKey ?? false },
      stateChanged: { [weak self] in
        guard let self else { return }
        broadcast(.miniPanelState(miniPanelState()))
      })
    replayMiniPanel(to: panelHost)
    screenshots.onCapturingChange = { [weak self] capturing in
      self?.miniPanel.setWithdrawn(capturing, for: .capture)
    }
    systemPanels.onChange = { [weak self] open in
      self?.miniPanel.setWithdrawn(open, for: .systemPanel)
    }
  }

  /// The settings for a page that became ready after they last changed.
  func replayMiniPanel(to host: WebViewHost) {
    host.setState(.miniPanelState(miniPanelState()))
  }

  private func miniPanelState() -> MiniPanelStateEvent {
    let openOn: MiniPanelStateEvent.OpenOn =
      switch miniPanel.openOn {
      case .hover: .hover
      case .click: .click
      }
    return MiniPanelStateEvent(shown: miniPanel.isShown, openOn: openOn)
  }

  /// `miniPanel.setShown`: the setting as applied.
  func setMiniPanelShown(_ shown: Bool) -> MiniPanelSetShownResult {
    miniPanel.setShown(shown)
    return MiniPanelSetShownResult(shown: miniPanel.isShown)
  }

  /// `miniPanel.setOpenOn`: the setting as applied.
  func setMiniPanelOpenOn(_ openOn: MiniPanelSetOpenOnParams.OpenOn) -> MiniPanelSetOpenOnResult {
    switch openOn {
    case .hover: miniPanel.setOpenOn(.hover)
    case .click: miniPanel.setOpenOn(.click)
    }
    let applied: MiniPanelSetOpenOnResult.OpenOn =
      switch miniPanel.openOn {
      case .hover: .hover
      case .click: .click
      }
    return MiniPanelSetOpenOnResult(openOn: applied)
  }

  /// The mini panel's New task: the panel shows where it is, then its page starts a new task.
  private func startNewTask() {
    showPanel()
    panelHost.send(.taskNew(.init()))
  }

  /// A dropped bitmap without a file goes in like a pasted image, with the panel shown.
  private func importDroppedImage(_ data: Data) {
    showPanel()
    Task { await attachments.importPastedImage(data) }
  }

  /// A drop that came to nothing shows the panel and reaches its page as an import's failures,
  /// as a pasted image that cannot be stored does.
  private func reportDropFailures(_ failures: [ResourcesImportedEvent.Failure]) {
    showPanel()
    panelHost.send(
      .resourcesImported(ResourcesImportedEvent(resources: [], folders: [], failures: failures)))
  }
}
