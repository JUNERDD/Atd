import AIComputerDriverKit
import AICore
import Foundation

/// Conditions on a native target, each read afresh from the surface the latest observation
/// showed; never while the Mac is locked, when accessibility shows only a stub of the app.
extension NativeEngine {
  func validateConditions(_ action: ComputerActionWire, baseline: ObservationWire)
    async throws(ComputerFailure)
  {
    targets[action.targetRefId]?.regionalBaselines = []
    let conditions =
      action.steps.compactMap { step -> ComputerConditionWire? in
        if case .wait(let condition, _) = step { return condition }
        return nil
      } + [action.postcondition].compactMap { $0 }
    for condition in conditions {
      switch condition {
      case .newText(let locator, let pattern, let region):
        if let pattern, (try? NSRegularExpression(pattern: pattern)) == nil {
          throw ComputerFailure(.unsupported, "The newText pattern is not a valid expression.")
        }
        if let region {
          guard locator == nil else {
            throw ComputerFailure(.unsupported, "newText cannot combine locator and region.")
          }
          try await prepareRegion(region, action: action, baseline: baseline)
        }
        if let locator {
          guard let observed = targets[action.targetRefId]?.observation else {
            throw ComputerFailure(.staleObservation, "Observe the target again; nothing was sent.")
          }
          if case .failure(let failure) = observed.resolve(locator) {
            throw ComputerFailure(
              failure.code,
              "The newText locator must identify one existing accessibility element, not OCR text. \(failure.message) For screen text use newText without locator after observing the relevant region with text enabled; nothing was sent."
            )
          }
        }
        if locator == nil, region == nil, baseline.text == nil, baseline.elements.isEmpty {
          throw ComputerFailure(
            .unsupported,
            "Observe with screenshot and text before checking newly visible screen text; nothing was sent."
          )
        }
      case .menuItemAvailable:
        guard baseline.menuItems != nil else {
          throw ComputerFailure(
            .unsupported,
            "Observe the native application menu before checking it; nothing was sent.")
        }
      case .urlMatches:
        throw ComputerFailure(.unsupported, "Native targets have no URL; nothing was sent.")
      case .valueEquals, .enabled, .textAppears:
        break
      }
    }
    guard action.steps.contains(where: { $0.effect == .invoke || $0.effect == .submit }),
      let condition = action.postcondition
    else { return }
    if case .menuItemAvailable(let path) = condition,
      baseline.menuItems?.contains(where: { $0.path == path && $0.enabled }) == true
    {
      throw ComputerFailure(
        .unsupported,
        "The menu item is already available. Choose the resulting state, not an existing command; nothing was sent."
      )
    }
    if case .enabled = condition {
      throw ComputerFailure(
        .unsupported,
        "An enabled control is a precondition, not proof of completion; nothing was sent.")
    }
    // Unscoped, newText holds on any text the window changes on its own (a rotating placeholder,
    // a carousel, playback time) or that recognition reads differently from the observation, so
    // it cannot show that a click or submit did anything.
    if case .newText(.none, .none, .none) = condition {
      throw ComputerFailure(
        .unsupported,
        "A newText without locator, region or pattern holds on any text that changes anywhere in the window, so it cannot show this step worked. Use textAppears with text only the result shows, menuItemAvailable for app state, or newText with a pattern for the new value's shape or a region where it appears; nothing was sent."
      )
    }
    if case .textAppears(let text) = condition {
      let before = baseline.elements.flatMap { [$0.name, $0.value].compactMap { $0 } }
      // Compared as `holds` compares, so the check can never pass on text shown all along.
      if NativeRecognizedText.appears(text, in: before + (baseline.text?.map(\.text) ?? [])) {
        throw ComputerFailure(
          .unsupported,
          "The postcondition text already appears in the baseline. Choose evidence of the intended change, not an existing label; nothing was sent."
        )
      }
    }
  }

