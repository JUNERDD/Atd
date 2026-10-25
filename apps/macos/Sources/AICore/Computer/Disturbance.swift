import Foundation

/// What the host's disturbance guard read around one write step (plan §4.3, I6, I8): host-side
/// facts about what the person would notice (the frontmost app, window order, Spaces, the pointer,
/// the pasteboard and their own hardware input) and the engine's receipt for the step's input.
/// Plain values, so ``DisturbanceRules`` attributes the same way for every engine.
public struct DisturbanceReading: Equatable, Sendable {
  /// The engine's account of the step's input. Agent-side facts come only from here; the host's
  /// own monitors watch the person (plan I8).
  public struct Receipt: Equatable, Sendable {
    /// A target-only key scope was opened for the input.
    public var keyScopeUsed: Bool
    /// The scope was handed back.
    public var keyScopeReturned: Bool
    /// The driver re-read the person's previous key window as key again; nil when it could not
    /// tell or no scope was used.
    public var personWindowRestored: Bool?
    /// The frontmost app changed while the primitive ran, as the driver saw it.
    public var frontmostChanged: Bool
    /// The driver posted repair records (focus or ordering) after the primitive.
    public var repaired: Bool
    /// What a foreground step put back (R6); nil for a step that stayed in the background.
    public var foreground: ForegroundRestoration?

    public init(
      keyScopeUsed: Bool, keyScopeReturned: Bool, personWindowRestored: Bool?,
      frontmostChanged: Bool, repaired: Bool, foreground: ForegroundRestoration? = nil
    ) {
      self.keyScopeUsed = keyScopeUsed
      self.keyScopeReturned = keyScopeReturned
      self.personWindowRestored = personWindowRestored
      self.frontmostChanged = frontmostChanged
      self.repaired = repaired
      self.foreground = foreground
    }
  }

  /// The person's own input while the step ran: hardware events in any app, never one an engine
  /// or Atd itself posted.
  public struct PersonInput: OptionSet, Equatable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    /// A key press, a modifier key on its own, or a system key (media, Mission Control).
    public static let keys = PersonInput(rawValue: 1 << 0)
    /// A click, a scroll or a trackpad gesture.
    public static let clicks = PersonInput(rawValue: 1 << 1)
    /// A pointer movement.
    public static let motion = PersonInput(rawValue: 1 << 2)
  }

  public var receipt: Receipt?
  public var personInput: PersonInput = []
  /// The processes of the step's target.
  public var target: Set<Int32> = []
  /// Processes this step does not account for: Atd itself, and the targets of other steps running
  /// at the same time, whose own readings cover them.
  public var ignored: Set<Int32> = []
  /// The frontmost app before and after the step.
  public var frontmostBefore: Int32?
  public var frontmostAfter: Int32?
  /// The apps that became active while the step ran, in order.
  public var activated: [Int32] = []
  /// The active Space changed while the step ran.
  public var spaceChanged = false
  /// Whether a window of the target was above the person's front window, before and after.
  public var targetAboveBefore = false
  public var targetAboveAfter = false
  /// The pointer moved by more than a point.
  public var pointerMoved = false
  /// The general pasteboard's change count moved.
  public var pasteboardChanged = false
  /// How many windows the person's frontmost app showed before and after, when the same app stayed
  /// in front; nil otherwise.
  public var personWindowsBefore: Int?
  public var personWindowsAfter: Int?

  public init() {}
}

/// The guard's attribution rules (plan §4.3, the eight kinds of Cua Bench v2). The host says the
/// agent caused a change only on the engine's receipt or when the target changed what the person
/// sees without any input of theirs; an `agent` disturbance ends the action `disturbed` and
/// demotes the route (``RouteDemotion``). `person` and `unknown` ones are recorded and change
/// nothing. A foreground step activates and raises the target on purpose (R6), so its activation
/// and raise are judged by where the person's screen ended against the step's start: what it put
/// back is no disturbance, a switch the person made meanwhile is theirs, and what it left changed
/// is the agent's, never repaired. It never moves the pointer (R13).
public enum DisturbanceRules {
  public static func disturbances(in reading: DisturbanceReading) -> [ComputerDisturbanceWire] {
    var found: [ComputerDisturbanceWire] = []
    let personActed = !reading.personInput.isEmpty
    let foreground = reading.receipt?.foreground
    if let receipt = reading.receipt, receipt.keyScopeUsed {
      if !receipt.keyScopeReturned || receipt.personWindowRestored == false {
        found.append(
          ComputerDisturbanceWire(
            kind: .keyFocus, attribution: .agent, repaired: receipt.personWindowRestored == true,
            detail: "The target-only key scope was not handed back to the person's window."))
      }
      if reading.personInput.contains(.keys) {
        found.append(
          ComputerDisturbanceWire(
            kind: .input, attribution: .unknown, repaired: false,
            detail: "The person typed while the target held a key scope."))
      }
    }
    if let foreground {
      if let activation = activation(after: foreground, reading, personActed: personActed) {
        found.append(activation)
      }
    } else if activationChanged(reading) {
      found.append(
        ComputerDisturbanceWire(
          kind: .activation, attribution: personActed ? .unknown : .agent,
          repaired: reading.frontmostAfter == reading.frontmostBefore,
          detail: "Another app became active while the step ran."))
    }
    // A target the person already had in front: its own windows coming up are what the step was
    // for, not a window over theirs or a dialog in an app of theirs.
    let targetInFront = reading.frontmostBefore.map(reading.target.contains) ?? false
    if !targetInFront, reading.targetAboveAfter, !reading.targetAboveBefore {
      // A foreground step's raise left behind is the agent's, unless the person switched to another
      // app meanwhile: Atd leaves their choice alone then, so nobody in particular left it.
      let attribution: ComputerDisturbanceWire.Attribution =
        if let foreground {
          foreground.front == .personSwitched ? .unknown : .agent
        } else {
          reading.personInput.contains(.clicks) ? .unknown : .agent
        }
      found.append(
        ComputerDisturbanceWire(
          kind: .raise, attribution: attribution, repaired: false,
          detail: "A window of the target came above the person's window."))
    }
    if reading.spaceChanged {
      found.append(
        ComputerDisturbanceWire(
          kind: .space, attribution: personActed ? .unknown : .agent, repaired: false,
          detail: "The active Space changed while the step ran."))
    }
    if reading.pointerMoved {
      let moved = !reading.personInput.isDisjoint(with: [.clicks, .motion])
      found.append(
        ComputerDisturbanceWire(
          kind: .pointer, attribution: moved ? .person : .unknown, repaired: false,
          detail: "The pointer moved while the step ran."))
    }
    if foreground?.personTyped == true {
      found.append(
        ComputerDisturbanceWire(
          kind: .input, attribution: .person, repaired: false,
          detail: "The person pressed keys while the target was in front for this step; they may "
            + "have reached it."))
    }
    if reading.pasteboardChanged {
      found.append(
        ComputerDisturbanceWire(
          kind: .clipboard, attribution: .unknown, repaired: false,
          detail: "The clipboard changed while the step ran."))
    }
    if !targetInFront, let before = reading.personWindowsBefore,
      let after = reading.personWindowsAfter, after > before
    {
      found.append(
        ComputerDisturbanceWire(
          kind: .dialog, attribution: .unknown, repaired: false,
          detail: "A window, sheet or dialog appeared in the person's app."))
    }
    return found
  }

