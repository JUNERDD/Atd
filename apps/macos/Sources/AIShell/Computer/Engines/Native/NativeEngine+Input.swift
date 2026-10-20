import AIComputerDriverKit
import AICore
import Foundation

/// The steps that drive input (plan §4.2): click, key, type, menu, scroll and drag, each down its
/// ladder. What they did to the app is unknown to the host unless a postcondition checks it; the
/// driver's receipt says only how the input went out.
extension NativeEngine {
  func input(_ step: ComputerStepWire, _ write: Write) async throws(ComputerFailure)
    -> EngineStepOutcome
  {
    switch step {
    case .click(let locator, let button, let count):
      return try await click(locator, button: button ?? .left, count: count ?? 1, write)
    case .key(let key, let modifiers, let locator):
      return try await self.key(key, modifiers ?? [], locator, write)
    case .type(let text, let locator):
      return try await typeText(text, locator: locator, write)
    case .menu(let path):
      return try await menu(path, write)
    case .scroll(let locator, let direction, let amount):
      return try await scroll(locator, direction, amount, write)
    case .drag(let from, let to):
      return try await drag(from, to, write)
    case .navigate, .fill, .press, .wait, .setValue, .clear, .select, .upload:
      throw ComputerFailure(.unsupported, "\(step.kind.rawValue) is not an input step.")
    }
  }

  private func click(
    _ locator: ComputerPointLocatorWire, button: ComputerStepWire.ClickButton, count: Int,
    _ write: Write
  ) async throws(ComputerFailure) -> EngineStepOutcome {
    guard button == .left else {
      throw .noBackgroundRoute(
        .noRoute,
        "A right click opens a context menu, which the background never shows; press the element "
          + "or use the app's menu instead. Nothing was sent.")
    }
    let aim = try await aim(
      locator, ref: write.ref, in: write.observation, context: write.context, uses: true)
    try dispatching(geometry(of: aim), context: write.context)
    let delivered = try await climb(
      NativeRoutePlan.click(aim, button: button, count: count, facts: write.facts), kind: .click,
      place: write.place, ref: write.ref, context: write.context)
    let twice = count == 2 ? " twice" : ""
    if case .text(_, let text) = aim {
      return Self.outcome(delivered, "Clicked the text “\(text)”\(twice)")
    }
    return Self.outcome(delivered, "Clicked\(twice)")
  }

  /// A plain Return in a field that confirms on it (the field the step names, else the one the
  /// observation shows focused) is the field's own confirm action, which an app that drops
  /// window-routed keys still takes. A chord with ⌘, ⌃ or ⌥ that is a menu item's shortcut goes
  /// to that item (a background command chord never reaches the app's menus); everything else is
  /// the chord in a key scope.
  private func key(
    _ key: ComputerKeyName, _ modifiers: [ComputerModifier], _ locator: ComputerLocatorWire?,
    _ write: Write
  ) async throws(ComputerFailure) -> EngineStepOutcome {
    var focus: NativeRoutePlan.Element?
    if let locator {
      let element = try Self.element(locator, in: write.observation)
      focus = try await liveElement(
        element, ref: write.ref, observation: write.observation, context: write.context)
    }
    // Where a plain Return goes: the field the step names, else the one shown focused.
    var field = focus
    if field == nil, key == .return, modifiers.isEmpty,
      let focused = write.observation.elements.first(where: {
        $0.focused == true && NativeRoutePlan.confirmsOnReturn($0)
      })
    {
      // A focused field the window no longer shows leaves Return to the key rung, as before.
      field = try? await liveElement(
        focused, ref: write.ref, observation: write.observation, context: nil)
    }
    var menuPath: [String]?
    if !Set(modifiers).isDisjoint(with: [.cmd, .ctrl, .option]),
      write.place.pid == write.ref.native?.pid
    {
      let pid = pid_t(write.place.pid)
      menuPath = await NativeTargetProbe.detached {
        NativeMenuProbe.shortcutPath(pid: pid, key: key, modifiers: modifiers)
      }
    }
    try dispatching(
      (focus ?? field).flatMap { NativeTargetProbe.screenGeometry($0.element.frame?.cgRect) },
      context: write.context)
    let ladder = NativeRoutePlan.key(
      chord: NativeKeyChord.chord(key, modifiers: modifiers), menuPath: menuPath, focus: focus,
      field: field, facts: write.facts)
    let delivered = try await climb(
      ladder, kind: .key, place: write.place, ref: write.ref, context: write.context)
    let combination = (modifiers.map(\.rawValue) + [key.rawValue]).joined(separator: "+")
    if delivered.rung.route == .axMenu, let menuPath {
      return Self.outcome(
        delivered, "Pressed \(combination) as \(menuPath.joined(separator: " > "))")
    }
    if delivered.rung.route == .axAction, let field {
      return Self.outcome(delivered, "Pressed \(combination) as confirm of \(field.element.role)")
    }
    return Self.outcome(delivered, "Pressed \(combination)")
  }

