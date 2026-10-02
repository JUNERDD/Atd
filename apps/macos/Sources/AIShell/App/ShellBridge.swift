import AICore
import AppKit

/// A call the shell refused or could not complete; the page's call rejects with the message.
struct BridgeError: Error, Equatable {
  let message: String
  init(_ message: String) { self.message = message }
}

/// The one dispatcher of the bridge contract (`contract.ts`): every message a page posts comes
/// here already decoded and checked (``JsMessage``). Posts act at once; a call's answer leaves
/// through the posting page's outbox as a document-scoped `result` or `error`, in order with
/// everything else the shell delivers.
final class ShellBridge {
  weak var shell: ShellController?

  func receive(_ message: JsMessage, from host: WebViewHost) {
    switch message {
    case .post(let post):
      receive(post, from: host)
    case .call(let id, let call):
      let document = host.document
      Task {
        let reply: SwiftMessage
        do throws(BridgeError) {
          reply = .result(id: id, value: try await handle(call, from: host))
        } catch {
          reply = .error(id: id, message: String(error.message.prefix(2000)))
        }
        host.reply(reply, document: document)
      }
    }
  }

  private func receive(_ post: NativePost, from host: WebViewHost) {
    switch post {
    case .bridgeReady: host.pageDidBecomeReady()
    case .languageSet(let post): ShellStrings.shared.apply(appLanguage: post.language.rawValue)
    case .windowDragRegions(let post): host.setDragRegions(post.rects)
    case .socketOpen(let post): host.pipe?.open(post)
    case .socketSend(let post): host.pipe?.send(post)
    case .socketClose(let post): host.pipe?.close(post)
    case .updateInstall: shell?.updater.installNow()
    }
  }

  private func handle(_ call: NativeCall, from host: WebViewHost) async throws(BridgeError)
    -> JSONValue
  {
    guard let shell else { throw BridgeError("The app is shutting down.") }
    // A dialog opened during a capture would run modal beneath the overlays and freeze them.
    if shell.isCapturingScreenshot {
      switch call {
      case .approvalRequest:
        return try Self.encode(ApprovalRequestResult.notApproved(.init(reason: .busy)))
      case .filesPick, .filesPickFolder, .filesSave, .artifact, .shareText, .appsPick:
        throw BridgeError("Finish the screenshot first.")
      default:
        break
      }
    }
    switch call {
    case .windowShow:
      shell.showPanel()
      return try Self.encode(NativeEmpty())
    case .windowHide:
      shell.hidePanel()
      return try Self.encode(NativeEmpty())
    case .windowSetPinned(let params):
      shell.setPinned(params.pinned)
      return try Self.encode(WindowSetPinnedResult(pinned: params.pinned))
    case .appState:
      return try Self.encode(shell.appState())
    case .appSetShowInDock(let params):
      shell.setShowInDock(params.show)
      return try Self.encode(AppSetShowInDockResult(show: params.show))
    case .appSetOpenAtLogin(let params):
      do {
        let applied = try AppPresence.setOpensAtLogin(params.open)
        return try Self.encode(AppSetOpenAtLoginResult(open: applied))
      } catch let error as BridgeError {
        throw error
      } catch {
        throw BridgeError(Self.message(error, "The login item could not change."))
      }
    case .settingsOpen(let params):
      shell.openSettings(commandId: params.commandId)
      return try Self.encode(NativeEmpty())
    case .settingsClose:
      shell.closeSettings()
      return try Self.encode(NativeEmpty())
    case .shortcutsSet(let params):
      let results = shell.applyShortcuts(
        params.registrations, selectionWanted: params.selectionWanted)
      return try Self.encode(ShortcutsSetResult(results: results))
    case .capture:
      return try Self.encode(shell.captureSelection())
    case .clipboardRead:
      let text = NSPasteboard.general.string(forType: .string) ?? ""
      return try Self.encode(ClipboardReadResult(text: text))
    case .screenshotCapture:
      return try Self.encode(await shell.captureScreenshot())
    case .screenshotEdit(let params):
      return try Self.encode(await shell.editScreenshot(resourceId: params.resourceId))
    case .clipboardWrite(let params):
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(params.text, forType: .string)
      return try Self.encode(NativeEmpty())
    case .shareText(let params):
      try ShareSheet.show(text: params.text, anchor: params.anchor, in: host.webView)
      return try Self.encode(NativeEmpty())
    case .speechSpeak(let params):
      guard !params.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        throw BridgeError("There is nothing to read aloud.")
      }
      shell.speech.speak(params.text)
      return try Self.encode(NativeEmpty())
    case .speechStop:
      shell.speech.stop()
      return try Self.encode(NativeEmpty())
    case .linkOpen(let params):
      guard let url = ExternalLink.openable(params.url) else {
        throw BridgeError("Only web links can be opened.")
      }
      NSWorkspace.shared.open(url)
      return try Self.encode(NativeEmpty())
    case .artifact(let params):
      return try Self.encode(
        await shell.artifacts.perform(artifactId: params.artifactId, operation: params.operation))
    case .filesPick:
      return try Self.encode(FilesPickResult(resources: await shell.attachments.pick()))
    case .filesPickFolder:
      return try Self.encode(await shell.attachments.pickFolders())
    case .filesSave(let params):
      let saved = try await shell.attachments.save(params)
      return try Self.encode(FilesSaveResult(saved: saved))
    case .approvalRequest(let params):
      return try Self.encode(await shell.launchApprovals.request(serverId: params.serverId))
    case .toolbarSet(let params):
      shell.applyToolbar(SelectionToolbarSettings(params))
      return try Self.encode(NativeEmpty())
    case .accessibilityRequest:
      shell.trust.openSystemSettings()
      return try Self.encode(NativeEmpty())
    case .appsPick:
      return try Self.encode(await ExcludedAppPicker.pick(with: shell.systemPanels))
    }
  }

  private static func encode(_ value: some Encodable) throws(BridgeError) -> JSONValue {
    do {
      return try JSONValue(encoding: value)
    } catch {
      throw BridgeError("The reply could not be encoded.")
    }
  }

  static func message(_ error: any Error, _ fallback: String) -> String {
    (error as? LocalizedError)?.errorDescription ?? fallback
  }
}
