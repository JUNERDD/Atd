import AIComputerDriverKit
import Foundation

/// One rung of a step's ladder: the primitives sent in order and the route the rung stands for,
/// which its receipt reports and a demotion names. A rung's leading primitives prepare the last
/// one (focus the element, place the caret).
public struct NativeRung: Equatable, Sendable {
  public let route: DriverRoute
  public let primitives: [DriverPrimitive]
  /// Whether a primitive opens a target-only key scope, so the typing guard runs first.
  public let opensKeyScope: Bool
}

/// A step's ladder, most imperceptible rung first, and the reason a refusal names when no rung
/// delivers (plan §4.2).
public struct NativeLadder: Equatable, Sendable {
  public let rungs: [NativeRung]
  /// The step's own reason, named when neither the driver nor the placement names another.
  public let refusal: ComputerRefusalReason
  /// The rungs left out before anything was sent, and why.
  public let excluded: [DriverRoute: NativeRouteExclusion]
  public let placement: NativeWindowPlacement

  /// The reason the step is refused with once no rung delivered; `driver` is the reason of the
  /// last rung the driver refused (nil when none was sent). The driver's reason wins over the
  /// step's generic one; when the window's placement ruled out an event rung, the placement wins
  /// over both, unless the limit is one no Space changes (``NativeWindowPlacement/walls``).
  public func refusal(after driver: ComputerRefusalReason?) -> ComputerRefusalReason {
    var reason = refusal
    if let driver, driver != .noRoute { reason = driver }
    guard excluded.values.contains(.placement), let placed = placement.eventRefusal,
      !NativeWindowPlacement.walls.contains(reason)
    else { return reason }
    return placed
  }
}

/// The pure route ladder of the native engine (plan §4.2). The engine climbs it rung by rung and
/// moves on only on the driver's evidence that nothing was dispatched; a failure that may have
/// dispatched stops the step, never replayed on another route. A minimized window is refused
/// before any ladder; on another Space or in a full-screen Space the event rungs are left out
/// and the accessibility rungs run as on the active Space (``NativeWindowPlacement``). The
/// typing guard (``NativeTypingGuard``) runs before a rung that opens a key scope.
public enum NativeRoutePlan {
  /// An element a step acts on, with the token of its window's newest snapshot.
  public struct Element: Equatable, Sendable {
    public let token: String
    public let element: DriverElement
    /// Where an event rung aims at it, in screen points: its centre inside the surface; nil
    /// when it shows none.
    public let point: DriverPoint?

    public init(token: String, element: DriverElement, point: DriverPoint?) {
      self.token = token
      self.element = element
      self.point = point
    }
  }

  /// What a pointer step aims at.
  public enum Aim: Equatable, Sendable {
    case element(Element)
    /// A capture point, as the host mapped it to the screen.
    case point(DriverPoint)
    /// The middle of text the window shows, as the host found and mapped it
    /// (``NativeRecognizedText``), with the text it found.
    case text(DriverPoint, String)
  }

  /// Where a `type` step's text goes.
  public enum TypeTarget: Equatable, Sendable {
    /// A text element: written through accessibility, else focused and typed.
    case element(Element)
    /// The observation's focused text element, which already has the app's focus.
    case focused(Element)
    /// A capture point, clicked to place the caret.
    case point(DriverPoint)
    /// Whatever has the app's focus, no element known.
    case focus
  }

  /// One wheel unit of a `scroll` step in line units: about one notch.
  public static let linesPerUnit = 3.0

  public static func press(_ target: Element, facts: NativeRouteFacts) -> NativeLadder {
    var ladder = Builder(facts)
    if target.element.offers("Press") {
      ladder.add(.axAction, [.axAction(element: target.token, action: .press)])
    } else if target.element.offers("Pick") {
      ladder.add(.axAction, [.axAction(element: target.token, action: .pick)])
    }
    return ladder.result(.noRoute)
  }

