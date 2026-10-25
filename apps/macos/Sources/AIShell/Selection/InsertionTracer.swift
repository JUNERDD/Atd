import AICore
import ApplicationServices

/// Draws the typing trace of a paced paste (``InsertionTrace``) while ``ClipboardPaste`` types:
/// each confirmed chunk asks the field where it landed and hands the answer to the overlay
/// (``InsertionTraceOverlay``); a field that gives no character bounds gets no trace.
/// ``InsertionTraceQueue`` decides when a read runs, so the write never waits for one. The reads still share the target's main thread with the write's caret
/// reads (``FieldCaret``), so their cost is bounded rather than nil: one read at a time, run to
/// its end off the main thread and stopping itself at ``readLimit``, and no sooner than
/// ``readSpacing`` after the one before. A read that fails or runs late draws nothing.
final class InsertionTracer {
  /// How long one read may take; past it, it sends no further message and draws nothing.
  private static let readLimit: Duration = .milliseconds(150)
  /// The least time from one read's start to the next one's; runs in between merge.
  private static let readSpacing: Duration = .milliseconds(40)

  private let reader: InsertionTraceReader
  private let overlay: InsertionTraceOverlay
  private var queue = InsertionTraceQueue()
  private var cancelled = false
  /// The field's frame; nil until a read reported it (or that the field has none).
  private var field: CGRect??

  /// The trace of a write into `target`; under reduced motion (`reducesMotion`) it keeps the
  /// washes and leaves out the moving glow.
  init(target: WriteTarget, reducesMotion: Bool, isCurrent: @escaping () -> Bool = { true }) {
    reader = InsertionTraceReader(target: target)
    overlay = InsertionTraceOverlay(reducesMotion: reducesMotion, isCurrent: isCurrent)
  }

  /// `text` went in: the caret moved from `start` to `end`.
  func inserted(_ text: String, from start: Int, to end: Int) {
    perform(queue.add(InsertionTrace.Run(text, from: start, to: end)))
  }

  /// The write ended, typed out or not: the trace fades once the reads still due are drawn.
  func finish() {
    perform(queue.finish())
  }

  func cancel() {
    cancelled = true
    overlay.cancel()
  }

  private func perform(_ step: InsertionTraceQueue.Step) {
    guard !cancelled else { return }
    switch step {
    case .wait:
      break
    case .close:
      overlay.finish()
    case .read(let run):
      let reader = reader
      let known = field
      Task {
        let start = ContinuousClock.now
        let deadline = start + Self.readLimit
        // Awaited to its end, unlike a ``Deadline``, so no read outlives the queue's turn.
        let marks = await Task.detached(priority: .userInitiated) {
          reader.read(run, field: known, until: deadline)
        }.value
        guard !cancelled else { return }
        if let marks {
          if field == nil { field = .some(marks.field) }
          overlay.show(anchor: marks.anchor, wash: marks.wash, field: marks.field)
        }
        try? await Task.sleep(until: start + Self.readSpacing)
        perform(queue.readDone())
      }
    }
  }
}

/// The Accessibility reads behind the trace: the bounds of a run's last character (or of the caret,
/// from web content's text markers, when the field gives no character bounds) and of the run
/// itself, line by line when it spans lines, each without its trailing line breaks. Each message is
/// bounded by the messaging timeout, and none is sent past the read's deadline; a field that
/// times out or vanished, or a read past its deadline, reads as no marks. Blocking;
/// ``InsertionTracer`` runs it off the main thread.
nonisolated struct InsertionTraceReader: Sendable {
  /// Rects in Quartz points, each one ``InsertionTrace/admits(_:within:)`` took.
  struct Marks: Sendable {
    var field: CGRect?
    var anchor: CGRect?
    var wash: [CGRect] = []
  }

  let target: WriteTarget

  /// A read past its deadline, which sends no further message.
  private struct Late: Error {}

  /// The marks of `run`, read before `deadline`; `field` is the field's frame when an earlier
  /// read got it (`.some(nil)` when the field has none), else it is read now.
  func read(_ run: InsertionTrace.Run, field: CGRect??, until deadline: ContinuousClock.Instant)
    -> Marks?
  {
    let element = target.element
    AXUIElementSetMessagingTimeout(element, SelectionReader.messagingTimeout)
    let ask = Ask(element: element, deadline: deadline)
    do {
      var marks = Marks()
      if let field {
        marks.field = field
      } else {
        marks.field = try ask { try AXField.frame(of: $0) }
      }
      if let anchor = run.anchor, let rect = try ask({ try AXField.bounds(of: anchor.cf, in: $0) }),
        InsertionTrace.admits(rect, within: marks.field)
      {
        marks.anchor = rect
      } else if let caret = try ask({ try AXField.caretBounds(of: $0) }),
        InsertionTrace.admits(caret, within: marks.field)
      {
        marks.anchor = caret
      }
      marks.wash = try wash(run, lineHeight: marks.anchor?.height, field: marks.field, ask: ask)
      return ContinuousClock.now < deadline ? marks : nil
    } catch {
      return nil
    }
  }

  /// The run's bounds when it sits on one line, else the bounds of its part on each line it
  /// touches; nothing when the field does not say where its lines are.
  private func wash(_ run: InsertionTrace.Run, lineHeight: CGFloat?, field: CGRect?, ask: Ask)
    throws -> [CGRect]
  {
    guard let span = run.trimmed(run.span) else { return [] }
    if let lineHeight, let whole = try ask({ try AXField.bounds(of: span.cf, in: $0) }),
      !InsertionTrace.spansLines(whole, lineHeight: lineHeight)
    {
      return InsertionTrace.admits(whole, within: field) ? [whole] : []
    }
    guard let first = try ask({ try AXField.line(at: span.location, in: $0) }),
      let last = try ask({ try AXField.line(at: span.end - 1, in: $0) }), last >= first
    else { return [] }
    var lines: [InsertionTrace.Span] = []
    for line in max(first, last - InsertionTrace.maxWashLines + 1)...last {
      guard let range = try ask({ try AXField.range(ofLine: line, in: $0) }) else { return [] }
      lines.append(.init(location: range.location, length: range.length))
    }
    var rects: [CGRect] = []
    for slice in InsertionTrace.slices(of: span, lines: lines) {
      guard let part = run.trimmed(slice) else { continue }
      if let rect = try ask({ try AXField.bounds(of: part.cf, in: $0) }),
        InsertionTrace.admits(rect, within: field)
      {
        rects.append(rect)
      }
    }
    return rects
  }

  /// Sends one message to the field unless the read is past its deadline; a timed-out or vanished
  /// field (``AXFieldError``) or a late read throws, which ends the read without marks.
  private struct Ask {
    let element: AXUIElement
    let deadline: ContinuousClock.Instant

    func callAsFunction<T>(_ message: (AXUIElement) throws -> T) throws -> T {
      guard ContinuousClock.now < deadline else { throw Late() }
      return try message(element)
    }
  }
}

extension InsertionTrace.Span {
  nonisolated var cf: CFRange { CFRange(location: location, length: length) }
}
