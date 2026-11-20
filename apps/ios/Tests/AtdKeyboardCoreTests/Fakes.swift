import AtdAI
import AtdModel
import AtdPinyin
import Foundation
import Synchronization
import Testing

@testable import AtdKeyboardCore

/// One mapping of the shipped lexicon for every test.
private let shipped = Result { try Lexicon.bundled() }

/// A chat app's field: text around the cursor, a selection, marked text at the cursor, and a
/// return that sends what the field holds and empties it.
@MainActor
final class FakeDocument: DocumentEditor {
  var before: String
  var selection: String
  var after: String
  var marked = ""
  var documentIdentifier = UUID()
  /// What return sent, in order.
  private(set) var sent: [String] = []

  init(_ before: String = "", selection: String = "", after: String = "") {
    self.before = before
    self.selection = selection
    self.after = after
  }

  var text: String { before + marked + selection + after }
  var contextBeforeInput: String? { before + marked }
  var contextAfterInput: String? { after }
  var selectedText: String? { selection.isEmpty ? nil : selection }
  var hasText: Bool { !text.isEmpty }

  func insertText(_ text: String) {
    if !marked.isEmpty { Issue.record("insertText over marked text \(marked)") }
    selection = ""
    guard text != "\n" else {
      sent.append(before + after)
      before = ""
      after = ""
      return
    }
    before += text
  }

  func deleteBackward() {
    if !selection.isEmpty {
      selection = ""
    } else if !before.isEmpty {
      before.removeLast()
    }
  }

  func moveCursor(by offset: Int) {
    var remaining = offset
    while remaining > 0, let next = after.first {
      remaining -= next.utf16.count
      before.append(after.removeFirst())
    }
  }

  func setMarkedText(_ text: String) {
    selection = ""
    marked = text
  }

  func unmarkText() {
    before += marked
    marked = ""
  }
}

@MainActor
final class FakeClipboard: Clipboard {
  private(set) var changeCount = 0
  private(set) var text: String?
  /// How often the text was read, each a possible paste prompt.
  private(set) var reads = 0

  var hasText: Bool { text != nil }

  func readText() -> String? {
    reads += 1
    return text
  }

  func copy(_ text: String) {
    self.text = text
    changeCount += 1
  }
}

/// Answers requests from a script: deltas, a failure, or a stream held open for the test to
/// drive. Without a script it answers 结果.
final class ScriptedGenerator: TextGenerating {
  enum Reply: Sendable {
    case text([String])
    case failure(ModelFailure)
    case held
  }

  struct Call: Sendable {
    var request: ModelRequest
    var choice: ModelChoice
  }

  private struct State {
    var replies: [Reply] = []
    var calls: [Call] = []
    var held: AsyncThrowingStream<String, any Error>.Continuation?
  }

  private let state = Mutex(State())

  func reply(_ replies: Reply...) {
    state.withLock { $0.replies += replies }
  }

  var calls: [Call] { state.withLock { $0.calls } }

  func stream(_ request: ModelRequest, choice: ModelChoice) -> AsyncThrowingStream<
    String, any Error
  > {
    let (stream, continuation) = AsyncThrowingStream<String, any Error>.makeStream()
    let reply = state.withLock { state in
      state.calls.append(Call(request: request, choice: choice))
      return state.replies.isEmpty ? Reply.text(["结果"]) : state.replies.removeFirst()
    }
    switch reply {
    case .text(let deltas):
      for delta in deltas { continuation.yield(delta) }
      continuation.finish()
    case .failure(let failure):
      continuation.finish(throwing: failure)
    case .held:
      state.withLock { $0.held = continuation }
    }
    return stream
  }

  /// Sends a delta on the stream held open.
  func send(_ delta: String) {
    _ = state.withLock { $0.held }?.yield(delta)
  }

  func finish() {
    state.withLock { $0.held }?.finish()
  }
}

/// A session on a fake field and clipboard, with the built-in commands named in Chinese (so the
/// ✦ line finds them by pinyin whatever language the tests run in) and two phrases.
@MainActor
struct Harness {
  let document: FakeDocument
  let clipboard: FakeClipboard
  let generator: ScriptedGenerator
  let session: KeyboardSession<PinyinEngine>

  init(_ document: FakeDocument = FakeDocument(), fullAccess: Bool = true, model: Bool = true)
    throws
  {
    self.document = document
    clipboard = FakeClipboard()
    generator = ScriptedGenerator()
    session = KeyboardSession(
      document: document, clipboard: clipboard, pinyin: PinyinEngine(lexicon: try shipped.get()),
      generator: generator, sleep: { _ in })
    session.commands = Self.commands
    session.phrases = Self.phrases
    session.hasFullAccess = fullAccess
    session.hasModel = model
    session.refresh()
  }

  static let names = [
    BuiltinCommands.polishID: "润色", BuiltinCommands.replyID: "帮我回复",
    BuiltinCommands.translateID: "翻译", BuiltinCommands.shortenID: "缩短",
  ]

  static var commands: [Command] {
    BuiltinCommands.all().map { command in
      var command = command
      command.name = names[command.id] ?? command.name
      return command
    }
  }

  static let phrases = [
    Phrase(id: "arrived", title: "到了", text: "我到了，在门口等你"),
    Phrase(id: "address", title: "地址", text: "滨江路 88 号"),
  ]

  func command(_ id: String) -> Command {
    Self.commands.first { $0.id == id }!
  }

  func type(_ letters: String) {
    for letter in letters { session.type(letter) }
  }

  /// Waits for the result being made to finish streaming.
  func streamed() async {
    await session.streaming?.value
  }

  /// Lets the session take deltas sent on a held stream.
  func settle() async {
    for _ in 0..<20 { await Task.yield() }
  }
}

extension Strip {
  var tools: Tools? { if case .tools(let tools) = self { tools } else { nil } }
  var preview: Preview? { if case .preview(let preview) = self { preview } else { nil } }
  var ask: AskStrip? { if case .ask(let ask) = self { ask } else { nil } }
  var predictions: Predictions? {
    if case .predictions(let predictions) = self { predictions } else { nil }
  }
  var candidates: [PinyinCandidate]? {
    if case .candidates(let candidates) = self { candidates } else { nil }
  }
}