  /// A click: a single left click of an element presses it; otherwise, and for a capture point or
  /// text on screen, a window-routed click. A right click would open a context menu, which is
  /// visible interface (plan I3), so it has no rung.
  public static func click(
    _ aim: Aim, button: ComputerStepWire.ClickButton, count: Int, facts: NativeRouteFacts
  ) -> NativeLadder {
    var ladder = Builder(facts)
    let toolkit = NativeRoutePolicy.pointerRefusal(on: facts.toolkit) ?? .noRoute
    guard button == .left else { return ladder.result(.noRoute) }
    switch aim {
    case .element(let target):
      if count == 1, target.element.offers("Press") {
        ladder.add(.axAction, [.axAction(element: target.token, action: .press)])
      }
      if let point = target.point {
        ladder.add(.pointer, [.pointer(point: point, clickCount: count)])
      }
    case .point(let point), .text(let point, _):
      ladder.add(.pointer, [.pointer(point: point, clickCount: count)])
    }
    return ladder.result(toolkit)
  }

  /// `setValue` and `clear` (`value` empty): the element's accessibility value.
  public static func setValue(_ target: Element, value: String, facts: NativeRouteFacts)
    -> NativeLadder
  {
    var ladder = Builder(facts)
    if target.element.settable("AXValue") {
      ladder.add(.axText, [.axSetValue(element: target.token, value: value)])
    }
    return ladder.result(.textUnavailable)
  }

  /// `type`: inserted at the caret through accessibility (only where the selected text is
  /// settable, so an insert never replaces the whole value), else typed in a key scope.
  public static func type(_ text: String, into target: TypeTarget, facts: NativeRouteFacts)
    -> NativeLadder
  {
    var ladder = Builder(facts)
    var refusal = ComputerRefusalReason.textUnavailable
    switch target {
    case .element(let element), .focused(let element):
      if NativeObservation.isSecret(element.element) { refusal = .secureInput }
      if element.element.settable("AXSelectedText") {
        ladder.add(.axText, [.axInsertText(element: element.token, text: text, replaceRange: nil)])
      }
      if case .focused = target {
        ladder.add(.text, [.text(text: text)])
      } else if let focus = focusing(element) {
        ladder.add(.text, focus + [.text(text: text)])
      }
    case .point(let point):
      ladder.add(.text, [.pointer(point: point, clickCount: 1), .text(text: text)])
    case .focus:
      ladder.add(.text, [.text(text: text)])
    }
    return ladder.result(refusal)
  }

  /// `key`: the menu item whose shortcut it is, pressed through accessibility, else the chord in
  /// a key scope; both after focusing `focus` when the step names an element.
  public static func key(
    chord: String, menuPath: [String]?, focus: Element?, facts: NativeRouteFacts
  ) -> NativeLadder {
    var ladder = Builder(facts)
    var preface: [DriverPrimitive] = []
    if let focus {
      guard let prepared = focusing(focus) else { return ladder.result(.keyUnavailable) }
      preface = prepared
    }
    if let menuPath { ladder.add(.axMenu, preface + [.axMenu(path: menuPath)]) }
    ladder.add(.keys, preface + [.keys(chord: chord)])
    return ladder.result(.keyUnavailable)
  }

  public static func menu(_ path: [String], facts: NativeRouteFacts) -> NativeLadder {
    var ladder = Builder(facts)
    ladder.add(.axMenu, [.axMenu(path: path)])
    return ladder.result(.menuUnavailable)
  }

  /// `scroll`: whole pages of `area` through accessibility (as many as cover `amount` units of
  /// about 100 points, at least one), else a window-routed wheel at `point`.
  public static func scroll(
    _ direction: ComputerStepWire.ScrollDirection, amount: Int, area: Element?,
    point: DriverPoint?, facts: NativeRouteFacts
  ) -> NativeLadder {
    var ladder = Builder(facts)
    let kind = pageKind(direction)
    if let area, area.element.offers(pageAction(kind)) {
      let extent = area.element.frame.map {
        direction == .up || direction == .down ? $0.height : $0.width
      }.flatMap { $0 >= 1 ? $0 : nil }
      let pages = extent.map { max(1, min(amount, Int((Double(amount) * 100 / $0).rounded()))) }
      ladder.add(
        .axScroll,
        Array(repeating: .axScroll(element: area.token, kind: kind), count: pages ?? 1))
    }
    if let point {
      let lines = Double(amount) * linesPerUnit
      let (dx, dy): (Double, Double) =
        switch direction {
        case .up: (0, lines)
        case .down: (0, -lines)
        case .left: (lines, 0)
        case .right: (-lines, 0)
        }
      ladder.add(.scroll, [.scroll(point: point, deltaX: dx, deltaY: dy)])
    }
    return ladder.result(.noRoute)
  }

