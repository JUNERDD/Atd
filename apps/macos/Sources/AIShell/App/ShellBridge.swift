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
    case .glowEffectsSet(let post): GlowEffects.shared.apply(post.enabled)
    case .resultMarkdownSet(let post): ResultMarkdown.shared.apply(post.enabled)
    case .panelBackgroundSet(let post): PanelBackground.shared.apply(post)
    case .screenshotPreferencesSet(let post): ScreenshotPreferences.shared.apply(post)
    case .typingSet(let post):
      shell?.summoner.writeTargets.animatesTyping = post.animation
      shell?.summoner.writeTargets.typesAnswers = post.typing
    case .windowDragRegions(let post): host.setDragRegions(post)
    case .onboardingSurface(let post): shell?.onboarding.setSurface(post, from: host)
    case .onboardingSelection(let post): shell?.setPracticeSelection(post, from: host)
    case .socketOpen(let post): host.pipe?.open(post)
    case .socketSend(let post): host.pipe?.send(post)
    case .socketClose(let post): host.pipe?.close(post)
    case .updateCheck: shell?.updater.checkForUpdates()
    case .updateInstall: shell?.updater.installNow()
    case .updateReleaseNotesShown(let post):
      guard host === shell?.panelHost else { return }
      shell?.releaseNotesShown(version: post.version)
    case .updateDismissReleaseNotes(let post): shell?.releaseNotes.dismiss(version: post.version)
    case .userAppPinDrag(let post): shell?.startPinDrag(post, from: host)
    // Only the panel's page decides which task the person is looking at.
    case .taskShown(let post):
      guard host === shell?.panelHost else { return }
      shell?.notifications?.taskShown(post.taskId)
      shell?.shownComputerTaskId = post.taskId
      shell?.taskActivity.readShownConversation()
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
      case .filesPick, .filesPickFolder, .filesSave, .diagnosticsExportBundle, .artifact,
        .shareText, .appsPick, .saveLocationPick:
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
      let results = await shell.applyShortcuts(
        params.registrations, selectionWanted: params.selectionWanted)
      return try Self.encode(ShortcutsSetResult(results: results))
    case .shortcutsRecording(let params):
      try shell.setShortcutRecording(params, from: host, document: document)
      return try Self.encode(NativeEmpty())
    case .capture:
      return try Self.encode(await shell.captureSelection())
    case .clipboardRead:
      let text = NSPasteboard.general.string(forType: .string) ?? ""
      return try Self.encode(ClipboardReadResult(text: text))
    case .screenshotCapture(let params):
      return try Self.encode(await Self.captureScreenshot(params, shell: shell))
    case .screenshotToolbarSet(let params):
      Self.setScreenshotToolbar(params, shell: shell)
      return try Self.encode(NativeEmpty())
    case .screenshotEdit(let params):
      return try Self.encode(await shell.editScreenshot(resourceId: params.resourceId))
    case .saveLocationState(let params):
      return try Self.encode(Self.saveLocationState(params, shell: shell))
    case .saveLocationSet(let params):
      return try Self.encode(Self.setSaveLocation(params, shell: shell))
    case .saveLocationPick(let params):
      return try Self.encode(await Self.pickSaveLocation(params, shell: shell))
    case .textWrite(let params):
      return try Self.encode(await shell.writeText(params))
    // The panel's write buttons follow the focus `text.writeOffer` reports only to the panel.
    case .textWriteFocused(let params):
      guard host === shell.panelHost else {
        throw BridgeError("Only the task panel can write where the focus is.")
      }
      return try Self.encode(await shell.writeFocused(params))
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
      guard await shell.deviceArbiter.copyToClipboard(params.text) else {
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
      guard NSWorkspace.shared.open(url) else {
        throw BridgeError("The link could not be opened.")
      }
      return try Self.encode(NativeEmpty())
    case .artifact(let params):
      return try Self.encode(
        await shell.artifacts.perform(artifactId: params.artifactId, operation: params.operation))
    case .filesPick:
      return try Self.encode(FilesPickResult(await shell.attachments.pick()))
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
    // The panel's page runs a recording's and a long screenshot's asks (`recording.ask`).
    case .recordingAnswer(let params):
      guard host === shell.panelHost else {
        throw BridgeError("Only the task panel can answer a recording's asks.")
      }
      switch params.source {
      case .recording: Self.answerRecording(params, shell: shell)
      case .screenshot: Self.answerLongScreenshot(params, shell: shell)
      }
      return try Self.encode(NativeEmpty())
    case .captureTextProgress(let params):
      try Self.progressCaptureText(params, from: host, shell: shell)
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
      return try await Self.handleComputer(.listApplications, from: host, shell: shell)
    case .computerApplicationIcon(let params):
      return try await Self.handleComputer(.applicationIcon(params), from: host, shell: shell)
    case .userAppWidgetPreview(let params):
      return try await Self.handleUserApp(.widgetPreview(params), from: host, shell: shell)
    case .userAppOpen(let params):
      return try await Self.handleUserApp(.open(params), from: host, shell: shell)
    case .userAppClose(let params):
      return try await Self.handleUserApp(.close(params), from: host, shell: shell)
    case .userAppClearData(let params):
      return try await Self.handleUserApp(.clearData(params), from: host, shell: shell)
    case .userAppPin(let params):
      return try await Self.handleUserApp(.pin(params), from: host, shell: shell)
    case .userAppUnpin(let params):
      return try await Self.handleUserApp(.unpin(params), from: host, shell: shell)
    case .viewOpen(let params):
      try shell.openView(params)
      return try Self.encode(NativeEmpty())
    case .notificationsState:
      return try await Self.notificationsState(shell: shell)
    case .notificationsSet(let params):
      return try await Self.setNotifications(params, shell: shell)
    case .notificationsOpenSystemSettings:
      return try Self.openNotificationSettings(shell: shell)
    case .computerPreviewShow(let params):
      return try await Self.handleComputer(
        .previewShow(params, document: document), from: host, shell: shell)
    case .computerPrepareBrowser(let params):
      return try await Self.handleComputer(.prepareBrowser(params), from: host, shell: shell)
    case .computerOpenProfile(let params):
      return try await Self.handleComputer(.openProfile(params), from: host, shell: shell)
    case .computerAuthorizeAutomation(let params):
      return try await Self.handleComputer(.authorizeAutomation(params), from: host, shell: shell)
    case .computerAcknowledgeUnsettled(let params):
      return try await Self.handleComputer(.acknowledgeUnsettled(params), from: host, shell: shell)
    case .computerSetTyping(let params):
      return try await Self.handleComputer(.setTyping(params), from: host, shell: shell)
    case .computerSetPointerVisible(let params):
      return try await Self.handleComputer(.setPointerVisible(params), from: host, shell: shell)
    case .computerPrepareApplication(let params):
      return try await Self.handleComputer(.prepareApplication(params), from: host, shell: shell)
    case .computerPrimeCaptureConsent:
      return try await Self.handleComputer(.primeCaptureConsent, from: host, shell: shell)
    case .panelModalSetAvailable(let params):
      guard host === shell.panelHost else {
        throw BridgeError("Only the task panel can set panel modals.")
      }
      shell.setPanelModalsAvailable(params.available)
      return try Self.encode(NativeEmpty())
    case .diagnosticsShellReport(let params):
      return try await Self.handleDiagnostics(.shellReport(params), from: host, shell: shell)
    case .diagnosticsLiveProbeStart(let params):
      return try await Self.handleDiagnostics(.liveProbeStart(params), from: host, shell: shell)
    case .diagnosticsLiveProbeStop(let params):
      return try await Self.handleDiagnostics(.liveProbeStop(params), from: host, shell: shell)
    case .diagnosticsPreviewBundle(let params):
      return try await Self.handleDiagnostics(.previewBundle(params), from: host, shell: shell)
    case .diagnosticsExportBundle(let params):
      return try await Self.handleDiagnostics(.exportBundle(params), from: host, shell: shell)
    case .diagnosticsRestartService(let params):
      return try await Self.handleDiagnostics(.restartService(params), from: host, shell: shell)
    }
  }

  static func encode(_ value: some Encodable) throws(BridgeError) -> JSONValue {
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
