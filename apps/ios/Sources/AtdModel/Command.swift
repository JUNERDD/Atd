import Foundation

/// A saved command: a prompt with typed options, an input source and an output action.
///
/// The vocabulary follows the desktop app's commands (instructions, input, placement,
/// output.review, adjustments) with iPhone entry points as values. The two libraries are not
/// synchronized; sharing the words keeps a later import or export simple.
public struct Command: Codable, Sendable, Identifiable, Equatable, Hashable {
  /// Built-in commands keep fixed ids (`polish`); commands the person creates use a UUID.
  public var id: String
  /// Bumped on every edit, so a cached result made with older settings can be recognized.
  public var revision: Int
  public var name: String
  /// An SF Symbol name.
  public var symbol: String
  /// A system hue that identifies the command; it never decorates.
  public var tint: CommandTint
  /// What the model is asked to do (要求).
  public var instructions: String
  /// The typed options; each `value` is the remembered choice the keyboard and the 指令 tab share.
  public var options: [CommandOption]
  /// The option whose choices the keyboard lays out as versions of one result (润色: 语气).
  public var versionOption: String?
  /// The option that takes over as the version axis when a copied-input command runs with a
  /// draft in the field (帮我回复: 语气 with a draft, 态度 without one).
  public var draftVersionOption: String?
  public var input: CommandInput
  public var output: CommandOutput
  public var placement: CommandPlacement
  /// Quick refinements offered while a result is on show (再短点 · 正式点 · 加个表情).
  public var adjustments: [String]
  public var model: ModelChoice

  public init(
    id: String, revision: Int = 1, name: String, symbol: String, tint: CommandTint,
    instructions: String, options: [CommandOption] = [], versionOption: String? = nil,
    draftVersionOption: String? = nil, input: CommandInput, output: CommandOutput,
    placement: CommandPlacement, adjustments: [String] = [], model: ModelChoice = .appDefault
  ) {
    self.id = id
    self.revision = revision
    self.name = name
    self.symbol = symbol
    self.tint = tint
    self.instructions = instructions
    self.options = options
    self.versionOption = versionOption
    self.draftVersionOption = draftVersionOption
    self.input = input
    self.output = output
    self.placement = placement
    self.adjustments = adjustments
    self.model = model
  }

  /// The current value of every option, by key.
  public var values: [String: String] {
    Dictionary(options.map { ($0.key, $0.value) }, uniquingKeysWith: { first, _ in first })
  }

  public func option(_ key: String) -> CommandOption? {
    options.first { $0.key == key }
  }

  /// Remembers `value` for the option `key`; values outside its choices are ignored.
  public mutating func setValue(_ value: String, for key: String) {
    guard let index = options.firstIndex(where: { $0.key == key }),
      options[index].choices.contains(value), options[index].value != value
    else { return }
    options[index].value = value
    revision += 1
  }

  /// The option whose choices become versions of a result, given whether the field holds a draft.
  public func versionAxis(hasDraft: Bool) -> CommandOption? {
    if input == .copied, hasDraft, let key = draftVersionOption, let option = option(key) {
      return option
    }
    return versionOption.flatMap(option)
  }
}

/// One typed option: a label and its choices, with the remembered choice.
public struct CommandOption: Codable, Sendable, Equatable, Hashable {
  public var key: String
  public var label: String
  public var choices: [String]
  public var value: String

  public init(key: String, label: String, choices: [String], value: String) {
    self.key = key
    self.label = label
    self.choices = choices
    self.value = value
  }
}

/// The system hues a command can be identified by.
public enum CommandTint: String, Codable, Sendable, CaseIterable {
  case red, orange, yellow, green, mint, teal, cyan, blue, indigo, purple, pink, brown, gray
}

/// Where a command reads its input.
public enum CommandInput: String, Codable, Sendable, CaseIterable {
  /// The text in the field the keyboard types into (输入框).
  case text
  /// What the person copied (剪贴板).
  case copied
  /// What another app shares (分享的内容).
  case shared
  /// A photo or screenshot.
  case image
  /// Runs without input.
  case none
}

/// What happens to a command's result.
public struct CommandOutput: Codable, Sendable, Equatable, Hashable {
  public enum Action: String, Codable, Sendable, CaseIterable {
    /// Replaces the text it read.
    case replace
    /// Inserts at the cursor.
    case insert
    /// Shows a result card.
    case card
    /// Copies the result.
    case copy
  }

  public var action: Action
  /// Whether the result is previewed before it is written back (先预览再写回).
  public var review: Bool
  /// The card a `.card` result is shown as; nil for every other action. Files written before
  /// cards existed have no such field and read as nil.
  public var card: CardKind?

  public init(action: Action, review: Bool = true, card: CardKind? = nil) {
    self.action = action
    self.review = review
    self.card = card
  }

  /// The card a surface that shows results (the share sheet, the camera, Siri) shows this one in:
  /// a card command's own kind, `.text` for a card command that names none, and `.text` for a
  /// command whose result otherwise goes back into a field.
  public var cardKind: CardKind {
    action == .card ? card ?? .text : .text
  }
}

/// The entry points a command shows up in.
public struct CommandPlacement: Codable, Sendable, Equatable, Hashable {
  public var keyboard: Bool
  public var share: Bool
  public var camera: Bool
  public var controls: Bool
  public var siri: Bool

  public init(
    keyboard: Bool = false, share: Bool = false, camera: Bool = false, controls: Bool = false,
    siri: Bool = false
  ) {
    self.keyboard = keyboard
    self.share = share
    self.camera = camera
    self.controls = controls
    self.siri = siri
  }

  public subscript(surface: Surface) -> Bool {
    get {
      switch surface {
      case .keyboard: keyboard
      case .share: share
      case .camera: camera
      case .controls: controls
      case .siri: siri
      }
    }
    set {
      switch surface {
      case .keyboard: keyboard = newValue
      case .share: share = newValue
      case .camera: camera = newValue
      case .controls: controls = newValue
      case .siri: siri = newValue
      }
    }
  }
}

/// An entry point of the system a command can be placed in.
public enum Surface: String, Codable, Sendable, CaseIterable {
  case keyboard, share, camera, controls, siri

  /// The entry points this build implements, which the app offers as places for a command. Each
  /// surface still runs only what it can: the keyboard, for one, only commands that read text and
  /// write text back.
  public static let available: [Surface] = allCases
}

/// Which model runs a command.
public enum ModelChoice: Codable, Sendable, Equatable, Hashable {
  /// The connection chosen as the default in 我的 › 模型.
  case appDefault
  /// A specific connection and model.
  case connection(id: String, model: String)
}
