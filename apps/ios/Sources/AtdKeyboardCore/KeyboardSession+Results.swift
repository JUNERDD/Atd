import AtdAI
import AtdModel

/// The result on show: its versions, streaming into the field, and taking or undoing it.
extension KeyboardSession {
  /// Shows another version. One that was never made is made now and kept; a version still
  /// streaming stops and is made again if picked later.
  public func select(version index: Int) {
    defer { refresh() }
    guard var preview, preview.versions.indices.contains(index), index != preview.selected
    else { return }
    if let busy = preview.versions.firstIndex(where: { $0.state == .streaming }) {
      streaming?.cancel()
      streaming = nil
      preview.versions[busy].text = ""
      preview.versions[busy].state = .notStarted
    }
    preview.selected = index
    preview.acceptsWhenDone = preview.autoAccept
    self.preview = preview
    if preview.shown.state == .complete {
      document.setMarkedText(preview.shown.text)
    } else {
      generate(index)
    }
  }

  /// ↻ 换一批: makes the version on show again.
  public func regenerate() {
    defer { refresh() }
    guard let preview, preview.canRegenerate else { return }
    generate(preview.selected)
  }

  /// Asks for a change to the version on show (再短点, or what was typed on the ✦ line); the
  /// answer is a new version, on show.
  public func refine(_ request: String) {
    defer { refresh() }
    guard var preview, !preview.isStreaming, !request.trimmed.isEmpty else { return }
    let shown = preview.shown
    var recipe =
      shown.recipe
      ?? Recipe(
        kind: .request(request), input: preview.original,
        choice: preview.command?.model ?? .appDefault)
    if shown.recipe != nil {
      recipe.refinements.append(CommandPrompt.Refinement(result: shown.text, request: request))
    }
    preview.versions.append(Preview.Version(label: .refinement(request), recipe: recipe))
    preview.selected = preview.versions.count - 1
    preview.acceptsWhenDone = preview.autoAccept
    self.preview = preview
    generate(preview.selected)
  }

  /// 用这个: takes the version on show; while it is streaming, it is taken once complete. 撤销
  /// then leads the strip.
  public func accept() {
    defer { refresh() }
    guard var preview else { return }
    guard !preview.isStreaming else {
      preview.acceptsWhenDone = true
      self.preview = preview
      return
    }
    takePreview(undoable: true)
  }

  /// 还原: puts back what the preview replaced.
  public func revert() {
    defer { refresh() }
    guard let preview else { return }
    streaming?.cancel()
    streaming = nil
    document.setMarkedText(preview.original)
    document.unmarkText()
    self.preview = nil
  }

  /// 撤销: right after a result was taken, puts back what it replaced, as long as the result is
  /// still right before the cursor in the same field.
  public func undo() {
    defer { refresh() }
    guard let taken else { return }
    self.taken = nil
    guard document.documentIdentifier == taken.documentID,
      (document.contextBeforeInput ?? "").hasSuffix(taken.result)
    else { return }
    for _ in 0..<taken.result.count { document.deleteBackward() }
    if !taken.original.isEmpty { document.insertText(taken.original) }
  }

  /// Commits what the field shows and ends the preview; a stream still running stops where it
  /// is. When nothing is shown yet, the original goes back instead.
  func takePreview(undoable: Bool) {
    guard let preview else { return }
    let shown = preview.shown
    guard !shown.text.isEmpty else { return revert() }
    streaming?.cancel()
    streaming = nil
    document.unmarkText()
    self.preview = nil
    if undoable, shown.recipe != nil {
      taken = Taken(
        original: preview.original, result: shown.text, documentID: preview.documentID,
        name: preview.command?.name)
    }
  }

  // MARK: Streaming

  /// Makes version `index` and streams it into the field while it is on show.
  func generate(_ index: Int) {
    guard var preview, let recipe = preview.versions[index].recipe else { return }
    streaming?.cancel()
    preview.versions[index].text = ""
    preview.versions[index].state = .streaming
    self.preview = preview
    if index == preview.selected { document.setMarkedText("") }
    let answer = generator.stream(recipe.request, choice: recipe.choice)
    streaming = Task { [weak self] in
      var text = ""
      do {
        for try await delta in answer {
          if Task.isCancelled { return }
          text += delta
          self?.received(text, for: index)
        }
        if Task.isCancelled { return }
        self?.completed(text, for: index)
      } catch {
        if Task.isCancelled { return }
        self?.failed(error)
      }
    }
  }

  private func received(_ text: String, for index: Int) {
    guard var preview else { return }
    preview.versions[index].text = text.trimmed
    self.preview = preview
    if index == preview.selected { document.setMarkedText(preview.versions[index].text) }
  }

  private func completed(_ text: String, for index: Int) {
    streaming = nil
    guard !text.trimmed.isEmpty else { return failed(ModelFailure.unreadable(detail: nil)) }
    received(text, for: index)
    guard var preview else { return }
    preview.versions[index].state = .complete
    self.preview = preview
    if index == preview.selected, preview.acceptsWhenDone { accept() }
    refresh()
  }

  /// A failed request puts the field back as it was and says why, with 重试 when it may help.
  private func failed(_ error: any Error) {
    streaming = nil
    guard !(error is CancellationError) else { return }
    revert()
    failure = error as? ModelFailure ?? .unreadable(detail: String(describing: error))
  }
}
