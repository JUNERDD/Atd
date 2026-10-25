import Foundation

/// `ComputerStepSchema`: one registered step. Its effect follows from its kind and fields
/// (`stepEffect`); only `press` names one, choosing between `click` and `submit`.
public enum ComputerStepWire: Codable, Equatable, Sendable {
  public enum PressEffect: String, Codable, Sendable {
    case click
    case submit
  }

  public enum ScrollDirection: String, Codable, Sendable {
    case up
    case down
    case left
    case right
  }

  public enum ClickButton: String, Codable, Sendable {
    case left
    case right
  }

  case navigate(url: String)
  /// Clears the field and inserts `text` as one field transaction; `text` is never empty.
  case fill(locator: ComputerLocatorWire, text: String)
  /// A semantic press of the element (its accessibility or DOM action), not a pointer click.
  case press(locator: ComputerLocatorWire, effect: PressEffect)
  case scroll(locator: ComputerPointLocatorWire?, direction: ScrollDirection, amount: Int)
  case wait(condition: ComputerConditionWire, timeoutMs: Int)
  case setValue(locator: ComputerLocatorWire, text: String)
  /// A pointer click; absent `button` is left and absent `count` is 1.
  case click(locator: ComputerPointLocatorWire, button: ClickButton?, count: Int?)
  /// One key, with unique modifiers, after focusing `locator` when it is set.
  case key(key: ComputerKeyName, modifiers: [ComputerModifier]?, locator: ComputerLocatorWire?)
  /// Keyboard text, after focusing `locator` when it is set.
  case type(text: String, locator: ComputerPointLocatorWire?)
  /// Empties the element's value.
  case clear(locator: ComputerLocatorWire)
  /// The menu item at `path`, from the menu bar title down.
  case menu(path: [String])
  /// A pointer drag inside the target's content; a native drag-and-drop session is refused
  /// (``ComputerRefusalReason/dragAndDrop``).
  case drag(from: ComputerPointLocatorWire, to: ComputerPointLocatorWire)
  /// Chooses the option with the visible label `option` in a select element.
  case select(locator: ComputerLocatorWire, option: String)
  /// Sets task resources on a file input. `paths` (the resources' files, in `resourceIds` order)
  /// is filled only by the service after checking the resources belong to the run's task; the
  /// host refuses an upload without them.
  case upload(locator: ComputerLocatorWire, resourceIds: [String], paths: [String]?)

  public var kind: ComputerStepKind {
    switch self {
    case .navigate: .navigate
    case .fill: .fill
    case .press: .press
    case .scroll: .scroll
    case .wait: .wait
    case .setValue: .setValue
    case .click: .click
    case .key: .key
    case .type: .type
    case .clear: .clear
    case .menu: .menu
    case .drag: .drag
    case .select: .select
    case .upload: .upload
    }
  }

  /// `stepEffect`. A key is `input` only when it is a bare navigation or typing key, or `shift`
  /// with a letter or digit; typed text is `input` unless it holds a line break, which can submit.
  public var effect: ComputerEffect {
    switch self {
    case .navigate: .navigate
    case .fill, .setValue, .clear, .select: .input
    case .press(_, let effect): effect == .submit ? .submit : .click
    case .scroll, .wait: .read
    case .click, .menu, .drag, .upload: .invoke
    case .key(let key, let modifiers, _):
      switch modifiers ?? [] {
      case []: key.isNavigation || key.isTyping ? .input : .invoke
      case [.shift]: key.isCharacter ? .input : .invoke
      default: .invoke
      }
    case .type(let text, _):
      // By scalar: "\r\n" is one Character, which a Character search for "\n" would miss.
      text.unicodeScalars.contains { $0 == "\n" || $0 == "\r" } ? .invoke : .input
    }
  }

  /// `isVisualStep`: whether any locator of the step is an image point.
  public var isVisual: Bool {
    switch self {
    case .scroll(let locator, _, _), .type(_, let locator): locator?.isImagePoint == true
    case .click(let locator, _, _): locator.isImagePoint
    case .drag(let from, let to): from.isImagePoint || to.isImagePoint
    case .navigate, .fill, .press, .wait, .setValue, .key, .clear, .menu, .select, .upload: false
    }
  }

