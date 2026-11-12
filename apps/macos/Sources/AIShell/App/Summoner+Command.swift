import AICore
import AppKit

/// Per-command summon execution for `.command`: prunes unneeded selection and write-target reads
/// from ``CommandOptionsCatalog``, runs needed Accessibility reads in parallel, and resolves
/// ``HeldIntent`` before posting a synthetic ⌘C so holding for options never stalls on modifier
/// release.
extension Summoner {
  func beginCommandSummon(
    _ launch: CommandLaunch, steps: [SummonStep], selectedText: String?, held: HeldIntent?
  ) {
    isSummoning = true
    let entry = commandOptions.entry(for: launch.id)
    let wantsSelection =
      entry?.output.selection == false ? false : steps.contains(.captureSelection)
    let mayNeedTarget =
      steps.contains(.captureTarget)
      && Self.mayNeedWriteTarget(
        entry: entry, launch: launch, wantsSelection: wantsSelection, held: held != nil)
    let frontmost = NSWorkspace.shared.frontmostApplication
    let frontmostPID = frontmost?.processIdentifier
    if mayNeedTarget, let frontmost, frontmost != NSRunningApplication.current,
      WriteTargets.awaitsWebFocus(frontmost)
    {
      SelectionPresence.wake(pid: frontmost.processIdentifier)
    }
    let targetTask = mayNeedTarget ? writeTargets.beginRead(readsText: !wantsSelection) : nil
    Task {
      defer { isSummoning = false }
      await runCommandSummon(
        launch, entry: entry, wantsSelection: wantsSelection, frontmostPID: frontmostPID,
        selectedText: selectedText, held: held, targetTask: targetTask)
    }
  }

  private func runCommandSummon(
    _ launch: CommandLaunch, entry: CommandOptionsCatalog.Entry?, wantsSelection: Bool,
    frontmostPID: pid_t?, selectedText: String?, held: HeldIntent?,
    targetTask: Task<WriteTargetReader.Read?, Never>?
  ) async {
    var selection = SummonSelection.unread
    var resolvedIntent: CommandLaunch.Intent?
    if wantsSelection {
      let read = await readCommandSelection(
        frontmostPID: frontmostPID, selectedText: selectedText, held: held)
      selection = read.selection
      resolvedIntent = read.intent
    } else {
      stash = nil
    }
    let intent: CommandLaunch.Intent =
      if let resolvedIntent {
        resolvedIntent
      } else if let held {
        await held.intent()
      } else {
        launch.intent
      }
    let finalLaunch =
      held == nil
      ? launch : CommandLaunch(id: launch.id, arguments: launch.arguments, intent: intent)
    let target: ShortcutCommandEvent.Target?
    if let targetTask,
      Self.needsWriteTarget(
        entry: entry, launch: finalLaunch, intent: intent, wantsSelection: wantsSelection,
        hasStash: stash != nil)
    {
      target = writeTargets.record(await targetTask.value, after: selection)
    } else {
      targetTask?.cancel()
      target = nil
    }
    panelHost.send(.shortcutCommand(finalLaunch.event(target: target)))
    held?.delivered()
  }

  private func readCommandSelection(
    frontmostPID: pid_t?, selectedText: String?, held: HeldIntent?
  ) async -> (selection: SummonSelection, intent: CommandLaunch.Intent?) {
    if let selectedText {
      stash = TextCapture.stash(selectedText, at: .now)
      return (stash == nil ? .field(nil) : .field(selectedText), nil)
    }
    guard SelectionReader.isTrusted else {
      trust.promptForSummon()
      stash = nil
      return (.field(nil), nil)
    }
    switch await SelectionReader.readBounded(frontmostPID: frontmostPID) {
    case .text(let text):
      stash = TextCapture.stash(text, at: .now)
      return (stash == nil ? .field(nil) : .field(text), nil)
    case .none(let focus):
      guard let pid = frontmostPID else {
        stash = nil
        return (.field(nil), nil)
      }
      switch await CopySelection.copyViaMenu(from: pid, after: focus, arbiter: arbiter) {
      case .finished(let content):
        return (stashCopied(content), nil)
      case .needsKeyPress:
        if let held {
          let intent = await held.intent()
          guard intent == .run else {
            stash = nil
            return (.field(nil), intent)
          }
          held.onTapFallback?()
          let content = await CopySelection.copyViaKeyPress(
            from: pid, after: focus, arbiter: arbiter)
          return (stashCopied(content), intent)
        }
        let content = await CopySelection.copyViaKeyPress(from: pid, after: focus, arbiter: arbiter)
        return (stashCopied(content), nil)
      }
    }
  }

  private func stashCopied(_ content: CopySelection.Content?) -> SummonSelection {
    stash = TextCapture.stash(content?.text, at: .now)
    guard stash != nil, let content else { return .field(nil) }
    return .copied(content)
  }

  static func answersInPlace(_ action: CommandOutputAction) -> Bool {
    switch action {
    case .card, .annotate, .replaceSelection, .insertAfterSelection, .insertAtCursor:
      true
    case .panel, .copy:
      false
    }
  }

  private static func hasInputOptions(_ entry: CommandOptionsCatalog.Entry) -> Bool {
    entry.options.contains {
      if case .input = $0 { true } else { false }
    }
  }

  static func mayNeedWriteTarget(
    entry: CommandOptionsCatalog.Entry?, launch: CommandLaunch, wantsSelection: Bool, held: Bool
  ) -> Bool {
    guard let entry else { return true }
    let effectiveOutput = launch.arguments?.output ?? entry.output.value
    guard !answersInPlace(effectiveOutput), !hasInputOptions(entry) else { return true }
    return held || wantsSelection
  }

  static func needsWriteTarget(
    entry: CommandOptionsCatalog.Entry?, launch: CommandLaunch, intent: CommandLaunch.Intent,
    wantsSelection: Bool, hasStash: Bool
  ) -> Bool {
    guard let entry else { return true }
    let effectiveOutput = launch.arguments?.output ?? entry.output.value
    guard !answersInPlace(effectiveOutput), !hasInputOptions(entry) else { return true }
    guard intent == .run else { return true }
    return wantsSelection && !hasStash
  }
}
