/// A command a summon launches, as `shortcut.command` hands it to the page: the command's id,
/// values picked in the shell's options over the remembered ones (nil: none), and what the page
/// does with it (`run`, `choose` its options first, or `edit` them in the panel).
public struct CommandLaunch: Equatable, Sendable {
  public typealias Intent = ShortcutCommandEvent.Intent

  public let id: String
  public let arguments: CommandArguments?
  public let intent: Intent

  public init(id: String, arguments: CommandArguments? = nil, intent: Intent = .run) {
    self.id = id
    self.arguments = arguments
    self.intent = intent
  }

  /// The event that hands the launch to the page, with the field it came from. A plain run leaves
  /// `intent` out, which the page reads as `run`.
  public func event(target: ShortcutCommandEvent.Target?) -> ShortcutCommandEvent {
    ShortcutCommandEvent(
      id: id, target: target, arguments: arguments, intent: intent == .run ? nil : intent)
  }
}

/// What asked for the panel.
public enum SummonTrigger: Equatable, Sendable {
  /// The panel shortcut or a click on the menu bar status item.
  case toggle
  /// The screenshot shortcut.
  case screenshot
  /// A command's global shortcut, or a command of the mini panel.
  case command(CommandLaunch)
  /// The selection toolbar's Ask Atd.
  case ask
  /// A command button (or More menu item) of the selection toolbar.
  case toolbarCommand(CommandLaunch)

  /// The ids the page gives the panel toggle and the screenshot in its registration set
  /// (`shortcuts.set`); the page reserves them, so no command uses them.
  public static let panelToggleID = NativeBridgeContract.panelShortcutId
  public static let screenshotID = NativeBridgeContract.screenshotShortcutId

  /// The trigger of a pressed hot key registered under `id`.
  public init(hotKeyID id: String) {
    switch id {
    case Self.panelToggleID: self = .toggle
    case Self.screenshotID: self = .screenshot
    default: self = .command(CommandLaunch(id: id))
    }
  }
}

/// The shell state a summon depends on.
public struct SummonContext: Equatable, Sendable {
  /// The panel is key; a hidden panel never is, because hiding gives up key status.
  public var panelIsKey: Bool
  /// A file chooser or save panel is open; summons wait until it closes.
  public var filePanelOpen: Bool
  /// Some enabled command fills its input from the selection (pushed by the page).
  public var selectionWanted: Bool

  public init(panelIsKey: Bool, filePanelOpen: Bool, selectionWanted: Bool) {
    self.panelIsKey = panelIsKey
    self.filePanelOpen = filePanelOpen
    self.selectionWanted = selectionWanted
  }
}

/// One step of a summon, run in order.
public enum SummonStep: Equatable, Sendable {
  case hidePanel
  /// Read the frontmost app's selection (bounded) and stash it, replacing the previous stash.
  case captureSelection
  /// Drop the stash, so a later `capture('selection')` never returns stale text.
  case clearSelection
  /// Record the focused text field of the app the command came from (bounded), so the page can
  /// write the run's answer back into it (`text.write`). It follows the selection step, whose
  /// text it reuses, and comes before anything can take focus.
  case captureTarget
  case showPanel
  /// Hand the command launch to the page, which prepares it and reveals the panel itself once
  /// the launched command shows, so a launch never flashes an unrelated page first.
  case deliverCommand(CommandLaunch)
  /// Tell the page to take a screenshot: it captures with the panel out of the way, puts the
  /// image in its composer and reveals the panel itself.
  case deliverScreenshot
  /// Tell the page (`selection.ask`) to put the stash in its composer as a quote and focus it.
  case deliverAsk
}

/// The summon flow of the panel toggle, screenshot and command shortcuts, with the selection
/// model of grill decision Q9:
/// - a key panel hides without capturing (toggle only);
/// - summons are ignored while a file panel is open;
/// - otherwise the selection is captured before the panel can take focus when some command
///   wants it, and the stash is cleared when none does.
///
/// The selection toolbar's actions always capture: the user just pointed at the selection.
/// Ask Atd shows the panel and has the page quote the stash; a command goes to the page like
/// its shortcut, whether or not any command fills its input from the selection.
///
/// A command, from its shortcut or the toolbar, also records its write target unless the panel
/// is key: the focus is then the panel's own, with no other app's field to write back into.
public enum SummonPolicy {
  public static func steps(for trigger: SummonTrigger, in context: SummonContext) -> [SummonStep] {
    if context.filePanelOpen { return [] }
    let selection: SummonStep = context.selectionWanted ? .captureSelection : .clearSelection
    let target: [SummonStep] = context.panelIsKey ? [] : [.captureTarget]
    switch trigger {
    case .toggle:
      return context.panelIsKey ? [.hidePanel] : [selection, .showPanel]
    case .screenshot:
      return [selection, .deliverScreenshot]
    case .command(let launch):
      return [selection] + target + [.deliverCommand(launch)]
    case .ask:
      return [.captureSelection, .showPanel, .deliverAsk]
    case .toolbarCommand(let launch):
      return [.captureSelection] + target + [.deliverCommand(launch)]
    }
  }
}
