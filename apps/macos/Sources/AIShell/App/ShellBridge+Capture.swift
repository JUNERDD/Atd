import AICore

/// The bridge's capture and recording routes beyond the plain screenshot (architecture B1, B2,
/// B4, P2-8): `screenshot.capture` with its params, `screenshotToolbar.set` and
/// `recording.answer`, and how a capture's outcome reads to the page.
extension ShellBridge {
  /// Every `screenshot.capture` chooses its purpose. General capture entries get the full
  /// toolbar; a command's image input cannot start a different command or a recording.
  static func captureScreenshot(_ params: ScreenshotCaptureParams, shell: ShellController)
    async throws(BridgeError) -> ScreenshotCaptureResult
  {
    switch params {
    case .image:
      return try await shell.captureScreenshotInput()
    case .capture(let capture):
      let mode: CaptureMode = capture.mode == .record ? .record : .screenshot
      return ScreenshotCaptureResult(try await shell.captureScreenshot(.capture(mode)))
    }
  }

  /// `screenshotToolbar.set`: the commands the capture's command row offers, and those its text
  /// commands offer on picked text, each in order; read when the next capture with the row starts
  /// (the text commands also when a long screenshot's full-screen preview shows them).
  static func setScreenshotToolbar(_ params: ScreenshotToolbarSetParams, shell: ShellController) {
    shell.screenshots.toolbarCommands = params.commands.map {
      SelectionToolbarSettings.Command(id: $0.id, name: $0.name)
    }
    shell.screenshots.textCommands = params.textCommands.map {
      SelectionToolbarSettings.Command(id: $0.id, name: $0.name)
    }
  }

  /// `recording.answer`: the answer of a recording's ask as it grows, for its result card.
  static func answerRecording(_ params: RecordingAnswerParams, shell: ShellController) {
    let phase: RecordingAnswer.Phase =
      switch params.state {
      case .thinking: .thinking
      case .streaming: .streaming
      case .done: .done
      case .stopped: .stopped
      case .failed: .failed
      }
    shell.installScreenRecording().updateAnswer(
      askID: params.askId, phase: phase, text: params.text)
  }
}

extension ScreenshotCaptureResult {
  /// `outcome` as the page reads it: an attachment with the launch the command row chose and the
  /// field it may write to, or why there is none (`recording`, `longScreenshot`: the selection
  /// went to a recording or to the long screenshot's result card, and the page adds nothing).
  init(_ outcome: ScreenshotOutcome) {
    switch outcome {
    case .attached(let shot):
      self = .ok(
        Ok(
          file: shot.file, context: shot.context, capturedAt: shot.capturedAt,
          launch: shot.launch.map { Ok.Launch($0, selection: shot.selection) },
          target: shot.target.map(Ok.Target.init)))
    case .cancelled: self = .notOk(.init(reason: .cancelled))
    case .notPermitted: self = .notOk(.init(reason: .notPermitted))
    case .recording: self = .notOk(.init(reason: .recording))
    case .longScreenshot: self = .notOk(.init(reason: .longScreenshot))
    }
  }
}

extension ScreenshotCaptureResult.Ok.Launch {
  /// A plain run leaves the intent out, as a command shortcut's event does
  /// (``CommandLaunch/event(target:)``). `selection` is the text the screenshot's text mode
  /// offered when the capture ended (``ScreenshotAttachment/selection``: paragraphs in reading
  /// order, blank lines apart, nothing a mosaic touches); nil with text mode off.
  init(_ launch: CaptureLaunch, selection: String? = nil) {
    switch launch {
    case .command(let command):
      let intent: Command.Intent? =
        switch command.intent {
        case .run: nil
        case .choose: .choose
        case .edit: .edit
        }
      self = .command(
        Command(
          id: command.id, arguments: command.arguments, intent: intent, selection: selection))
    case .ask(let question):
      self = .ask(Ask(question: question, selection: selection))
    }
  }
}

extension ScreenshotCaptureResult.Ok.Target {
  /// The same field as the shortcut event's target, which is a type of its own in the contract.
  init(_ target: ShortcutCommandEvent.Target) {
    let kind: SelectionKind? =
      switch target.selectionKind {
      case .text: .text
      case .cells: .cells
      case .unknown: .unknown
      case nil: nil
      }
    self.init(id: target.id, app: target.app, writable: target.writable, selectionKind: kind)
  }
}