  /// How long a postcondition may take to show after the steps before the check reports it unmet
  /// (zero: one read). Native menus and window text can change a while after input returns: the
  /// driver settles only briefly after a click, a view may render later still, and an app may
  /// relabel its menu only once the state behind it changed, such as playback that had to load
  /// first. A menu read is a few accessibility messages, so a menu state is watched longest; a
  /// text read takes a fresh snapshot and often OCR of the window, and a label that never shows
  /// should be reported soon. The computer tool's description and the computer-use skill state
  /// these windows to the model.
  static func checkWindow(_ condition: ComputerConditionWire) -> Duration {
    switch condition {
    case .menuItemAvailable: .seconds(8)
    case .textAppears: .seconds(3)
    case .valueEquals, .enabled, .newText, .urlMatches: .zero
    }
  }

  func check(
    _ condition: ComputerConditionWire, on ref: TargetRefWire, baseline: ObservationWire?,
    context: EngineCheckContext
  ) async throws(ComputerFailure) -> Bool {
    let before = (baseline?.elements ?? []).flatMap { [$0.name, $0.value].compactMap { $0 } }
    // Reads are polled, never the input, and the first read that shows the condition ends it.
    let until = min(ContinuousClock.now + Self.checkWindow(condition), context.deadline)
    var missed: ComputerFailure?
    repeat {
      try context.check()
      _ = try window(of: ref)
      do throws(ComputerFailure) {
        if try await holds(
          condition, ref: ref, baseline: before, screenBaseline: baseline?.text?.map(\.text),
          observation: targets[ref.id]?.observation, operation: nil)
        {
          return true
        }
        missed = nil
      } catch let failure where Self.readsAgain(after: failure, condition) {
        missed = failure
      }
      guard ContinuousClock.now < until else {
        // The last read decides: a menu that did not answer it shows no missing item.
        if let missed { throw missed }
        return false
      }
      do { try await Task.sleep(for: Self.waitInterval) } catch {
        throw ComputerFailure(.cancelled, "Verification was cancelled.")
      }
    } while true
  }

  /// Whether a poll reads `condition` again after a read failed with `failure` instead of ending:
  /// only when the app's menu did not answer that read (``NativeMenuProbe/available(pid:path:)``),
  /// which says nothing about the item.
  static func readsAgain(after failure: ComputerFailure, _ condition: ComputerConditionWire)
    -> Bool
  {
    guard case .menuItemAvailable = condition else { return false }
    return failure.code == .timeout
  }

  /// Whether `condition` holds now. `baseline` is the visible text the action started from
  /// (`newText`); `observation` is where element refs in the condition come from.
  func holds(
    _ condition: ComputerConditionWire, ref: TargetRefWire, baseline: [String],
    screenBaseline: [String]?, observation: NativeObservation?, operation: String?
  ) async throws(ComputerFailure) -> Bool {
    try Self.requireUnlockedSession()
    switch condition {
    case .valueEquals(let locator, let text):
      let element = try await current(locator, ref: ref, observation: observation, operation)
      return NativeObservation.valueMatches(element.value, text)
    case .enabled(let locator):
      let element = try await current(locator, ref: ref, observation: observation, operation)
      return element.enabled != false
    case .textAppears(let text):
      // Compared as locating compares (``NativeRecognizedText/appears(_:in:)``), since
      // recognition spaces the same text differently from one read to the next.
      if let region = targets[ref.id]?.recognizedRegion {
        return try await NativeRecognizedText.appears(
          text, in: screenTexts(ref, region: region, operation: operation))
      }
      let snapshot = try await freshSnapshot(ref, operation: operation)
      let window = NativeObservation(id: "check", snapshot: snapshot, root: surfaceRoot(ref))
      if NativeRecognizedText.appears(text, in: NativeObservation.texts(window.elements)) {
        return true
      }
      return try await NativeRecognizedText.appears(
        text, in: screenTexts(ref, operation: operation))
    case .newText(let locator, let pattern, let region):
      if let region {
        return try await regionalNewText(region, pattern: pattern, ref: ref, operation: operation)
      }
      return try await newText(
        locator, pattern: pattern, ref: ref, baseline: baseline, screenBaseline: screenBaseline,
        observation: observation, operation: operation)
    case .menuItemAvailable(let path):
      guard let native = ref.native else { throw Self.changed }
      let result = await NativeTargetProbe.detached {
        NativeMenuProbe.available(pid: pid_t(native.pid), path: path)
      }
      _ = try window(of: ref)
      return try result.get()
    case .urlMatches:
      throw ComputerFailure(.unsupported, "Native targets have no URL.")
    }
  }

