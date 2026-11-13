import AICore
import AIRelay
import AppKit

/// Optional integration owned by the toolbar. Other apps and uninstalled adapters do no I/O.
final class WpsSelectionAdapter {
  private let services: ShellServices
  private var installed = false
  private var lastWindow: (pid: pid_t, title: String)?

  init(services: ShellServices) { self.services = services }

  func apply(_ installs: AddonInstalls) {
    installed = installs.entry("wps-selection", "script") != nil
    if !installed { lastWindow = nil }
  }

  func evidence(app: NSRunningApplication, pressedAt: TimeInterval) async
    -> WpsSelectionEvidence?
  {
    guard installed, app.bundleIdentifier == "com.kingsoft.wpsoffice.mac" else { return nil }
    let link = services.link
    let state: WpsSelectionState? = await Deadline.value(within: .milliseconds(140), fallback: nil)
    {
      guard case .success(let endpoint) = await link.endpoint() else { return nil }
      return try? await ShellClient(endpoint: endpoint).wpsSelection(since: pressedAt)
    }
    let event = state?.event
    let now = Date().timeIntervalSince1970 * 1000
    let fresh =
      event.map {
        $0.occurredAt >= floor(pressedAt * 1000) && (0...2000).contains(now - $0.occurredAt)
      } ?? false
    guard installed, !Task.isCancelled else { return nil }
    let pid = app.processIdentifier
    if let event, !event.windowTitle.isEmpty { lastWindow = (pid, event.windowTitle) }
    guard let lastWindow, lastWindow.pid == pid else { return nil }
    return WpsSelectionEvidence(
      windowTitle: lastWindow.title,
      cells: state?.installed == true && state?.connected == true && state?.sampled == true && fresh
        && event?.kind == .cells && event?.hasContent == true)
  }
}

nonisolated struct WpsSelectionEvidence: Sendable {
  let windowTitle: String
  let cells: Bool
}