  public init(from decoder: any Decoder) throws {
    let kind = try decoder.container(keyedBy: Keys.self)
      .decode(ComputerStepKind.self, forKey: .kind)
    switch kind {
    case .navigate:
      let container = try BridgeCoding.keyed(decoder, NavigateKeys.self)
      self = .navigate(url: try container.computerURL(.url))
    case .fill, .setValue:
      let container = try BridgeCoding.keyed(decoder, TextKeys.self)
      let locator = try container.value(.locator, ComputerLocatorWire.self)
      let text = try container.string(
        .text, minLength: 1, maxLength: ComputerWireLimits.maxTextLength)
      self =
        kind == .fill
        ? .fill(locator: locator, text: text) : .setValue(locator: locator, text: text)
    case .press:
      let container = try BridgeCoding.keyed(decoder, PressKeys.self)
      self = .press(
        locator: try container.value(.locator, ComputerLocatorWire.self),
        effect: try container.value(.effect, PressEffect.self))
    case .scroll:
      let container = try BridgeCoding.keyed(decoder, ScrollKeys.self)
      self = .scroll(
        locator: try container.optional(.locator) {
          try container.value($0, ComputerPointLocatorWire.self)
        },
        direction: try container.value(.direction, ScrollDirection.self),
        amount: try container.integer(.amount, minimum: 1, maximum: 20))
    case .wait:
      let container = try BridgeCoding.keyed(decoder, WaitKeys.self)
      self = .wait(
        condition: try container.value(.condition, ComputerConditionWire.self),
        timeoutMs: try container.integer(
          .timeoutMs, minimum: 1, maximum: ComputerWireLimits.maxWaitMs))
    case .click, .key, .type, .clear, .menu, .drag:
      self = try Self.input(kind, decoder)
    case .select, .upload:
      self = try Self.browser(kind, decoder)
    }
  }

  /// The steps only a browser target takes: choosing an option, setting files on an input.
  private static func browser(_ kind: ComputerStepKind, _ decoder: any Decoder) throws -> Self {
    if kind == .select {
      let container = try BridgeCoding.keyed(decoder, SelectKeys.self)
      return .select(
        locator: try container.value(.locator, ComputerLocatorWire.self),
        option: try container.string(.option, minLength: 1, maxLength: 200))
    }
    let container = try BridgeCoding.keyed(decoder, UploadKeys.self)
    let resourceIds = try container.array(
      .resourceIds, of: String.self, minItems: 1, maxItems: ComputerWireLimits.maxUploadFiles,
      uniqueItems: true)
    guard
      resourceIds.allSatisfy({
        (1...128).contains($0.unicodeScalars.count)
          && BridgeCoding.matches($0, ComputerPattern.identifier)
      })
    else {
      throw DecodingError.dataCorruptedError(
        forKey: .resourceIds, in: container, debugDescription: "resourceIds must be identifiers.")
    }
    let paths = try container.optional(.paths) {
      try container.array(
        $0, of: String.self, minItems: 1, maxItems: ComputerWireLimits.maxUploadFiles)
    }
    // Code points and the contract's `^/` pattern, as every other contract string is checked.
    if let paths,
      !paths.allSatisfy({
        (2...4096).contains($0.unicodeScalars.count) && BridgeCoding.matches($0, "^/")
      })
    {
      throw DecodingError.dataCorruptedError(
        forKey: .paths, in: container, debugDescription: "paths must be absolute file paths.")
    }
    return .upload(
      locator: try container.value(.locator, ComputerLocatorWire.self), resourceIds: resourceIds,
      paths: paths)
  }