  /// Whether text absent at the baseline now shows: a match of `pattern` (a regular expression)
  /// or, without one, any new text, in the located element or anywhere in the window.
  private func newText(
    _ locator: ComputerLocatorWire?, pattern: String?, ref: TargetRefWire, baseline: [String],
    screenBaseline: [String]?, observation: NativeObservation?, operation: String?
  ) async throws(ComputerFailure) -> Bool {
    let now: [String]
    if let locator {
      let element = try await current(locator, ref: ref, observation: observation, operation)
      now = NativeObservation.texts([element])
    } else if targets[ref.id]?.recognizedRegion != nil {
      // A cropped observation scopes its screen condition too; unrelated window text is no proof.
      now = []
    } else {
      let snapshot = try await freshSnapshot(ref, operation: operation)
      now = NativeObservation.texts(
        NativeObservation(id: "check", snapshot: snapshot, root: surfaceRoot(ref)).elements)
    }
    if try Self.hasNewText(now, baseline: baseline, pattern: pattern) { return true }
    guard locator == nil else { return false }
    guard let screenBaseline else {
      throw ComputerFailure(
        .unsupported, "Observe with screenshot and text before checking newly visible screen text.")
    }
    return try await Self.hasNewText(
      screenTexts(ref, region: targets[ref.id]?.recognizedRegion, operation: operation),
      baseline: screenBaseline, pattern: pattern)
  }

  static func hasNewText(_ now: [String], baseline: [String], pattern: String?)
    throws(ComputerFailure) -> Bool
  {
    guard let pattern else { return now.contains { !baseline.contains($0) } }
    guard let expression = try? NSRegularExpression(pattern: pattern) else {
      throw ComputerFailure(.unsupported, "The newText pattern is not a valid expression.")
    }
    for text in now {
      let range = NSRange(text.startIndex..., in: text)
      for match in expression.matches(in: text, range: range) {
        guard let found = Range(match.range, in: text) else { continue }
        let value = String(text[found])
        if !value.isEmpty, !baseline.contains(where: { $0.contains(value) }) { return true }
      }
    }
    return false
  }

  /// The element a condition names, as the window shows it now: a ref of the target's latest
  /// observation found again in a fresh read, or a semantic locator resolved in that read.
  private func current(
    _ locator: ComputerLocatorWire, ref: TargetRefWire, observation: NativeObservation?,
    _ operation: String?
  ) async throws(ComputerFailure) -> DriverElement {
    let snapshot = try await freshSnapshot(ref, operation: operation)
    switch locator {
    case .ref:
      guard let observation else {
        throw ComputerFailure(.staleObservation, "Observe the target before naming its elements.")
      }
      let element = try Self.element(locator, in: observation)
      guard let counterpart = NativeObservation.counterpart(of: element, in: snapshot) else {
        throw ComputerFailure(
          .staleObservation, "The window changed since it was observed; observe it again.")
      }
      return counterpart
    case .semantic:
      return try Self.element(
        locator, in: NativeObservation(id: "check", snapshot: snapshot, root: surfaceRoot(ref)))
    }
  }

  /// Where the observed surface's elements start in its window's read.
  private func surfaceRoot(_ ref: TargetRefWire) -> NativeObservation.Root {
    targets[ref.id]?.observed?.root ?? .window
  }
}
