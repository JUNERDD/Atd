import AIComputerDriverKit
import AICore
import AppKit

/// Writing text with the local typing preferences (``ComputerTypingOptions``): in one write, or,
/// with typing shown and the field's caret readable, in chunks paced like typing, each one's
/// effect on the field confirmed before the next goes out, with the new text highlighted as it
/// lands. The first chunk climbs the step's ladder; later chunks take the rung it settled on and
/// never repeat its preparation (a focus, a caret click). A chunk that cannot be confirmed stops
/// the write without retrying or repeating a prefix.
extension NativeEngine {
  func typingField(_ ref: TargetRefWire, element: DriverElement?, context: EngineStepContext)
    async -> NativeTypingField?
  {
    guard context.typing.typing || context.typing.animation, let place = try? observedRead(ref),
      element == nil || element?.frame != nil
    else { return nil }
    let expected = element?.frame?.cgRect
    let role = element?.role
    let field = await NativeTargetProbe.detached {
      NativeTypingField.find(
        pid: pid_t(place.pid), windowId: place.windowId, expected: expected, role: role)
    }
    guard let field, place.cropFrame?.contains(field.frame) != false else { return nil }
    return field
  }

  /// Writes `text` (`replacing`: the field's whole value, else at the caret) down the ladder
  /// `ladder` builds for a piece of it.
  func write(
    _ text: String, replacing: Bool, ladder: (String) -> NativeLadder,
    field: NativeTypingField?, kind: ComputerStepKind, _ write: Write
  ) async throws(ComputerFailure) -> Delivered {
    let context = write.context
    let initial = await NativeTargetProbe.detached { field?.state() }
    let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    var pace = TypingPace(
      text, typing: context.typing.typing, reduceMotion: reduced, caretTracked: initial != nil)
    let trace = typingTrace(field, ref: write.ref, context: context, reduced: reduced)
    var completed = false
    defer { if completed { trace?.finish() } else { trace?.cancel() } }
    let start = ContinuousClock.now
    var expected = initial
    var prefix = ""
    var delivered: Delivered?
    do throws(ComputerFailure) {
      while let chunk = pace.next(at: .now - start) {
        if start + chunk.due > .now { try? await Task.sleep(until: start + chunk.due) }
        try dispatchable(context)
        if ContinuousClock.now >= context.deadline {
          throw ComputerFailure(.timeout, "The typing deadline passed.")
        }
        if let block = ComputerScreenState.writeBlock() { throw block }
        if pace.isPaced, let field {
          guard await NativeTargetProbe.detached({ field.state() }) == expected else {
            throw ComputerFailure(.targetChanged, "The text field changed during typing.")
          }
          try await requireUnblocked(write.ref, surface: context.surfaceRefId)
        }
        prefix += chunk.text
        let piece = replacing ? prefix : chunk.text
        if var sent = delivered {
          guard let next = Self.continuation(of: sent.rung, with: piece) else {
            throw ComputerFailure(
              .engineFailed, "The write's route takes no further text.", mayHaveDispatched: true)
          }
          if case .success(let receipt) = try await deliver(
            next, kind: kind, place: write.place, ref: write.ref, context: context,
            committed: true)
          {
            sent.receipts.append(receipt)
          }
          delivered = sent
        } else {
          delivered = try await climb(
            ladder(piece), kind: kind, place: write.place, ref: write.ref, context: context)
        }
        let after = await NativeTargetProbe.detached { field?.state() }
        let from = replacing ? prefix.utf16.count - chunk.text.utf16.count : expected?.location
        let confirmed = confirms(
          chunk.text, prefix: prefix, replacing: replacing, before: expected, after: after)
        if confirmed, let from {
          trace?.inserted(chunk.text, from: from, to: from + chunk.text.utf16.count)
        }
        if pace.isPaced, !chunk.isLast, !confirmed {
          throw ComputerFailure(
            .targetChanged, "The last typing chunk could not be confirmed; no more text was sent.")
        }
        expected = after
      }
    } catch {
      var failure = error
      failure.mayHaveDispatched = failure.mayHaveDispatched || delivered?.dispatched == true
      throw failure
    }
    guard let delivered else {
      return try await climb(
        ladder(text), kind: kind, place: write.place, ref: write.ref, context: context)
    }
    completed = true
    return delivered
  }

  /// The primitive that writes `piece` on the rung a write's first chunk took: the next text at
  /// the caret, or the whole value so far.
  static func continuation(of rung: NativeRung, with piece: String) -> DriverPrimitive? {
    switch rung.primitives.last {
    case .axInsertText(let element, _, _)?:
      .axInsertText(element: element, text: piece, replaceRange: nil)
    case .axSetValue(let element, _)?: .axSetValue(element: element, value: piece)
    case .text?: .text(text: piece)
    default: nil
    }
  }

  private func confirms(
    _ chunk: String, prefix: String, replacing: Bool,
    before: NativeTypingField.State?, after: NativeTypingField.State?
  ) -> Bool {
    guard let before, let after else { return false }
    if replacing { return after.value == prefix }
    let value = (before.value as NSString).replacingCharacters(
      in: NSRange(location: before.location, length: before.length), with: chunk)
    return after.value == value && after.length == 0
      && after.location == before.location + chunk.utf16.count
  }

  private func typingTrace(
    _ field: NativeTypingField?, ref: TargetRefWire, context: EngineStepContext, reduced: Bool
  ) -> InsertionTracer? {
    guard context.typing.animation, let field,
      let geometry = NativeTargetProbe.screenGeometry(field.frame),
      let placement = ComputerScreenState.pointerPlacement(geometry, ref: ref)
    else { return nil }
    return InsertionTracer(
      target: field.target, reducesMotion: reduced,
      isCurrent: {
        !context.isStopping() && ContinuousClock.now < context.deadline
          && ComputerScreenState.pointerPlacement(geometry, ref: ref) == placement
      })
  }
}
