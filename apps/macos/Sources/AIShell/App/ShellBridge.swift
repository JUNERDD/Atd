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
          reply = .result(id: id, value: try await handle(call, from: host, document: document))
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
    case .appearanceSet(let post): AppAppearance.shared.apply(post.appearance)
    case .typingSet(let post):
      shell?.summoner.writeTargets.animatesTyping = post.animation
      shell?.summoner.writeTargets.typesAnswers = post.typing
    case .windowDragRegions(let post): host.setDragRegions(post.rects)
    case .onboardingSurface(let post): shell?.onboarding.setSurface(post, from: host)
    case .onboardingSelection(let post): shell?.setPracticeSelection(post, from: host)
    case .socketOpen(let post): host.pipe?.open(post)
    case .socketSend(let post): host.pipe?.send(post)
    case .socketClose(let post): host.pipe?.close(post)
    case .updateCheck: shell?.updater.checkForUpdates()
    case .updateInstall: shell?.updater.installNow()
    case .userAppPinDrag(let post): shell?.startPinDrag(post.appId, from: host)
    // Only the panel's page decides which task the person is looking at.
    case .taskShown(let post):
      guard host === shell?.panelHost else { return }
      shell?.notifications?.taskShown(post.taskId)
      shell?.shownComputerTaskId = post.taskId
    }
  }

  private func handle(_ call: NativeCall, from host: WebViewHost, document: Int)
    async throws(BridgeError)
    -> JSONValue
  {
    guard let shell else { throw BridgeError("The app is shutting down.") }
    // A dialog opened during a capture would run modal beneath the overlays and freeze them.
    if shell.isCapturingScreenshot {
      switch call {
      case .approvalRequest:
        return try Self.encode(ApprovalRequestResult.notApproved(.init(reason: .busy)))
      case .computerAuthorizeAutomation:
        return try Self.encode(ComputerAuthorizeAutomationResult.notApproved(.init(reason: .busy)))
      case .computerPrepareBrowser:
        return try Self.encode(ComputerPrepareBrowserResult.notOk(.init(reason: .busy)))
      case .computerPrepareApplication:
        return try Self.encode(ComputerPrepareApplicationResult.notOk(.init(reason: .busy)))
      case .computerPrimeCaptureConsent:
        return try Self.encode(ComputerPrimeCaptureConsentResult.unavailable(.init()))
      case .filesPick, .filesPickFolder, .filesSave, .artifact, .shareText, .appsPick:
        throw BridgeError("Finish the screenshot first.")
      default:
        break
      }
    }
    switch call {
    case .appStartup(let params):
      guard host === shell.panelHost else {
        throw BridgeError("Only the task panel can resolve the launch window.")
      }
      return try Self.encode(shell.presentLaunch(params.state))
    case .windowShow:
      shell.showPanel()
      return try Self.encode(NativeEmpty())
    case .windowHide:
      shell.hidePanel()
      return try Self.encode(NativeEmpty())
    case .windowSetPinned(let params):
      shell.setPinned(params.pinned)
      return try Self.encode(WindowSetPinnedResult(pinned: params.pinned))
    case .windowSetPlacement(let params):
      return try Self.encode(shell.setPanelPlacement(params.placement))
    case .appState:
      return try Self.encode(shell.appState())
    case .appAbout:
      return try Self.encode(shell.updater.about())
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
    case .miniPanelSetShown(let params):
      return try Self.encode(shell.setMiniPanelShown(params.shown))
    case .miniPanelSetOpenOn(let params):
      return try Self.encode(shell.setMiniPanelOpenOn(params.openOn))
    case .miniPanelSetCommands(let params):
      shell.miniPanel.setCommands(params.commands)
      return try Self.encode(NativeEmpty())
    case .settingsOpen(let params):
      shell.openSettings(commandId: params.commandId, section: params.section)
      return try Self.encode(NativeEmpty())
    case .settingsClose:
      shell.closeSettings()
      return try Self.encode(NativeEmpty())
    case .onboardingOpen:
      shell.openOnboarding()
      return try Self.encode(NativeEmpty())
    case .onboardingSettle:
      shell.settleOnboarding()
      return try Self.encode(NativeEmpty())
    case .onboardingClose(let params):
      shell.closeOnboarding(summon: params.summon)
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
    case .textWrite(let params):
      return try Self.encode(await shell.writeText(params))
    case .commandProgressShow(let params):
      guard host === shell.panelHost else {
        throw BridgeError("Only the task panel can show command progress.")
      }
      try shell.commandProgress.show(params)
      return try Self.encode(NativeEmpty())
    case .commandProgressHide(let params):
      guard host === shell.panelHost else {
        throw BridgeError("Only the task panel can hide command progress.")
      }
      shell.commandProgress.hide(target: params.target)
      return try Self.encode(NativeEmpty())
    case .clipboardWrite(let params):
      guard shell.deviceArbiter.writeClipboard(params.text) else {
        throw BridgeError("The clipboard is in use; try again.")
      }
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
    case .commandOptionsSet(let params):
      shell.applyCommandOptions(CommandOptionsCatalog(params))
      return try Self.encode(NativeEmpty())
    case .accessibilityRequest:
      shell.trust.openSystemSettings()
      return try Self.encode(NativeEmpty())
    case .screenRecordingRequest:
      shell.screenRecording.openSystemSettings()
      return try Self.encode(NativeEmpty())
    case .appsPick:
      return try Self.encode(await ExcludedAppPicker.pick(with: shell.systemPanels))
    case .computerListApplications:
      return try Self.encode(await InstalledApplications.list())
    case .computerApplicationIcon(let params):
      return try Self.encode(
        ComputerApplicationIconResult(
          pngBase64: InstalledApplicationIcon.png(bundleId: params.bundleId)?.base64EncodedString())
      )
    case .userAppWidgetPreview(let params):
      return try Self.encode(
        UserAppWidgetPreviewResult(pngBase64: try shell.widgets.preview(params)))
    case .userAppOpen(let params):
      try await shell.openUserApp(params.appId)
      return try Self.encode(NativeEmpty())
    case .userAppClose(let params):
      shell.userApps.close(appId: params.appId)
      return try Self.encode(NativeEmpty())
    case .userAppClearData(let params):
      // A deleted app's pin goes first, whatever becomes of its web storage.
      if params.forget { shell.pins.forget(appId: params.appId) }
      try await shell.userApps.clearData(appId: params.appId, forget: params.forget)
      return try Self.encode(NativeEmpty())
    case .userAppPin(let params):
      try await shell.pinUserApp(params, from: host)
      return try Self.encode(NativeEmpty())
    case .userAppUnpin(let params):
      shell.pins.unpin(appId: params.appId)
      return try Self.encode(NativeEmpty())
    case .viewOpen(let params):
      try shell.openView(params)
      return try Self.encode(NativeEmpty())
    case .notificationsState:
      return try Self.encode(await Self.notifications(of: shell).state())
    case .notificationsSet(let params):
      return try Self.encode(await Self.notifications(of: shell).apply(params))
    case .notificationsOpenSystemSettings:
      try Self.notifications(of: shell).openSystemSettings()
      return try Self.encode(NativeEmpty())
    case .computerPreviewShow(let params):
      return try Self.encode(shell.showComputerPreview(params, from: host, document: document))
    case .computerPrepareBrowser(let params):
      return try Self.encode(await shell.prepareComputerBrowser(params))
    case .computerOpenProfile(let params):
      try await shell.openComputerProfile(bindingId: params.bindingId)
      return try Self.encode(NativeEmpty())
    case .computerAuthorizeAutomation(let params):
      return try Self.encode(await shell.authorizeComputerAutomation(params))
    case .computerAcknowledgeUnsettled(let params):
      shell.acknowledgeComputerUnsettled(params)
      return try Self.encode(NativeEmpty())
    case .computerSetTyping(let params):
      shell.computer.typing.set(params)
      shell.computer.onStateChange?()
      return try Self.encode(NativeEmpty())
    case .computerSetPointerVisible(let params):
      shell.computer.setPointerVisible(params.visible)
      return try Self.encode(NativeEmpty())
    case .computerPrepareApplication(let params):
      return try Self.encode(await shell.prepareComputerApplication(params))
    case .computerPrimeCaptureConsent:
      return try Self.encode(await shell.primeComputerCaptureConsent())
    }
  }

  private static func encode(_ value: some Encodable) throws(BridgeError) -> JSONValue {
    do {
      return try JSONValue(encoding: value)
    } catch {
      throw BridgeError("The reply could not be encoded.")
    }
  }

  /// Notifications exist only in an app bundle.
  private static func notifications(of shell: ShellController) throws(BridgeError)
    -> ShellNotifications
  {
    guard let notifications = shell.notifications else {
      throw BridgeError("Notifications are unavailable outside the app.")
    }
    return notifications
  }

  static func message(_ error: any Error, _ fallback: String) -> String {
    (error as? LocalizedError)?.errorDescription ?? fallback
  }
}