  /// The steps that drive input directly, which the native engine adds to the semantic ones.
  private static func input(_ kind: ComputerStepKind, _ decoder: any Decoder) throws -> Self {
    switch kind {
    case .click:
      let container = try BridgeCoding.keyed(decoder, ClickKeys.self)
      return .click(
        locator: try container.value(.locator, ComputerPointLocatorWire.self),
        button: try container.optional(.button) { try container.value($0, ClickButton.self) },
        count: try container.optional(.count) { try container.integer($0, minimum: 1, maximum: 2) }
      )
    case .key:
      let container = try BridgeCoding.keyed(decoder, KeyKeys.self)
      return .key(
        key: try container.value(.key, ComputerKeyName.self),
        modifiers: try container.optional(.modifiers) {
          try container.array($0, of: ComputerModifier.self, maxItems: 4, uniqueItems: true)
        },
        locator: try container.optional(.locator) {
          try container.value($0, ComputerLocatorWire.self)
        })
    case .type:
      let container = try BridgeCoding.keyed(decoder, TypeKeys.self)
      return .type(
        text: try container.string(
          .text, minLength: 1, maxLength: ComputerWireLimits.maxTextLength),
        locator: try container.optional(.locator) {
          try container.value($0, ComputerPointLocatorWire.self)
        })
    case .clear:
      let container = try BridgeCoding.keyed(decoder, ClearKeys.self)
      return .clear(locator: try container.value(.locator, ComputerLocatorWire.self))
    case .menu:
      let container = try BridgeCoding.keyed(decoder, MenuKeys.self)
      let path = try container.array(
        .path, of: String.self, minItems: 1, maxItems: ComputerWireLimits.maxMenuPath)
      guard path.allSatisfy({ (1...200).contains($0.unicodeScalars.count) }) else {
        throw DecodingError.dataCorruptedError(
          forKey: .path, in: container,
          debugDescription: "path items must have 1 to 200 characters.")
      }
      return .menu(path: path)
    case .drag:
      let container = try BridgeCoding.keyed(decoder, DragKeys.self)
      return .drag(
        from: try container.value(.from, ComputerPointLocatorWire.self),
        to: try container.value(.to, ComputerPointLocatorWire.self))
    case .navigate, .fill, .press, .scroll, .wait, .setValue, .select, .upload:
      throw DecodingError.dataCorrupted(
        .init(codingPath: decoder.codingPath, debugDescription: "\(kind) is not an input step."))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Keys.self)
    try container.encode(kind, forKey: .kind)
    switch self {
    case .navigate(let url): try container.encode(url, forKey: .url)
    case .fill(let locator, let text), .setValue(let locator, let text):
      try container.encode(locator, forKey: .locator)
      try container.encode(text, forKey: .text)
    case .press(let locator, let effect):
      try container.encode(locator, forKey: .locator)
      try container.encode(effect, forKey: .effect)
    case .scroll(let locator, let direction, let amount):
      try container.encodeIfPresent(locator, forKey: .locator)
      try container.encode(direction, forKey: .direction)
      try container.encode(amount, forKey: .amount)
    case .wait(let condition, let timeoutMs):
      try container.encode(condition, forKey: .condition)
      try container.encode(timeoutMs, forKey: .timeoutMs)
    case .click(let locator, let button, let count):
      try container.encode(locator, forKey: .locator)
      try container.encodeIfPresent(button, forKey: .button)
      try container.encodeIfPresent(count, forKey: .count)
    case .key(let key, let modifiers, let locator):
      try container.encode(key, forKey: .key)
      try container.encodeIfPresent(modifiers, forKey: .modifiers)
      try container.encodeIfPresent(locator, forKey: .locator)
    case .type(let text, let locator):
      try container.encode(text, forKey: .text)
      try container.encodeIfPresent(locator, forKey: .locator)
    case .clear(let locator): try container.encode(locator, forKey: .locator)
    case .menu(let path): try container.encode(path, forKey: .path)
    case .drag(let from, let to):
      try container.encode(from, forKey: .from)
      try container.encode(to, forKey: .to)
    case .select(let locator, let option):
      try container.encode(locator, forKey: .locator)
      try container.encode(option, forKey: .option)
    case .upload(let locator, let resourceIds, let paths):
      try container.encode(locator, forKey: .locator)
      try container.encode(resourceIds, forKey: .resourceIds)
      try container.encodeIfPresent(paths, forKey: .paths)
    }
  }

  private enum Keys: String, CodingKey {
    case kind, url, locator, text, effect, direction, amount, condition, timeoutMs
    case button, count, key, modifiers, path, from, to, option, resourceIds, paths
  }
  private enum NavigateKeys: String, CodingKey, CaseIterable { case kind, url }
  private enum TextKeys: String, CodingKey, CaseIterable { case kind, locator, text }
  private enum PressKeys: String, CodingKey, CaseIterable { case kind, locator, effect }
  private enum ScrollKeys: String, CodingKey, CaseIterable { case kind, locator, direction, amount }
  private enum WaitKeys: String, CodingKey, CaseIterable { case kind, condition, timeoutMs }
  private enum ClickKeys: String, CodingKey, CaseIterable { case kind, locator, button, count }
  private enum KeyKeys: String, CodingKey, CaseIterable { case kind, key, modifiers, locator }
  private enum TypeKeys: String, CodingKey, CaseIterable { case kind, text, locator }
  private enum ClearKeys: String, CodingKey, CaseIterable { case kind, locator }
  private enum MenuKeys: String, CodingKey, CaseIterable { case kind, path }
  private enum DragKeys: String, CodingKey, CaseIterable { case kind, from, to }
  private enum SelectKeys: String, CodingKey, CaseIterable { case kind, locator, option }
  private enum UploadKeys: String, CodingKey, CaseIterable {
    case kind, locator, resourceIds, paths
  }
}
