import AICore
import AppKit
import Carbon.HIToolbox

/// The shell's own attaching for the compose card, wired by the shell controller where the
/// progress controller is made, so the card attaches exactly as the page's calls do.
struct ComposeAttachments {
  /// The capture `screenshot.capture` runs, under its conditions.
  let screenshot: () async throws(BridgeError) -> ScreenshotCaptureResult
  /// The chooser and import `files.pick` runs: the chosen files as resources, none when
  /// cancelled.
  let pickFiles: () async throws(BridgeError) -> [FileRef]
  /// Opens Privacy & Security › Screen & System Audio Recording, as the welcome guide does.
  let openScreenRecordingSettings: () -> Void
}

/// The compose card's keys, field and attachments, while the island is in its `compose` phase
/// (contract: `commandProgress.show`'s compose card). The island's window reads every key press
/// before the field does: Return runs (and beeps while there is nothing to run with),
/// Shift-Return and Option-Return start a new line, Escape cancels; every other key types into
/// the field. While the field has marked text every key belongs to the input method, so Return
/// and Escape confirm or end a composition instead. ⌘V, ⌘X, ⌘C, ⌘A, ⌘Z and ⇧⌘Z edit the field
/// as key equivalents ahead of the menus, since the card's window has them while another app
/// keeps the menu bar.
///
/// Attaching hands the keyboard to a capture session or the open panel and back: meanwhile the
/// card stays up without the keyboard, as it does whenever its window gives it up, and runs
/// nothing (``attaching``); afterwards the
/// app the person was in gets activation back before the card takes the keyboard again, so
/// closing the card can still return the keyboard to the target's field.
extension CommandProgressController {
  func wireComposeCard() {
    island.model.composeEvent = { [weak self] event in self?.composeEvent(event) }
  }

  /// True when the compose card took the key press `event`.
  func composeKey(_ event: NSEvent) -> Bool {
    guard state.isComposing, event.type == .keyDown else { return false }
    let field = island.editingField
    if field?.hasMarkedText() == true { return false }
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    switch Int(event.keyCode) {
    case kVK_Escape:
      press(.cancel)
      return true
    case kVK_Return, kVK_ANSI_KeypadEnter:
      if modifiers.isEmpty {
        submitCompose(.run)
        return true
      }
      guard modifiers == .shift || modifiers == .option, let field else { return false }
      field.insertNewlineIgnoringFieldEditor(nil)
      return true
    default:
      return false
    }
  }

  /// True when the compose card took the key equivalent `event`: the field's editing commands,
  /// found by character so they work on any keyboard layout.
  func composeKeyEquivalent(_ event: NSEvent) -> Bool {
    guard state.isComposing, event.type == .keyDown, let field = island.editingField,
      !field.hasMarkedText(), let key = event.charactersIgnoringModifiers?.lowercased()
    else { return false }
    let modifiers = event.modifierFlags.intersection([.command, .control, .option, .shift])
    switch (modifiers, key) {
    case (.command, "v"): field.paste(nil)
    case (.command, "x"): field.cut(nil)
    case (.command, "c"): field.copy(nil)
    case (.command, "a"): field.selectAll(nil)
    case (.command, "z"): field.undoManager?.undo()
    case ([.command, .shift], "z"): field.undoManager?.redo()
    default: return false
    }
    return true
  }

  private func composeEvent(_ event: IslandComposeEvent) {
    guard state.isComposing else { return }
    switch event {
    case .text(let text):
      guard island.model.compose.text != text else { return }
      island.model.compose.text = text
      remeasureCompose()
    case .remove(let index):
      island.model.compose.remove(at: index)
      remeasureCompose()
    case .attach(let frame): showAttachMenu(against: frame)
    case .openScreenRecordingSettings: attachments.openScreenRecordingSettings()
    case .run: submitCompose(.run)
    case .open: submitCompose(.open)
    }
  }

  /// Run or Open with what the card holds, once there is text or a file to go with; without
  /// either, the press only beeps.
  private func submitCompose(_ action: CommandProgressActionEvent.Action) {
    let draft = island.model.compose
    guard !attaching else { return }
    guard draft.canRun else { return NSSound.beep() }
    press(action, compose: draft.input)
  }