  /// `drag`: an in-content drag; a native drag-and-drop session is refused by the driver.
  public static func drag(from: DriverPoint, to: DriverPoint, facts: NativeRouteFacts)
    -> NativeLadder
  {
    var ladder = Builder(facts)
    ladder.add(.drag, [.drag(from: from, to: to)])
    return ladder.result(NativeRoutePolicy.pointerRefusal(on: facts.toolkit) ?? .dragAndDrop)
  }

  /// The scroll area a page scroll acts on: the nearest ancestor (or the element itself) that
  /// pages in `direction`, else, without an element, the largest such area of the observation.
  public static func scrollArea(
    for element: DriverElement?, in observation: NativeObservation,
    direction: ComputerStepWire.ScrollDirection
  ) -> DriverElement? {
    let action = pageAction(pageKind(direction))
    if let element {
      var current: DriverElement? = element
      while let candidate = current {
        if candidate.offers(action) { return candidate }
        current = observation.parent(of: candidate)
      }
      return nil
    }
    return observation.elements.filter { $0.offers(action) }.max { lhs, rhs in
      (lhs.frame.map { $0.width * $0.height } ?? 0) < (rhs.frame.map { $0.width * $0.height } ?? 0)
    }
  }

  /// The routes a step kind can take on this window at all, for the target's capabilities.
  public static func routes(for kind: ComputerStepKind, facts: NativeRouteFacts)
    -> [DriverRoute]
  {
    let ladder: [DriverRoute] =
      switch kind {
      case .press: [.axAction]
      case .click: [.axAction, .pointer]
      case .setValue, .clear: [.axText]
      case .type: [.axText, .text]
      case .key: [.axMenu, .keys]
      case .menu: [.axMenu]
      case .scroll: [.axScroll, .scroll]
      case .drag: [.drag]
      case .wait, .navigate, .fill, .select, .upload: []
      }
    return ladder.filter { facts.exclusion(of: $0) == nil }
  }

  /// How an element is focused before keys or text: through accessibility, else by a click at
  /// its centre; nil when it can be neither.
  private static func focusing(_ target: Element) -> [DriverPrimitive]? {
    if target.element.settable("AXFocused") { return [.axFocus(element: target.token)] }
    return target.point.map { [.pointer(point: $0, clickCount: 1)] }
  }

  private static func pageKind(_ direction: ComputerStepWire.ScrollDirection) -> DriverScrollKind {
    switch direction {
    case .up: .pageUp
    case .down: .pageDown
    case .left: .pageLeft
    case .right: .pageRight
    }
  }

  private static func pageAction(_ kind: DriverScrollKind) -> String {
    switch kind {
    case .pageUp: "ScrollUpByPage"
    case .pageDown: "ScrollDownByPage"
    case .pageLeft: "ScrollLeftByPage"
    case .pageRight: "ScrollRightByPage"
    case .toVisible: "ScrollToVisible"
    }
  }

  /// Collects the rungs that are not ruled out; a rung is out when any of its primitives' routes
  /// is, and the exclusion is recorded under the rung's route.
  private struct Builder {
    let facts: NativeRouteFacts
    var rungs: [NativeRung] = []
    var excluded: [DriverRoute: NativeRouteExclusion] = [:]

    init(_ facts: NativeRouteFacts) { self.facts = facts }

    mutating func add(_ route: DriverRoute, _ primitives: [DriverPrimitive]) {
      for primitive in primitives {
        if let exclusion = facts.exclusion(of: primitive.route) {
          excluded[route] = excluded[route] ?? exclusion
          return
        }
      }
      rungs.append(
        NativeRung(
          route: route, primitives: primitives,
          opensKeyScope: primitives.contains { facts.opensKeyScope($0.route) }))
    }

    func result(_ refusal: ComputerRefusalReason) -> NativeLadder {
      NativeLadder(
        rungs: rungs, refusal: refusal, excluded: excluded, placement: facts.placement)
    }
  }
}
