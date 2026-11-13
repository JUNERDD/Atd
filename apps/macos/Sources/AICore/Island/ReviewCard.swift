/// What the review card holds of its own until it sends it (contract: `commandProgress.show`'s
/// answer with `review`): the adjustment typed into its field, the suggested adjustments chosen
/// (any number, in the order chosen, none excluding another), the option values changed for the
/// next version, and whether the answer shows its changes against the original. The page learns
/// the staged part only when the card sends it, all at once, as one `adjust` (``adjust``); nothing
/// staged runs before that.
///
/// Option changes are kept against the version shown (``base``): a value set back to the
/// version's own is no change, and stepping to another version keeps only the changes that still
/// differ from it (``rebase(_:)``).
public struct ReviewDraft: Equatable, Sendable {
  /// One staged change, kept oldest first so ⌫ takes back the last one.
  public enum Item: Equatable, Sendable {
    /// The option with this key runs with another value.
    case option(String)
    /// This suggested adjustment is chosen.
    case adjustment(String)
  }

  /// The longest adjustment text the contract takes (`ReviewAdjustSchema`), in Unicode code
  /// points, as the page's schema check and the bridge count them.
  public static let maxText = 2_000

  /// The field's text, as typed.
  public var text = ""
  /// The answer shows its changes against the original rather than the original above it.
  public var showsChanges = true
  public private(set) var items: [Item] = []
  /// The options as the version shown ran with them.
  public private(set) var base: [CommandOption]
  /// The options with the values the next version runs with: the version's own unless changed.
  public private(set) var values: [CommandOption]

  public init(options: [CommandOption] = []) {
    base = options
    values = options
  }

  /// How many changes are staged.
  public var count: Int { items.count }

  /// Something to send: a staged change, or text that is not only white space.
  public var canSend: Bool { !items.isEmpty || !text.allSatisfy(\.isWhitespace) }

  /// Some option runs with another value.
  public var changesOptions: Bool {
    items.contains { if case .option = $0 { true } else { false } }
  }

  /// The value choice `key` runs with next; nil for a key that is no choice.
  public func choice(_ key: String) -> String? {
    for case .choice(let choice) in values where choice.key == key { return choice.value }
    return nil
  }

  /// Whether `adjustment` is chosen.
  public func chose(_ adjustment: String) -> Bool { items.contains(.adjustment(adjustment)) }

  /// Chooses `adjustment`, after any chosen before, or takes it back when it was chosen.
  public mutating func toggle(adjustment: String) {
    if let index = items.firstIndex(of: .adjustment(adjustment)) {
      items.remove(at: index)
    } else {
      items.append(.adjustment(adjustment))
    }
  }

  /// Sets choice `key` to `value` for the next version; the version's own value is no change.
  public mutating func choose(_ value: String, for key: String) {
    stage(values.map { $0.key == key ? $0.choosing(value) : $0 })
  }

  /// Takes every value of `options` (the options sheet's, as it was left): each one that differs
  /// from the version's is staged, keeping its place when it already was; the rest are no change.
  public mutating func stage(_ options: [CommandOption]) {
    let picked = Self.byKey(options)
    values = base.map { option in picked[option.key].map(option.taking) ?? option }
    for option in base {
      let item = Item.option(option.key)
      if differs(option.key) {
        if !items.contains(item) { items.append(item) }
      } else {
        items.removeAll { $0 == item }
      }
    }
  }

  /// Takes back the last staged change; false when nothing is staged.
  public mutating func removeLast() -> Bool {
    guard let last = items.popLast() else { return false }
    if case .option(let key) = last {
      values = values.map { option in
        guard option.key == key, let own = base.first(where: { $0.key == key }) else {
          return option
        }
        return own
      }
    }
    return true
  }

  /// Takes back every staged change; the text stays.
  public mutating func clearStaged() {
    items = []
    values = base
  }

  /// Another version shows, which ran with `options`: changes that still differ from its values
  /// stay staged (with the option's own labels), the others are dropped.
  public mutating func rebase(_ options: [CommandOption]) {
    let staged = Self.byKey(values)
    let changed = Set(items.compactMap { if case .option(let key) = $0 { key } else { nil } })
    base = options
    values = options.map { option in
      guard changed.contains(option.key), let kept = staged[option.key] else { return option }
      return option.taking(kept)
    }
    let unchanged = Set(changed.filter { !differs($0) })
    items.removeAll { item in
      guard case .option(let key) = item else { return false }
      return unchanged.contains(key)
    }
  }

  /// What the card sends as `adjust`: the text without its surrounding white space (cut to
  /// ``maxText`` code points, between characters), the chosen adjustments in order, and every
  /// value the next version runs with once any option changed; nil while there is nothing to send.
  public var adjust: CommandProgressActionEvent.Adjust? {
    guard canSend else { return nil }
    var text = ""
    var points = 0
    for character in self.text.trimmingCharacters(in: .whitespacesAndNewlines) {
      points += character.unicodeScalars.count
      guard points <= Self.maxText else { break }
      text.append(character)
    }
    let adjustments = items.compactMap { if case .adjustment(let text) = $0 { text } else { nil } }
    return CommandProgressActionEvent.Adjust(
      text: text, adjustments: adjustments,
      arguments: changesOptions ? CommandArguments(values: values) : nil)
  }

  /// Option `key`'s next value differs from the version's.
  private func differs(_ key: String) -> Bool {
    values.first { $0.key == key } != base.first { $0.key == key }
  }

