import AtdModel
import AtdPinyin

/// The ✦ line: one instruction line above the strip that the same keys type into. Commands and
/// phrases are found by pinyin (fy → 翻译); anything else runs as a request of its own.
extension KeyboardSession {
  /// Opens the line; not while composing in the field.
  public func openAsk() {
    defer { refresh() }
    guard ask == nil, conversion == nil else { return }
    endPredictions()
    failure = nil
    ask = AskLine()
  }

  public func closeAsk() {
    ask = nil
  }

  /// Takes a candidate of the line's own composition.
  public func pickOnAsk(_ candidate: PinyinCandidate) {
    guard var line = ask else { return }
    line.text += candidate.text
    line.letters = String(line.letters.dropFirst(candidate.length))
    ask = converted(line)
  }

  /// Runs a suggestion of the line and closes it.
  public func act(_ suggestion: AskSuggestion) {
    defer { refresh() }
    ask = nil
    switch suggestion {
    case .command(let chip): run(chip.command)
    case .phrase(let phrase): write(phrase.text)
    case .write(let request): runRequest(request)
    case .refine(let request, _): refine(request)
    }
  }

  // MARK: Keys on the line

  func typeOnAskLine(_ character: Character) {
    guard var line = ask else { return }
    if character.isPinyinLetter || (!line.letters.isEmpty && character.continuesPinyin) {
      line.letters.append(character)
    } else {
      settle(&line)
      line.text.append(character)
    }
    ask = converted(line)
  }

  func spaceOnAskLine() {
    guard var line = ask else { return }
    if let top = line.conversion?.candidates.first { return pickOnAsk(top) }
    line.text.append(" ")
    ask = line
  }

  func deleteOnAskLine() {
    guard var line = ask else { return }
    if !line.letters.isEmpty {
      line.letters.removeLast()
    } else if !line.text.isEmpty {
      line.text.removeLast()
    }
    ask = converted(line)
  }

  /// Return commits the line's letters as typed (确认), then runs the first suggestion (生成).
  func returnOnAskLine() {
    guard var line = ask else { return }
    guard line.letters.isEmpty else {
      line.text += line.letters
      line.letters = ""
      ask = converted(line)
      return
    }
    guard !line.text.trimmed.isEmpty, let first = askStrip(line).suggestions.first else { return }
    act(first)
  }

  /// Ends the line's composition with its first candidate, which reads every letter.
  private func settle(_ line: inout AskLine) {
    guard let top = line.conversion?.candidates.first else { return }
    line.text += top.text
    line.letters = ""
  }

  private func converted(_ line: AskLine) -> AskLine {
    var line = line
    line.conversion =
      line.letters.isEmpty ? nil : pinyin.convert(line.letters, limit: Self.candidateLimit)
    return line
  }

  // MARK: Suggestions

  func askStrip(_ line: AskLine) -> AskStrip {
    let purpose: AskStrip.Purpose =
      preview != nil ? .refine : field.hasReadableText ? .rewrite : .write
    return AskStrip(
      purpose: purpose, text: line.text, letters: line.letters,
      candidates: line.conversion?.candidates ?? [], hits: hits(for: line.letters),
      suggestions: suggestions(for: line.text.trimmed))
  }

  /// While a result is on show: the quick refinements, after the typed one. Otherwise, with
  /// nothing typed, the strip's commands (or the phrases when there are none); with text, a
  /// command it names exactly and then 按要求写, or else 按要求写 and the commands it partly
  /// names; then the phrases it names.
  private func suggestions(for query: String) -> [AskSuggestion] {
    if let preview {
      let quick = preview.adjustments.map { AskSuggestion.refine($0, typed: false) }
      return query.isEmpty ? quick : [.refine(query, typed: true)] + quick
    }
    let chips = chips
    guard !query.isEmpty else {
      return chips.isEmpty ? phrases.map(AskSuggestion.phrase) : chips.map(AskSuggestion.command)
    }
    let exact = chips.filter { $0.command.name == query }
    let partial = chips.filter {
      query.contains($0.command.name) || $0.command.name.contains(query)
    }
    let named = phrases.filter { query.contains($0.title) || $0.title.contains(query) }
    let write = canRunAI ? [AskSuggestion.write(query)] : []
    let commands =
      exact.isEmpty
      ? write + partial.map(AskSuggestion.command) : exact.map(AskSuggestion.command) + write
    return commands + named.map(AskSuggestion.phrase)
  }

  /// Commands and phrases the letters spell. Commands only while nothing is on show, since the
  /// line then refines the result.
  private func hits(for letters: String) -> [AskSuggestion] {
    let commands = preview == nil ? chips.filter { spells(letters, $0.command.name) } : []
    let phrases = phrases.filter { spells(letters, $0.title) }
    return commands.map(AskSuggestion.command) + phrases.map(AskSuggestion.phrase)
  }

  private func spells(_ letters: String, _ name: String) -> Bool {
    NameMatching.spells(letters, name: name, readings: pinyin.readings(of: name))
  }
}
