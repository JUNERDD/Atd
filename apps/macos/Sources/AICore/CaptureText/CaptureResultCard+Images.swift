import Foundation

/// The cards of runs whose answer goes on the image (decision D2): steps and highlighter marks
/// listed beside their badges (Reapply in Restore's place once they are off the image again), and
/// an answer waiting for review while it previews on the image (decision D12), with a body for its
/// destination.
extension CaptureResultCard {
  static func marks(_ run: CaptureTextRun, document: AnnotationDocument) -> Content {
    let numbers = run.stepNumbers(in: document)
    let entries = entries(of: run, numbers: numbers)
    let highlighted = run.items.indices.filter { run.items[$0].tool == .highlight }
      .reduce(0) { count, index in
        count + (run.applied[index] ?? []).filter { document[$0] != nil }.count
      }
    var landed: [Note] = []
    if let first = numbers.values.min(), let last = numbers.values.max() {
      landed.append(.steps(first: first, last: last))
    }
    if highlighted > 0 { landed.append(.highlights(highlighted)) }
    let restored = !run.phase.running && run.restored(in: document)
    if restored { landed = [.restored] }
    let empty = run.items.isEmpty && run.lead.isEmpty
    let phase = run.shownPhase
    let notes: [Note] =
      switch phase {
      case .thinking: empty ? [.reading] : [.writing]
      case .streaming: [.writing]
      case .done: landed.isEmpty ? [.nothing] : landed
      case .stopped: [.stopped] + landed
      case .failed: [.failed]
      }
    let body: Body =
      phase == .thinking && empty
      ? .skeleton
      : !entries.isEmpty || !run.lead.isEmpty
        ? .items(lead: run.lead, entries)
        : phase == .failed && !run.text.isEmpty ? .answer(run.text) : .none
    let copyText = notesText(lead: run.lead, entries: entries)
    return Content(
      notes: notes, body: body,
      actions: [restored ? .reapply : .revert] + (copyText == nil ? [] : [.copy]) + [
        .copyScreenshot
      ],
      primary: .copyScreenshot, busy: run.phase.running, copyText: copyText,
      hints: [run.phase.running ? .stop : .close])
  }

  /// A run whose answer waits for review: the version shown, listed as it previews on the image
  /// over `document`, with Apply (⌘↩) and Discard (Escape); or, once the run ended without a
  /// version to apply, what became of it. The card's ``versions`` page through the versions.
  static func review(_ run: CaptureTextRun, document: AnnotationDocument) -> Content {
    guard let state = run.review else { return ended(run) }
    let pending = state.pending != nil || run.phase.running
    let body: Body
    let copyText: String?
    let note: Note
    if run.destination == .replace {
      let rows = replacements(of: run)
      body = .replacements(rows)
      copyText = replacedText(rows)
      note = .review(version: state.version, count: state.count)
    } else {
      let entries = entries(of: run, numbers: previewNumbers(of: run, over: document))
      body = .items(lead: run.lead, entries)
      copyText = notesText(lead: run.lead, entries: entries)
      note = .reviewMarks(version: state.version, count: state.count)
    }
    return Content(
      notes: [pending ? .writing : note], body: body, reviewing: true,
      actions: (copyText == nil ? [] : [.copy]) + [.apply], primary: .apply, busy: pending,
      copyText: copyText, hints: [pending ? .stop : .discard])
  }

  /// A run under review that ended without a version to apply (stopped before its first version
  /// had a piece, or failed): nothing lands, and the card says so, with what the run said.
  private static func ended(_ run: CaptureTextRun) -> Content {
    let note: Note =
      switch run.phase {
      case .thinking: .reading
      case .streaming: .writing
      case .done: .nothing
      case .stopped: .stopped
      case .failed: .failed
      }
    return Content(
      notes: [note], body: run.phase == .failed && !run.text.isEmpty ? .answer(run.text) : .none,
      actions: [], primary: nil, busy: run.phase.running, copyText: nil,
      hints: [run.phase.running ? .stop : .close])
  }

  /// The items of an answer about paragraphs as the card lists them: each step with the number
  /// its badge shows (`numbers`, by item index) or why it has none (deleted, not landed yet), and
  /// each highlighter mark that has a note.
  private static func entries(of run: CaptureTextRun, numbers: [Int: Int]) -> [Entry] {
    run.items.indices.compactMap { index -> Entry? in
      let item = run.items[index]
      let text = item.text.trimmingCharacters(in: .whitespacesAndNewlines)
      let marker: Entry.Marker
      switch item.tool {
      case .step:
        marker =
          numbers[index].map { .number($0) } ?? (run.applied[index] != nil ? .gone : .pending)
      case .highlight:
        guard !text.isEmpty else { return nil }
        marker = .highlight
      case .replace:
        return nil
      }
      return Entry(id: index, paragraph: item.paragraph, marker: marker, text: text)
    }
  }

  /// The numbers the preview's step badges show by item index: they follow the steps already on
  /// the image, in the answer's order, as they would once applied.
  private static func previewNumbers(of run: CaptureTextRun, over document: AnnotationDocument)
    -> [Int: Int]
  {
    var next = document.annotations.reduce(0) { count, annotation in
      if case .step = annotation.shape { count + 1 } else { count }
    }
    var numbers: [Int: Int] = [:]
    for index in run.previewed where run.items[index].tool == .step {
      next += 1
      numbers[index] = next
    }
    return numbers
  }

  /// An explanation's words as Copy copies them: the lead, then `n. note` per item.
  private static func notesText(lead: String, entries: [Entry]) -> String? {
    let lines = entries.enumerated().map { offset, entry in
      switch entry.marker {
      case .number(let number): "\(number). \(entry.text)"
      case .gone, .pending: "\(offset + 1). \(entry.text)"
      case .highlight: "• \(entry.text)"
      }
    }
    let text = ([lead.trimmingCharacters(in: .whitespacesAndNewlines)] + lines)
      .filter { !$0.isEmpty }.joined(separator: "\n")
    return text.isEmpty ? nil : text
  }
}