  /// The card changes in place, its shape following the field's lines, the chips and the note.
  private func remeasureCompose() {
    guard let shown = state.shown else { return }
    island.show(content(shown.phase))
  }

  // MARK: Attaching

  private enum AttachSource {
    case screenshot, files
  }

  /// What an attachment brought: files to add, a note in their place, or nothing (cancelled).
  private enum Attached {
    case files([FileRef])
    case note(ComposeDraft.Note)
    case nothing
  }

  /// The attach control's menu, the panel composer's items with its icons (Take Screenshot,
  /// then Choose Files…), opening above the control at its leading edge so it never covers it,
  /// whether the pointer, the keyboard or VoiceOver pressed it. `frame` is the control's frame in
  /// the window's content, y down.
  private func showAttachMenu(against frame: CGRect) {
    guard !attaching, let view = island.window.contentView else { return }
    let strings = ShellStrings.shared
    let menu = NSMenu()
    let screenshot = ActionMenuItem(strings.text(.commandComposeScreenshot)) { [weak self] in
      self?.attach(.screenshot)
    }
    screenshot.image = IslandIcons.menuImage(IslandIcons.screenshot)
    let files = ActionMenuItem(strings.text(.commandComposeChooseFiles)) { [weak self] in
      self?.attach(.files)
    }
    files.image = IslandIcons.menuImage(IslandIcons.files)
    menu.items = [screenshot, files]
    // The menu's top-left corner, 4 pt above the control.
    let top = frame.minY - 4 - menu.size.height
    menu.popUp(
      positioning: nil,
      at: NSPoint(x: frame.minX, y: view.isFlipped ? top : view.bounds.height - top), in: view)
  }

  /// Takes a screenshot or picks files for the card shown for its target now, then gives the
  /// card the keyboard back. A card that went meanwhile (the page replaced or hid it) gets
  /// nothing; its files stay imported, unused, as a cancelled composer's would.
  private func attach(_ source: AttachSource) {
    guard state.isComposing, let target = state.shown?.target, !attaching else { return }
    attaching = true
    let previous = NSWorkspace.shared.frontmostApplication.flatMap {
      $0 == NSRunningApplication.current ? nil : $0
    }
    Task {
      let attached = await gather(source)
      await Self.handBackActivation(to: previous)
      attaching = false
      guard state.isComposing, state.shown?.target == target else { return }
      switch attached {
      case .files(let files): island.model.compose.attach(files)
      case .note(let note): island.model.compose.note = note
      case .nothing: break
      }
      announceNote()
      island.setKeyCapable(true)
      remeasureCompose()
    }
  }

  private func gather(_ source: AttachSource) async -> Attached {
    do {
      switch source {
      case .screenshot:
        switch try await attachments.screenshot() {
        case .ok(let shot): return .files([shot.file] + (shot.context.map { [$0] } ?? []))
        case .notOk(let refused):
          return refused.reason == .notPermitted ? .note(.screenRecording) : .nothing
        }
      case .files:
        let files = try await attachments.pickFiles()
        return files.isEmpty ? .nothing : .files(files)
      }
    } catch {
      return .note(.failed(error.message))
    }
  }

  /// A note about a problem with the attachment is read out, since it appears away from where
  /// the person's focus is.
  private func announceNote() {
    guard let note = island.model.compose.note,
      case .compose(_, let attach) = state.shown?.phase
    else { return }
    let text = IslandComposeNote.text(note, attach: attach, labels: island.model.labels)
    AccessibilityNotification.Announcement(text).post()
  }

  /// The longest the card waits for the app the person was in to take activation back.
  private static let handBackLimit: Duration = .milliseconds(500)

  /// The open panel leaves Atd active (a capture session hands activation back itself): the app
  /// the person was in, `previous`, gets it back, and the card waits until Atd is no longer
  /// active, so taking the keyboard again is not undone by the switch.
  private static func handBackActivation(to previous: NSRunningApplication?) async {
    guard NSApp.isActive, let previous, !previous.isTerminated else { return }
    _ = previous.activate(from: .current, options: [])
    let deadline = ContinuousClock.now + handBackLimit
    while NSApp.isActive, ContinuousClock.now < deadline {
      try? await Task.sleep(for: .milliseconds(16))
    }
  }
}
