import AICore
import Foundation

/// The intent a command shortcut's hold decides for its launch. The summon that captured the
/// selection and the write target on the press awaits it before it delivers the command
/// (``Summoner/summon(_:selectedText:held:)``), and reports the delivery back.
final class HeldIntent {
  private var decided: CommandLaunch.Intent?
  private var waiting: [CheckedContinuation<CommandLaunch.Intent, Never>] = []
  /// The launch went to the page.
  var onDelivered: (() -> Void)?

  /// The hold decided; only the first decision counts.
  func resolve(_ intent: CommandLaunch.Intent) {
    guard decided == nil else { return }
    decided = intent
    for continuation in waiting { continuation.resume(returning: intent) }
    waiting = []
  }

  /// The decision, once there is one.
  func intent() async -> CommandLaunch.Intent {
    if let decided { return decided }
    return await withCheckedContinuation { waiting.append($0) }
  }

  func delivered() { onDelivered?() }
}

/// Turns the global shortcuts' presses and releases into summons (contract D3, ``CommandHold``).
/// A command whose options the shell offers captures at once on the press and shows the island's
/// press capsule once held for ``CommandHold/reveal``; its release before
/// ``CommandHold/threshold`` runs it, and holding on past it opens its options card. Every other
/// shortcut summons on the press, as it always has. Any shortcut pressed while a card has the
/// keyboard (the options card, or the answer card while its window is key) only closes it
/// (``CommandHold/Press/closeCard``).
final class ShortcutHolds {
  private var hold = CommandHold()
  private var pending: HeldIntent?
  private let catalog: () -> CommandOptionsCatalog
  private let summon: (SummonTrigger, HeldIntent?) -> Bool
  private let progress: CommandProgressController

  init(
    catalog: @escaping () -> CommandOptionsCatalog,
    summon: @escaping (SummonTrigger, HeldIntent?) -> Bool,
    progress: CommandProgressController
  ) {
    self.catalog = catalog
    self.summon = summon
    self.progress = progress
  }

  /// The shortcut registered under `id` went down.
  func pressed(_ id: String) {
    let trigger = SummonTrigger(hotKeyID: id)
    let entry: CommandOptionsCatalog.Entry? =
      if case .command = trigger { catalog().entry(for: id) } else { nil }
    switch hold.press(id: id, offersOptions: entry != nil, cardOpen: progress.cardHasKeyboard) {
    case .closeCard:
      progress.closeCard()
    case .summon:
      _ = summon(trigger, nil)
    case .ignore:
      break
    case .hold(let generation):
      guard let entry else { return }
      let held = HeldIntent()
      held.onDelivered = { [weak progress] in progress?.pressDelivered() }
      guard summon(trigger, held) else {
        hold.drop(generation: generation)
        return
      }
      pending = held
      Task { [weak self] in
        try? await Task.sleep(for: CommandHold.reveal)
        guard let self, hold.holds(generation: generation) else { return }
        progress.showPress(command: entry.name)
        try? await Task.sleep(for: CommandHold.threshold - CommandHold.reveal)
        guard let intent = hold.elapse(generation: generation) else { return }
        decide(intent)
      }
    }
  }

  /// The shortcut registered under `id` came up.
  func released(_ id: String) {
    guard let intent = hold.release(id: id) else { return }
    decide(intent)
  }

  private func decide(_ intent: CommandLaunch.Intent) {
    pending?.resolve(intent)
    pending = nil
  }
}
