import AtdPinyin

/// The keys. While a result is on show they are its controls (IME.md): space takes it, delete
/// puts the original back, return sends what is shown, and typing on takes it and keeps writing.
/// While the ✦ line is open they type into the line.
extension KeyboardSession {
  /// A character key: lowercase letters compose pinyin; anything else is written as it is.
  public func type(_ character: Character) {
    defer { refresh() }
    beginKey()
    if ask != nil { return typeOnAskLine(character) }
    guard character.isPinyinLetter || (conversion != nil && character.continuesPinyin) else {
      return write(String(character))
    }
    takePreview(undoable: false)
    endPredictions()
    input.append(character)
    reconvert()
  }

  public func space() {
    defer { refresh() }
    beginKey()
    if ask != nil { return spaceOnAskLine() }
    if preview != nil { return accept() }
    if let top = conversion?.candidates.first { return pick(top) }
    endPredictions()
    document.insertText(" ")
  }

  public func delete() {
    defer { refresh() }
    beginKey()
    if ask != nil { return deleteOnAskLine() }
    if preview != nil { return revert() }
    if conversion != nil { return deleteLetter() }
    endPredictions()
    document.deleteBackward()
  }

  /// Return: 确认 commits the letters as typed; with a result on show it sends what is shown,
  /// but not while that is still streaming.
  public func pressReturn() {
    defer { refresh() }
    beginKey()
    if ask != nil { return returnOnAskLine() }
    if let preview {
      guard !preview.isStreaming else { return }
      takePreview(undoable: false)
      document.insertText("\n")
      return
    }
    if conversion != nil {
      return endComposition(committing: picks.map(\.text).joined() + rest)
    }
    endPredictions()
    document.insertText("\n")
  }

  /// Takes a candidate for the start of the letters; the rest stays marked to be read next.
  public func pick(_ candidate: PinyinCandidate) {
    defer { refresh() }
    if choose(candidate) { startPredictions() }
  }

  /// Writes a prediction after the committed text and offers what follows it.
  public func pickPrediction(_ word: String) {
    defer { refresh() }
    guard predictions != nil else { return }
    document.insertText(word)
    startPredictions()
  }

  /// Writes `text` at the cursor after settling what is in progress: the result on show is
  /// taken, and the composition takes its first candidate.
  func write(_ text: String) {
    takePreview(undoable: false)
    if let top = conversion?.candidates.first { choose(top) }
    endPredictions()
    document.insertText(text)
  }

  /// Every key ends what only made sense right after the last action: 撤销 and a failure line.
  func beginKey() {
    taken = nil
    failure = nil
  }

  // MARK: Composition

  /// How many typed letters the picks stand for.
  private var pickedLength: Int { picks.map(\.length).reduce(0, +) }

  /// The letters not picked yet.
  private var rest: String { String(input.dropFirst(pickedLength)) }

  /// Reads the letters after the picks and shows the picks and their spelling as marked text.
  private func reconvert() {
    let conversion = pinyin.convert(rest, limit: Self.candidateLimit)
    self.conversion = conversion
    document.setMarkedText(picks.map(\.text).joined() + conversion.spelling)
  }

  /// Picks `candidate`; once the picks cover every letter they are committed together. Returns
  /// whether they were.
  @discardableResult func choose(_ candidate: PinyinCandidate) -> Bool {
    guard conversion != nil else { return false }
    picks.append(candidate)
    guard pickedLength >= input.count else {
      reconvert()
      return false
    }
    learn(picks)
    endComposition(committing: picks.map(\.text).joined())
    return true
  }

  /// Deletes the last letter; when only picks are left, the last pick goes back to its letters.
  private func deleteLetter() {
    if input.count > pickedLength { input.removeLast() }
    if input.count == pickedLength, !picks.isEmpty { picks.removeLast() }
    if input.isEmpty { endComposition(committing: "") } else { reconvert() }
  }

  private func endComposition(committing text: String) {
    document.setMarkedText(text)
    document.unmarkText()
    input = ""
    picks = []
    conversion = nil
  }

  /// Remembers what was picked: a phrase put together from several picks becomes a word (a
  /// name, say), and a single word ranks higher next time. A sentence taken whole and letters
  /// kept as typed are not recorded.
  private func learn(_ picks: [PinyinCandidate]) {
    guard picks.allSatisfy({ $0.kind != .letters && !$0.syllables.isEmpty }),
      picks.count > 1 || picks.first?.kind == .word
    else { return }
    pinyin.learn(picks.map(\.text).joined(), syllables: picks.flatMap(\.syllables))
  }

  // MARK: Predictions

  /// After a commit the strip offers ✦ 续写 and what often follows, until typing pauses.
  func startPredictions() {
    let before = document.contextBeforeInput ?? ""
    let next = Predictions(
      offersContinuation: canRunAI && !before.trimmed.isEmpty,
      words: pinyin.associations(after: before, limit: Self.predictionLimit))
    guard next.offersContinuation || !next.words.isEmpty else { return endPredictions() }
    predictions = next
    predictionTimer?.cancel()
    predictionTimer = Task { [weak self, sleep = self.sleep] in
      do { try await sleep(Self.predictionPause) } catch { return }
      self?.predictions = nil
    }
  }

  func endPredictions() {
    predictions = nil
    predictionTimer?.cancel()
    predictionTimer = nil
  }
}
