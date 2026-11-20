import AtdAI
import AtdModel

/// Starting a result: a command, a request typed on the ✦ line, or ✦ 续写. What the result
/// replaces comes out of the field first; the first version then streams into the field as
/// marked text.
extension KeyboardSession {
  /// Runs a command on what it reads: the selection or the field for a rewrite, the copied
  /// message for a reply. With a draft in the field, a reply says what the draft says and the
  /// copied message is what it answers; the draft is what the reply replaces.
  public func run(_ command: Command) {
    defer { refresh() }
    refresh()
    guard canStart, CommandRanking.isSupported(command) else { return }
    let input: String
    let draft: String?
    let original: String
    switch command.input {
    case .copied:
      begin(.command(command))
      guard let message = readClipboard(), !message.trimmed.isEmpty else { return }
      draft = field.hasReadableText ? field.readable : nil
      original = takeField(all: draft != nil)
      input = message
    case .text:
      guard field.hasReadableText else { return }
      begin(.command(command))
      input = field.readable
      draft = nil
      original = takeField(all: command.output.action == .replace)
    default:
      begin(.command(command))
      input = ""
      draft = nil
      original = takeField(all: false)
    }
    let versions = Self.versions(of: command, input: input, draft: draft)
    present(
      Preview(
        command: command, original: original, versions: versions,
        adjustments: command.adjustments, documentID: document.documentIdentifier,
        autoAccept: !command.output.review))
  }

  /// 按要求写: a request typed on the ✦ line, applied to the selection or the field when they
  /// have text, or else written at the cursor. It makes one version (按要求).
  public func runRequest(_ request: String) {
    defer { refresh() }
    refresh()
    guard canStart, !request.trimmed.isEmpty else { return }
    begin(.request(request))
    let input = field.hasReadableText ? field.readable : ""
    let original = takeField(all: !input.isEmpty)
    let version = Preview.Version(
      label: .request, recipe: Recipe(kind: .request(request), input: input))
    present(
      Preview(
        command: nil, original: original, versions: [version],
        adjustments: BuiltinCommands.adjustments(), documentID: document.documentIdentifier))
  }

  /// ✦ 续写: sends the text before the cursor, now that it was tapped, and previews what
  /// follows it at the cursor.
  public func runContinuation() {
    defer { refresh() }
    refresh()
    let before = field.before
    guard canStart, !before.trimmed.isEmpty else { return }
    begin(.continuation)
    let original = takeField(all: false)
    let version = Preview.Version(
      label: .continuation, recipe: Recipe(kind: .continuation, input: before))
    present(
      Preview(
        command: nil, original: original, versions: [version],
        adjustments: BuiltinCommands.adjustments(), documentID: document.documentIdentifier))
  }

  /// 重试 after a failure: runs the same thing again on the field as it is now, which is as it
  /// was before the failed run.
  public func retry() {
    guard let lastRun, failure != nil else { return }
    failure = nil
    switch lastRun {
    case .command(let command): run(commands.first { $0.id == command.id } ?? command)
    case .request(let request): runRequest(request)
    case .continuation: runContinuation()
    }
  }

  /// The clipboard panel's 粘贴: reads the clipboard, which the system may ask about first.
  public func paste() {
    defer { refresh() }
    guard let text = readClipboard() else { return }
    write(text)
  }

  /// Writes a phrase or an earlier clipboard item at the cursor.
  public func insert(_ text: String) {
    defer { refresh() }
    write(text)
  }

  // MARK: Steps

  /// Nothing else is in progress, and there is a model to ask.
  private var canStart: Bool { canRunAI && preview == nil && conversion == nil }

  private func begin(_ run: Run) {
    endPredictions()
    taken = nil
    failure = nil
    lastRun = run
  }

  private func present(_ preview: Preview) {
    self.preview = preview
    generate(preview.selected)
  }

  /// One version per choice of the command's version option, the remembered choice first.
  private static func versions(of command: Command, input: String, draft: String?)
    -> [Preview.Version]
  {
    func recipe(_ values: [String: String]) -> Recipe {
      Recipe(
        kind: .command(command, values: values), input: input, draft: draft,
        choice: command.model)
    }
    guard let axis = command.versionAxis(hasDraft: draft != nil) else {
      return [Preview.Version(label: .command(command.name), recipe: recipe([:]))]
    }
    let choices = [axis.value] + axis.choices.filter { $0 != axis.value }
    return choices.map { choice in
      Preview.Version(label: .option(choice), recipe: recipe([axis.key: choice]))
    }
  }

  /// Takes what a result replaces out of the field and returns it: the selection, or with `all`
  /// the text the host shares around the cursor. Text beyond what the host shares is never
  /// touched.
  private func takeField(all: Bool) -> String {
    if !field.selection.isEmpty {
      document.deleteBackward()
      return field.selection
    }
    guard all else { return "" }
    document.moveCursor(by: field.after.utf16.count)
    for _ in 0..<(field.before.count + field.after.count) { document.deleteBackward() }
    return field.before + field.after
  }

  /// Reads the clipboard's text and remembers the copy as acted on.
  func readClipboard() -> String? {
    guard hasFullAccess else { return nil }
    seenChangeCount = clipboard.changeCount
    guard let text = clipboard.readText(), !text.isEmpty else { return nil }
    clipboardHistory.removeAll { $0 == text }
    clipboardHistory.insert(text, at: 0)
    if clipboardHistory.count > Self.historyLimit { clipboardHistory.removeLast() }
    return text
  }
}