  /// The front app after a foreground step (R6): the target's own activation is what the step was
  /// for, and the restore undoes it, so only where the front ended counts, against the step's
  /// start. An app the person switched to is theirs (unknown when the guard saw no input of
  /// theirs); anything else left in front, the target above all, is the agent's.
  static func activation(
    after foreground: ForegroundRestoration, _ reading: DisturbanceReading, personActed: Bool
  ) -> ComputerDisturbanceWire? {
    let ignored = reading.ignored.subtracting(reading.target)
    guard let after = reading.frontmostAfter, after != reading.frontmostBefore,
      !ignored.contains(after)
    else { return nil }
    guard foreground.front == .personSwitched else {
      return ComputerDisturbanceWire(
        kind: .activation, attribution: .agent, repaired: false,
        detail: "The person's front app was not put back after the step.")
    }
    return ComputerDisturbanceWire(
      kind: .activation, attribution: personActed ? .person : .unknown, repaired: false,
      detail: "Another app came to the front while the step ran.")
  }

  /// Whether the frontmost app changed in a way this step accounts for: an app other than the
  /// person's became active, or the engine saw the front change while its input ran.
  static func activationChanged(_ reading: DisturbanceReading) -> Bool {
    let ignored = reading.ignored.subtracting(reading.target)
    let counts = { (pid: Int32) in pid != reading.frontmostBefore && !ignored.contains(pid) }
    if reading.activated.contains(where: counts) { return true }
    if let after = reading.frontmostAfter, counts(after) { return true }
    return reading.receipt?.frontmostChanged == true
  }
}

/// How long a route stays off for an app and step kind after the guard attributed a disturbance
/// to it (plan §4.3, I6). The first keeps it off for the rest of the run whose step caused it, so
/// the agent cannot take it again before the person has seen the report; their reply starts a new
/// run, where the route is back. A second, from any run, keeps it off in every run until Atd quits.
public enum RouteDemotion: Equatable, Sendable {
  /// Off for the rest of this run.
  case run(String)
  /// Off in every run.
  case everyRun

  /// What a disturbance by a step of `run` leaves after `previous`, the route's demotion so far:
  /// the first strike holds for its run, a second one for every run.
  public static func after(_ previous: RouteDemotion?, run: String) -> RouteDemotion {
    previous == nil ? .run(run) : .everyRun
  }

  /// Whether the route is off for a step of `run`.
  public func applies(to run: String) -> Bool {
    switch self {
    case .run(let struck): struck == run
    case .everyRun: true
    }
  }
}

extension [ComputerDisturbanceWire] {
  /// Whether the guard attributed any of these to the agent, which ends the action `disturbed`.
  public var anyByAgent: Bool { contains { $0.attribution == .agent } }

  /// The kinds putting the person's front app and window back repairs (R7). The pointer is never
  /// one: Atd never moves it (R13).
  private static let frontKinds: Set<ComputerDisturbanceWire.Kind> = [.raise, .activation]

  /// Whether the agent raised or activated a window over the person's, and that is not put back
  /// yet: what a run that may use the foreground puts back (R7).
  public var frontToRepair: Bool {
    contains { $0.attribution == .agent && !$0.repaired && Self.frontKinds.contains($0.kind) }
  }

  /// Whether every disturbance attributed to the agent is a raise or an activation that is put
  /// back: in a run that may use the foreground the action then goes on, its route still switched
  /// off (R7), instead of ending `disturbed`.
  public var onlyRepairedFront: Bool {
    anyByAgent
      && allSatisfy { found in
        found.attribution != .agent || (found.repaired && Self.frontKinds.contains(found.kind))
      }
  }

  /// These once the host put the person's front app and window back (R7): the agent's raise and
  /// activation read as repaired.
  public func repairing() -> [ComputerDisturbanceWire] {
    map { found in
      guard found.attribution == .agent, Self.frontKinds.contains(found.kind) else { return found }
      return ComputerDisturbanceWire(
        kind: found.kind, attribution: found.attribution, repaired: true, detail: found.detail)
    }
  }
}