  private static func byKey(_ options: [CommandOption]) -> [String: CommandOption] {
    Dictionary(options.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })
  }
}

/// How the review card offers a version's options (contract: the review's `options`): a lone
/// choice of at most ``maxValueChips`` values as one chip per value, any other non-empty set as
/// one summary chip that opens the options sheet, no chip without options.
public enum ReviewOptionChips: Equatable, Sendable {
  case none
  case values(CommandOption.Choice)
  case summary

  /// A lone choice with more values than this goes to the sheet instead.
  public static let maxValueChips = 6

  public init(_ options: [CommandOption]) {
    if options.isEmpty {
      self = .none
    } else if options.count == 1, case .choice(let choice) = options[0],
      choice.options.count <= Self.maxValueChips
    {
      self = .values(choice)
    } else {
      self = .summary
    }
  }

  /// The values `options` run with, as the page's values summary says them: each choice's value
  /// by its label (the value itself where the label is blank), then nothing for an input, the
  /// label of each toggle that is on, ` · ` apart, in option order; nil when that says nothing.
  public static func summary(of options: [CommandOption]) -> String? {
    let parts = options.compactMap { option -> String? in
      switch option {
      case .choice(let choice):
        guard let value = choice.options.first(where: { $0.value == choice.value }) else {
          return nil
        }
        let label = value.label.trimmingCharacters(in: .whitespacesAndNewlines)
        return label.isEmpty ? (value.value.isEmpty ? nil : value.value) : label
      case .toggle(let toggle): return toggle.value ? toggle.label : nil
      case .input: return nil
      }
    }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }
}

/// One chip of the review card's row: a value of a lone choice, the summary chip that opens the
/// options sheet, or a suggested adjustment.
public enum ReviewChip: Equatable, Sendable {
  case value(key: String, CommandOption.Choice.Option)
  case summary
  case adjustment(String)

  /// The row a version offering `options` and `adjustments` shows, in order: the options' chips,
  /// then the adjustments'. The row's keyboard highlight is an index into it.
  public static func row(_ options: ReviewOptionChips, adjustments: [String]) -> [ReviewChip] {
    let chips: [ReviewChip] =
      switch options {
      case .none: []
      case .values(let choice): choice.options.map { .value(key: choice.key, $0) }
      case .summary: [.summary]
      }
    return chips + adjustments.map(ReviewChip.adjustment)
  }
}

/// The review card's geometry. It shares the other cards' corner, padding, title row and footer
/// (``IslandMetrics/cardRadius``, ``IslandMetrics/cardPadding``, ``IslandMetrics/headerHeight``,
/// ``IslandMetrics/footerHeight``) and the answer card's width (``IslandMetrics/cardWidth(ideal:)``);
/// between title and footer: the original, the answer (which scrolls once the card would be taller
/// than ``IslandMetrics/maxShape``), the adjust field and the row of chips, which wraps.
extension IslandMetrics {
  /// The adjust field's capsule.
  public static let reviewFieldHeight = 32.0
  /// The field's send capsule; its width follows the localized label.
  public static let reviewSendHeight = 24.0
  /// The version pager's buttons, round.
  public static let reviewPagerSide = 24.0
  public static let reviewChipHeight = 24.0
  /// Between chips, along a row and between rows.
  public static let reviewChipGap = 4.0
  /// Between the field and the chips.
  public static let reviewChipsTop = 6.0
  /// The summary chip's widest, past which its summary ends in an ellipsis.
  public static let reviewSummaryWidth = 280.0
  /// The original wraps to at most this many lines.
  public static let reviewSourceLines = 2

  /// The card's height for content that would take `natural` points shown whole: up to
  /// ``maxShape``'s height, past which the answer scrolls.
  public static func reviewCardHeight(natural: Double) -> Double {
    min(natural.rounded(.up), maxShape.height)
  }
}

extension CommandProgressShowParams.State.Answer.Review {
  /// The most versions a review makes (the contract's `MAX_REVIEW_VERSIONS`).
  public static let maxVersions = 20

  /// Another version can be asked for: none is pending, and the review has fewer than
  /// ``maxVersions``.
  public var takesVersion: Bool { pending == nil && count < Self.maxVersions }

  /// The pages the card steps between: the kept versions, then the pending one's while one is.
  public var pages: Int { count + (pending == nil ? 0 : 1) }

  /// The card is on the pending version's page (`version` past `count`), whose answer is what
  /// came of it so far.
  public var showsPending: Bool { pending != nil && version > count }

  /// The review card's row of chips (``ReviewChip/row(_:adjustments:)``).
  public var chipRow: [ReviewChip] {
    ReviewChip.row(ReviewOptionChips(options), adjustments: adjustments)
  }
}

extension CommandOption {
  /// The parameter's key.
  var key: String {
    switch self {
    case .choice(let choice): choice.key
    case .toggle(let toggle): toggle.key
    case .input(let input): input.key
    }
  }

  /// This option with `other`'s value, when it can take it (a choice offering that value, a
  /// toggle); itself otherwise.
  fileprivate func taking(_ other: CommandOption) -> CommandOption {
    switch (self, other) {
    case (.choice(let choice), .choice(let value))
    where choice.options.contains(where: { $0.value == value.value }):
      choosing(value.value)
    case (.toggle, .toggle(let value)): setting(value.value)
    default: self
    }
  }
}
