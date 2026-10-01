/// What asked for the panel.
public enum SummonTrigger: Equatable, Sendable {
  /// The panel shortcut or a click on the menu bar status item.
  case toggle
  /// A command's global shortcut.
  case command(id: String)

  /// The id the page gives the panel toggle in its registration set (`shortcuts.set`); the
  /// page reserves it, so no command uses it.
  public static let panelToggleID = NativeBridgeContract.panelShortcutId

  /// The trigger of a pressed hot key registered under `id`.
  public init(hotKeyID id: String) {
    self = id == Self.panelToggleID ? .toggle : .command(id: id)
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
  case showPanel
  /// Hand the command's id to the page, which prepares it and reveals the panel itself once
  /// the launched command shows, so a launch never flashes an unrelated page first.
  case deliverCommand(id: String)
}

/// The summon flow of the panel toggle and command shortcuts, with the selection model of grill
/// decision Q9:
/// - a key panel hides without capturing (toggle only);
/// - summons are ignored while a file panel is open;
/// - otherwise the selection is captured before the panel can take focus when some command
///   wants it, and the stash is cleared when none does.
public enum SummonPolicy {
  public static func steps(for trigger: SummonTrigger, in context: SummonContext) -> [SummonStep] {
    if context.filePanelOpen { return [] }
    let selection: SummonStep = context.selectionWanted ? .captureSelection : .clearSelection
    switch trigger {
    case .toggle:
      return context.panelIsKey ? [.hidePanel] : [selection, .showPanel]
    case .command(let id):
      return [selection, .deliverCommand(id: id)]
    }
  }
}
