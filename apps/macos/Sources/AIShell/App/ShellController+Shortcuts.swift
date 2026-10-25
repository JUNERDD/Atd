import AICore
import AppKit

extension ShellController {
  func applyShortcuts(_ registrations: [ShortcutRegistration], selectionWanted: Bool) async
    -> [ShortcutResult]
  {
    summoner.setSelectionWanted(selectionWanted)
    return await registrar?.apply(registrations) ?? []
  }

  func setShortcutRecording(
    _ params: ShortcutsRecordingParams, from host: WebViewHost, document: Int
  ) throws(BridgeError) {
    guard document == host.document else {
      throw BridgeError("The recording page has closed.")
    }
    let owner = ObjectIdentifier(host)
    if params.active {
      guard host.isPageReady, host.webView.window?.isKeyWindow == true, NSApp.isActive,
        let registrar
      else { throw BridgeError("Focus the recording window before recording a shortcut.") }
      registrar.startRecording(owner: owner, session: params.session)
    } else if registrar?.stopRecording(owner: owner, session: params.session) == true {
      panelHost.send(.shortcutsChanged(.init()))
    }
  }

  /// Host teardown and focus loss do not depend on the page delivering its final bridge call.
  func cancelShortcutRecording(from host: WebViewHost) {
    if registrar?.stopRecording(owner: ObjectIdentifier(host)) == true {
      panelHost.send(.shortcutsChanged(.init()))
    }
  }

  func cancelShortcutRecordings() {
    if registrar?.cancelRecordings() == true { panelHost.send(.shortcutsChanged(.init())) }
  }
}
