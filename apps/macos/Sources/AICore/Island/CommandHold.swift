/// The hold gesture of a command shortcut (contract D3). A command the shell offers options for
/// (``CommandOptionsCatalog``) does not run on the press: the summon captures the selection and
/// the write target at once, and the launch waits for the gesture. Released before
/// ``threshold``, it runs with the remembered values; still held at ``threshold``, it asks the
/// page to choose its options, and the release that follows does nothing. The island shows the
/// hold only from ``reveal`` on, so a tap shows nothing ahead of its run. Any other shortcut
/// summons on the press, as it always has.
///
/// One hold is undecided at a time: another press while it is (a second shortcut, or a repeat of
/// the same one) is ignored, as the summon it would start would be. Each hold carries a
/// generation, so a threshold timer of an earlier hold never decides a later one.
///
/// While one of the island's cards has the keyboard (the options card, or the answer card while
/// its window is key), a summon would read Atd's own window as the selection and the write
/// target. A press then only closes the card (the options card's command is cancelled) and the
/// keyboard goes back to its field; it summons nothing, and pressing again once the card is gone
/// summons as usual.
public struct CommandHold: Equatable, Sendable {
  /// How long a press lasts before the options card opens instead of a run.
  public static let threshold: Duration = .milliseconds(300)
  /// How long a press lasts before the island shows it charging toward ``threshold``: longer than
  /// a tap, so only a press meant as a hold shows.
  public static let reveal: Duration = .milliseconds(150)
  /// How long the press island stays up after the launch went to the page, waiting for the
  /// page to show something; it collapses after that (the panel opened instead, say).
  public static let pageWait: Duration = .milliseconds(600)

  /// What a press of a shortcut does.
  public enum Press: Equatable, Sendable {
    /// Summon and deliver on the press, as before: the command offers no options (or the
    /// shortcut is not a command's).
    case summon
    /// Summon now and let the hold decide the launch's intent; `generation` names the hold for
    /// its threshold timer.
    case hold(generation: Int)
    /// Another hold is still undecided: nothing happens.
    case ignore
    /// A card has the keyboard: it closes, and the press summons nothing.
    case closeCard
  }

  private struct Held: Equatable, Sendable {
    let id: String
    let generation: Int
  }

  private var held: Held?
  private var generation = 0

  public init() {}

  /// A hold is waiting for its release or its threshold.
  public var isHolding: Bool { held != nil }

  /// Hold `generation` is still waiting for its release or its threshold.
  public func holds(generation: Int) -> Bool { held?.generation == generation }

  /// The shortcut `id` went down; `offersOptions` when its command is in the catalog,
  /// `cardOpen` while one of the island's cards has the keyboard.
  public mutating func press(id: String, offersOptions: Bool, cardOpen: Bool = false) -> Press {
    guard !cardOpen else { return .closeCard }
    guard offersOptions else { return .summon }
    guard held == nil else { return .ignore }
    generation += 1
    held = Held(id: id, generation: generation)
    return .hold(generation: generation)
  }

  /// The shortcut `id` came up: an undecided hold of it runs; anything else does nothing.
  public mutating func release(id: String) -> CommandLaunch.Intent? {
    guard held?.id == id else { return nil }
    held = nil
    return .run
  }

  /// ``threshold`` passed for hold `generation`: still held, it chooses its options.
  public mutating func elapse(generation: Int) -> CommandLaunch.Intent? {
    guard held?.generation == generation else { return nil }
    held = nil
    return .choose
  }

  /// The summon of hold `generation` did not start (another one runs, a file panel is open):
  /// the hold is dropped without deciding anything.
  public mutating func drop(generation: Int) {
    if held?.generation == generation { held = nil }
  }
}
