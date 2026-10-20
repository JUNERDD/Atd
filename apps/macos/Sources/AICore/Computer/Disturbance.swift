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

    public init(
      keyScopeUsed: Bool, keyScopeReturned: Bool, personWindowRestored: Bool?,
      frontmostChanged: Bool, repaired: Bool
    ) {
      self.keyScopeUsed = keyScopeUsed
      self.keyScopeReturned = keyScopeReturned
      self.personWindowRestored = personWindowRestored
      self.frontmostChanged = frontmostChanged
      self.repaired = repaired
    }
  }

  /// The person's own input while the step ran: hardware events in any app, never one an engine
  /// or Atd itself posted.
  public struct PersonInput: OptionSet, Equatable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    /// A key press.
    public static let keys = PersonInput(rawValue: 1 << 0)
    /// A click or a scroll.
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
/// demotes the route. `person` and `unknown` ones are recorded and change nothing.
public enum DisturbanceRules {
  public static func disturbances(in reading: DisturbanceReading) -> [ComputerDisturbanceWire] {
    var found: [ComputerDisturbanceWire] = []
    let personActed = !reading.personInput.isEmpty
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
    if activationChanged(reading) {
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
      found.append(
        ComputerDisturbanceWire(
          kind: .raise, attribution: reading.personInput.contains(.clicks) ? .unknown : .agent,
          repaired: false, detail: "A window of the target came above the person's window."))
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

extension [ComputerDisturbanceWire] {
  /// Whether the guard attributed any of these to the agent, which ends the action `disturbed`.
  public var anyByAgent: Bool { contains { $0.attribution == .agent } }
}