  private func typeText(_ text: String, locator: ComputerPointLocatorWire?, _ write: Write)
    async throws(ComputerFailure) -> EngineStepOutcome
  {
    let target: NativeRoutePlan.TypeTarget
    var field: NativeTypingField?
    switch locator {
    case .element(let locator)?:
      let element = try Self.element(locator, in: write.observation)
      guard element.enabled != false else {
        throw ComputerFailure(.unsupported, "The element is disabled.")
      }
      let live = try await liveElement(
        element, ref: write.ref, observation: write.observation, context: write.context)
      try dispatching(
        NativeTargetProbe.screenGeometry(live.element.frame?.cgRect), context: write.context)
      field = await typingField(write.ref, element: live.element, context: write.context)
      target = .element(live)
    case .imagePoint(let point)?:
      // The point is clicked once to place the caret; later chunks never click again.
      let screen = try await screenPoint(point, ref: write.ref, context: write.context, uses: true)
      try dispatching(geometry(of: .point(screen)), context: write.context)
      target = .point(screen)
    case nil:
      try dispatching(await focusedInputGeometry(write.ref), context: write.context)
      field = await typingField(write.ref, element: nil, context: write.context)
      if let focused = write.observation.elements.first(where: {
        $0.focused == true && NativeObservation.textInputRoles.contains($0.role)
      }) {
        target = .focused(
          try await liveElement(
            focused, ref: write.ref, observation: write.observation, context: nil))
      } else {
        target = .focus
      }
    }
    let facts = write.facts
    let written = try await self.write(
      text, replacing: false, ladder: { NativeRoutePlan.type($0, into: target, facts: facts) },
      field: field, kind: .type, write)
    return Self.outcome(written, "Typed \(text.count) characters")
  }

  /// A menu command by its path, resolved and pressed through accessibility without opening the
  /// menu; an item the app disables in the background is refused `menuUnavailable`.
  private func menu(_ path: [String], _ write: Write) async throws(ComputerFailure)
    -> EngineStepOutcome
  {
    try dispatching(nil, context: write.context)
    let delivered = try await climb(
      NativeRoutePlan.menu(path, facts: write.facts), kind: .menu, place: try rootRead(write.ref),
      ref: write.ref, context: write.context)
    return Self.outcome(delivered, "Chose \(path.joined(separator: " > "))")
  }

  /// A scroll of the element's scroll area, of the point, or without a locator of the surface's
  /// largest scroll area, aimed at its centre (else the surface's).
  private func scroll(
    _ locator: ComputerPointLocatorWire?, _ direction: ComputerStepWire.ScrollDirection,
    _ amount: Int, _ write: Write
  ) async throws(ComputerFailure) -> EngineStepOutcome {
    var area: NativeRoutePlan.Element?
    var point: DriverPoint?
    var geometry: ComputerGeometryWire?
    let (ref, observation, context) = (write.ref, write.observation, write.context)
    switch locator {
    case .element(let locator)?:
      let element = try Self.element(locator, in: observation)
      let live = try await liveElement(
        element, ref: ref, observation: observation, context: context)
      point = live.point
      geometry = NativeTargetProbe.screenGeometry(live.element.frame?.cgRect)
      if let scroller = NativeRoutePlan.scrollArea(
        for: element, in: observation, direction: direction)
      {
        area = try await liveElement(scroller, ref: ref, observation: observation, context: nil)
      }
    case .imagePoint(let image)?:
      let screen = try await screenPoint(image, ref: ref, context: context, uses: false)
      point = screen
      geometry = self.geometry(of: .point(screen))
    case nil:
      if let scroller = NativeRoutePlan.scrollArea(for: nil, in: observation, direction: direction)
      {
        area = try await liveElement(scroller, ref: ref, observation: observation, context: nil)
      }
      let frame = try surfaceFrame(ref)
      point = area?.point ?? frame.map { DriverPoint(x: $0.midX, y: $0.midY) }
      geometry = NativeTargetProbe.screenGeometry(area?.element.frame?.cgRect ?? frame)
    }
    try dispatching(geometry, context: context)
    let delivered = try await climb(
      NativeRoutePlan.scroll(
        direction, amount: amount, area: area, point: point, facts: write.facts),
      kind: .scroll, place: write.place, ref: ref, context: context)
    return Self.outcome(delivered, "Scrolled \(direction.rawValue) \(amount)")
  }

  /// An in-content drag between two points of the surface; a capture both ends name is used once.
  private func drag(
    _ from: ComputerPointLocatorWire, _ to: ComputerPointLocatorWire, _ write: Write
  ) async throws(ComputerFailure) -> EngineStepOutcome {
    let captures = [from, to].compactMap { locator -> String? in
      if case .imagePoint(let point) = locator { point.capture } else { nil }
    }
    if let spent = targets[write.ref.id]?.spent, captures.contains(where: spent.contains) {
      throw Self.staleCapture("has already been used for input")
    }
    let start = try await dragPoint(from, write)
    let end = try await dragPoint(to, write)
    for capture in captures { targets[write.ref.id]?.spent.insert(capture) }
    try dispatching(nil, context: write.context)
    let delivered = try await climb(
      NativeRoutePlan.drag(from: start, to: end, facts: write.facts), kind: .drag,
      place: write.place, ref: write.ref, context: write.context)
    return Self.outcome(delivered, "Dragged")
  }

  private func dragPoint(_ locator: ComputerPointLocatorWire, _ write: Write)
    async throws(ComputerFailure) -> DriverPoint
  {
    switch try await aim(
      locator, ref: write.ref, in: write.observation, context: write.context, uses: false)
    {
    case .element(let element):
      guard let point = element.point else {
        throw .noBackgroundRoute(
          .noRoute, "The element shows no point inside its window to drag; nothing was sent.")
      }
      return point
    case .point(let point), .text(let point, _):
      return point
    }
  }
}
