import AtdAI
import AtdModel
import AtdPinyin
import Foundation
import Observation

/// Everything the keyboard does between the keys and the host field: pinyin composition, the
/// strip, results previewed in the field, the ✦ line and the clipboard. The UIKit controller
/// forwards keys and host events here and draws `strip` and `keys`.
///
/// Typed text never leaves the device on its own: a request starts only from a tap on a command,
/// a version, ✦ 续写 or the ✦ line.
@MainActor
@Observable
public final class KeyboardSession<Engine: PinyinConverting> {
  // MARK: What the app shares, set by the controller whenever it loads them

  /// The library's keyboard commands, in the library's order.
  public var commands: [Command] = []
  public var phrases: [Phrase] = []
  /// Without Full Access the keyboard types offline: no commands, clipboard or network.
  public var hasFullAccess = false
  /// Whether the app has a provider connection.
  public var hasModel = false
  /// The host's `enablesReturnKeyAutomatically`: return waits for text.
  public var returnNeedsText = false
  /// The pasteboard change count last acted on. The controller keeps it across launches, so a
  /// copy counts as new only until a command or 粘贴 reads it.
  public internal(set) var seenChangeCount: Int?
  /// Text read from the clipboard while the keyboard ran, newest first; never saved.
  public internal(set) var clipboardHistory: [String] = []

  // MARK: Collaborators

  let document: any DocumentEditor
  let clipboard: any Clipboard
  let generator: any TextGenerating
  let sleep: @Sendable (Duration) async throws -> Void
  /// The engine and what it learned; the controller saves what it learned.
  @ObservationIgnored public internal(set) var pinyin: Engine

  // MARK: State

  /// The letters typed into the composition, the picked part included.
  var input = ""
  /// Candidates picked for the start of `input`.
  var picks: [PinyinCandidate] = []
  /// The reading of the letters after the picks; set while composing.
  var conversion: PinyinConversion?
  var predictions: Predictions?
  var preview: Preview?
  var ask: AskLine?
  var taken: Taken?
  var failure: ModelFailure?
  var lastRun: Run?
  var field = FieldSnapshot()
  var copied = ClipboardSnapshot()

  @ObservationIgnored var streaming: Task<Void, Never>?
  @ObservationIgnored var predictionTimer: Task<Void, Never>?

  /// - Parameters:
  ///   - seenChangeCount: the change count the keyboard last acted on, as saved.
  ///   - sleep: waits out the pause after which predictions give way to the commands.
  public init(
    document: any DocumentEditor, clipboard: any Clipboard, pinyin: Engine,
    generator: any TextGenerating, seenChangeCount: Int? = nil,
    sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
  ) {
    self.document = document
    self.clipboard = clipboard
    self.pinyin = pinyin
    self.generator = generator
    self.seenChangeCount = seenChangeCount
    self.sleep = sleep
    refresh()
  }

  static var candidateLimit: Int { 60 }
  static var predictionLimit: Int { 8 }
  static var historyLimit: Int { 10 }
  /// How long predictions stay after a commit when typing does not go on.
  static var predictionPause: Duration { .milliseconds(1_500) }

  // MARK: What the controller draws

  public var strip: Strip {
    if let ask { return .ask(askStrip(ask)) }
    if let preview { return .preview(preview) }
    if let conversion { return .candidates(conversion.candidates) }
    if let predictions { return .predictions(predictions) }
    return .tools(tools)
  }

  public var keys: KeyRoles {
    KeyRoles(controlsPreview: preview != nil && ask == nil, returnKey: returnKey)
  }

  private var returnKey: ReturnKey {
    if let ask {
      return ask.letters.isEmpty ? .generate(isEnabled: !ask.text.trimmed.isEmpty) : .confirm
    }
    if conversion != nil { return .confirm }
    if let preview { return .host(isEnabled: !preview.isStreaming) }
    return .host(isEnabled: field.hasText || !returnNeedsText)
  }

  var tools: Tools {
    let line = toolLine
    return Tools(canUndo: taken != nil, commands: line == nil ? chips : [], line: line)
  }

  private var toolLine: ToolLine? {
    guard hasFullAccess else { return .fullAccessOff }
    if let failure { return failure == .noModel ? .noModel : .failure(failure) }
    return hasModel ? nil : .noModel
  }

  /// The commands that have something to work on, ranked by what the person just did.
  var chips: [CommandChip] {
    guard canRunAI else { return [] }
    return CommandRanking.chips(
      commands, readable: field.readable, copied: copied, seen: seenChangeCount)
  }

  var canRunAI: Bool { hasFullAccess && hasModel }

  // MARK: Host events

  /// Rereads the field and the clipboard. The controller calls it when the keyboard appears; the
  /// session calls it after every edit it makes.
  public func refresh() {
    field = FieldSnapshot(
      documentID: document.documentIdentifier, before: document.contextBeforeInput ?? "",
      after: document.contextAfterInput ?? "", selection: document.selectedText ?? "",
      hasText: document.hasText)
    copied =
      hasFullAccess
      ? ClipboardSnapshot(changeCount: clipboard.changeCount, hasText: clipboard.hasText)
      : ClipboardSnapshot()
  }

  /// The host changed the text, or the person moved to another field (`textDidChange`). A
  /// preview or composition the field no longer holds is dropped without writing anything.
  public func documentChanged() {
    let moved = document.documentIdentifier != field.documentID
    if let preview, moved || (!document.hasText && !preview.shown.text.isEmpty) {
      streaming?.cancel()
      streaming = nil
      self.preview = nil
    }
    if conversion != nil, moved || !document.hasText {
      input = ""
      picks = []
      conversion = nil
    }
    if moved {
      ask = nil
      taken = nil
      endPredictions()
    }
    refresh()
  }

  /// A memory warning: versions not on show are let go and made again if picked.
  public func releaseMemory() {
    guard var preview else { return }
    for index in preview.versions.indices
    where index != preview.selected && preview.versions[index].recipe != nil
      && preview.versions[index].state == .complete
    {
      preview.versions[index].text = ""
      preview.versions[index].state = .notStarted
    }
    self.preview = preview
  }
}
