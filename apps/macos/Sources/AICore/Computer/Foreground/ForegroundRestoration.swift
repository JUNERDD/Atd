import Foundation

/// What a foreground step, or the repair of a background one (R7), put back for the person once it
/// ended (R4.6, R6), against what they had in front when the act step began. The disturbance guard
/// reads it instead of counting the step's own activation and raise: what was put back is no
/// disturbance, a switch the person made meanwhile is theirs, and what was not put back is the
/// agent's, never repaired (``DisturbanceRules``). Atd never moves the pointer (R13), so there is
/// no pointer to put back.
public struct ForegroundRestoration: Equatable, Sendable {
  /// The person's front app.
  public enum Front: String, Equatable, Sendable {
    /// Their front app is in front again, with none of the target's windows over their window.
    case restored
    /// They had the target itself in front, and their own window of it is in front.
    case unchanged
    /// They switched to another app meanwhile, which Atd left in front.
    case personSwitched
    /// Their front app quit meanwhile, so the target stays in front.
    case appQuit
    /// No app was in front when the step began, so the target stays in front.
    case noneRecorded
    /// Atd could not bring their app back, so the target stays in front.
    case notRestored
  }

  /// A target that was hidden (⌘H) and that Atd showed for the step.
  public enum Hidden: String, Equatable, Sendable {
    case hiddenAgain
    /// It could not be hidden again, or it stayed the front app.
    case leftShown
  }

  public var front: Front
  public var hidden: Hidden?
  /// Whether the person pressed keys while the target was in front for the step, which may have
  /// reached it.
  public var personTyped: Bool

  public init(front: Front, hidden: Hidden? = nil, personTyped: Bool = false) {
    self.front = front
    self.hidden = hidden
    self.personTyped = personTyped
  }

  /// Whether the person's front app and window are as they were when the step began.
  public var putBack: Bool { front == .restored || front == .unchanged }
}

/// The evidence of a foreground step (R6): in a sentence, what it brought forward to do what, and
/// what it put back or could not. It names apps, never text from the screen or what it typed.
public enum ForegroundEvidence {
  /// The apps a sentence names: the target, the person's front app when the step began (nil when
  /// it was the target, or there was none) and the app in front now, when that differs.
  public struct Apps: Equatable, Sendable {
    public let target: String
    public let previous: String?
    public let now: String?

    public init(target: String, previous: String?, now: String?) {
      self.target = target
      self.previous = previous
      self.now = now
    }
  }

  /// `Brought Music to the front to click, then switched back to Safari.` `orderChanged`: the step's
  /// window is now the target's front or main window, which it was not before; Atd leaves the
  /// target's own window order as the step left it.
  public static func sentence(
    did gestures: [ForegroundGesture], apps: Apps, restoration: ForegroundRestoration,
    orderChanged: Bool
  ) -> String {
    let what = gestures.compactMap(\.summary).joined(separator: " and ")
    var sentence =
      restoration.front == .unchanged
      ? "Used \(apps.target), already in front, to \(what)"
      : "Brought \(apps.target) to the front to \(what)"
    sentence += outcome(restoration.front, apps)
    sentence += hidden(restoration.hidden, apps)
    if orderChanged { sentence += "; the step's window is now \(apps.target)'s front window" }
    return sentence + "."
  }

  /// What a refused or stopped foreground step adds to its error: what it put back, or could not.
  public static func restoreNote(_ restoration: ForegroundRestoration, apps: Apps) -> String {
    let front: String =
      switch restoration.front {
      case .restored: "Atd put back the person's front app and window"
      case .unchanged: "Atd left the person's own window of \(apps.target) in front"
      case .personSwitched:
        "The person switched to \(apps.now ?? "another app") meanwhile, and Atd left it in front"
      case .appQuit:
        "\(apps.previous ?? "The person's front app") quit meanwhile, so \(apps.target) stays in front"
      case .noneRecorded: "No other app was in front before, so \(apps.target) stays in front"
      case .notRestored:
        "Atd could not switch back to \(apps.previous ?? "the person's app"), so \(apps.target) "
          + "stays in front"
      }
    return front + hidden(restoration.hidden, apps) + "."
  }

  private static func outcome(_ front: ForegroundRestoration.Front, _ apps: Apps) -> String {
    switch front {
    case .restored:
      apps.previous.map { ", then switched back to \($0)" } ?? ", then put the person's app back"
    case .unchanged: ", leaving the person's own window of it in front"
    case .personSwitched:
      ", and left \(apps.now ?? "the app the person switched to") in front, since the person "
        + "switched to it meanwhile"
    case .appQuit:
      ", but \(apps.previous ?? "the person's front app") quit meanwhile, so \(apps.target) stays "
        + "in front"
    case .noneRecorded: "; no other app was in front before, so it stays in front"
    case .notRestored:
      ", but could not switch back to \(apps.previous ?? "the person's app"), so it stays in front"
    }
  }

  private static func hidden(_ hidden: ForegroundRestoration.Hidden?, _ apps: Apps) -> String {
    switch hidden {
    case nil: ""
    case .hiddenAgain: "; \(apps.target) was hidden and is hidden again"
    case .leftShown: "; \(apps.target) was hidden and could not be hidden again"
    }
  }
}
