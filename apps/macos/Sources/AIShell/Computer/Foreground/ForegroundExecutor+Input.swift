import AICore
import AppKit
import Carbon.HIToolbox

/// The input of a foreground step and what stops it (R4.1, R4.5, R5): the pause the person must
/// leave before the target comes forward, the global-input claim, and the pieces themselves, each
/// sent only while the person has not touched any input since the step began and the target is
/// still in front with the step's window focused.
extension ForegroundExecutor {
  /// How long secure input is watched after a click, a focus or a Return before keys go out.
  static let secureWatch: Duration = .milliseconds(150)

  /// Waits until the person has left every input alone for ``ForegroundPolicy/quiet`` and holds
  /// no key or button down (R4.1), at most ``ForegroundPolicy/longestWait`` and never into the
  /// time the step needs; refuses `inputInUse`, with nothing sent, once that pause cannot come in
  /// time. Each further input of theirs pushes the pause back.
  func awaitQuiet(_ context: Context) async throws(ComputerFailure) {
    let giveUp = min(.now + ForegroundPolicy.longestWait, context.deadline - Self.leastTime)
    while true {
      if context.isStopping() || Task.isCancelled { throw Self.stopped }
      let wait =
        ForegroundPolicy.quietWait(lastActivity: disturbance.lastPersonActivity(), now: .now)
        ?? (Self.holdsInput ? .milliseconds(50) : nil)
      guard let wait else { return }
      guard ContinuousClock.now + wait < giveUp else {
        throw ComputerFailure(
          .inputInUse,
          "The person is using the keyboard or pointer, so Atd did not bring the target forward "
            + "and sent nothing.")
      }
      try? await Task.sleep(for: wait)
    }
  }

  /// Global input added to the action's own claim (``DeviceArbiter/escalate(owner:deadline:)``).
  func claimInput(_ context: Context) async throws(ComputerFailure) -> ResourceClaim {
    do throws(ClaimRefusal) {
      return try await arbiter.escalate(
        owner: context.owner,
        deadline: min(.now + Self.claimWait, context.deadline - Self.leastTime))
    } catch {
      let wire = ComputerCoordinator.wire(error)
      throw ComputerFailure(wire.code, wire.message)
    }
  }

  /// R4.5: the step's input piece by piece, typed text in runs with each line break a Return.
  func send(
    _ plan: ForegroundPlan, name: String, since start: ContinuousClock.Instant,
    sent: inout Sent, _ context: Context
  ) async throws(ComputerFailure) {
    for gesture in plan.gestures {
      guard case .text(let text) = gesture else {
        try await send(gesture, plan, name: name, since: start, sent: &sent, context)
        continue
      }
      for piece in ForegroundText.pieces(text) {
        let next: ForegroundGesture =
          switch piece {
          case .characters(let run): .text(run)
          case .newline: .chord(.return, [])
          }
        try await send(next, plan, name: name, since: start, sent: &sent, context)
      }
    }
  }

  /// One piece: keys held back until a focus change settled; the target in front with the step's
  /// window focused, and the piece's points on it, checked again; the person's input, a stop and
  /// the deadline checked last, right before the piece goes out (R5). A check that fails once
  /// something went out stops the step and asks for a new observation. A focus the app declines
  /// falls back to a click where the element shows one.
  private func send(
    _ piece: ForegroundGesture, _ plan: ForegroundPlan, name: String,
    since start: ContinuousClock.Instant, sent: inout Sent, _ context: Context
  ) async throws(ComputerFailure) {
    if piece.usesKeyboard, sent.focusMoved {
      try await settle(plan.pid, name: name)
      sent.focusMoved = false
    }
    let problem = await readiness(plan, [piece], name: name)
    // The person's input comes first: it is what the step stops at, and likely what moved the
    // target when it is no longer ready.
    try check(since: start, sent: sent.any, context)
    if let problem { throw sent.any ? Self.changed(name) : problem }
    if piece.usesKeyboard, IsSecureEventInputEnabled() { throw Self.secure(name) }
    guard try await plan.send(piece) else {
      guard case .focus(_, let fallback?) = piece else {
        throw plan.refusal.foregroundRefused("\(name) declined the element's focus")
      }
      try await send(
        .click(fallback, count: 1), plan, name: name, since: start, sent: &sent, context)
      return
    }
    sent.any = true
    if piece.usesKeyboard { sent.keys += 1 }
    if piece.movesFocus { sent.focusMoved = true }
  }

  /// What stops the input before its next piece (R5): a stop, the deadline, or any input of the
  /// person's since the step began, which Atd's own never is: it does not pass through the HID
  /// system, and the monitors tell Atd's events from theirs.
  func check(since start: ContinuousClock.Instant, sent: Bool, _ context: Context)
    throws(ComputerFailure)
  {
    if context.isStopping() || Task.isCancelled { throw Self.stopped }
    if ContinuousClock.now >= context.deadline {
      throw ComputerFailure(.timeout, "The step's deadline passed.")
    }
    if disturbance.personActed(since: start) {
      throw ComputerFailure(
        .inputInUse,
        sent
          ? "The person used the keyboard or pointer during this step, so Atd sent no more of it."
          : "The person used the keyboard or pointer as Atd brought the target forward, so it "
            + "sent nothing.")
    }
  }

  /// After a click, a focus or a Return moved the keyboard focus: waits for the target to take it
  /// in, then watches secure input a moment longer before keys go out, since an app turns it on
  /// only once it handled the change, and keys must never reach a password field.
  private func settle(_ pid: pid_t, name: String) async throws(ComputerFailure) {
    await ForegroundActivation.drain(pid: pid)
    let end = ContinuousClock.now + Self.secureWatch
    while true {
      if IsSecureEventInputEnabled() { throw Self.secure(name) }
      guard ContinuousClock.now < end else { return }
      try? await Task.sleep(for: .milliseconds(25))
    }
  }

  // MARK: After the input

  /// Lets the target take in a step that went through before it stops being the active app: its
  /// keys reach its window only while it is active, so events still queued when the person's app
  /// comes back could be lost.
  func drain(_ sent: Sent, pid: pid_t) async {
    try? await Task.sleep(for: min(Self.drainBase + .milliseconds(4) * sent.keys, Self.drainLimit))
    await ForegroundActivation.drain(pid: pid)
  }

  /// A step that ended without finishing, with what was put back, and what may have acted.
  static func ended(_ failure: ComputerFailure, _ note: String, _ sent: Bool) -> ComputerFailure {
    var message = failure.message + " " + note
    if sent { message += " What Atd sent before it stopped may have acted." }
    return ComputerFailure(
      failure.code, message, mayHaveDispatched: failure.mayHaveDispatched || sent,
      reason: failure.reason)
  }

  /// A check that failed once part of the step went out: the screen changed under the step, so
  /// it sends no more and asks for a new observation rather than refusing as if nothing was sent.
  private static func changed(_ name: String) -> ComputerFailure {
    ComputerFailure(
      .staleObservation,
      "\(name) left the front, or the step's window lost its focus or no longer shows where the "
        + "step acts, during this step, so Atd sent no more of it. Observe the target again.")
  }

  private static func secure(_ name: String) -> ComputerFailure {
    .noBackgroundRoute(
      .secureInput,
      "Secure input is on, as a password field turns it on, so Atd sent no keys to \(name); it "
        + "never types there.")
  }

  static let stopped = ComputerFailure(.cancelled, "The step was stopped.")

  /// Whether the person holds a modifier key or a mouse button, by the HID system's state, which
  /// Atd's input never sets.
  private static var holdsInput: Bool {
    !CGEventSource.flagsState(.hidSystemState).isDisjoint(
      with: [.maskCommand, .maskShift, .maskAlternate, .maskControl])
      || [CGMouseButton.left, .right, .center].contains {
        CGEventSource.buttonState(.hidSystemState, button: $0)
      }
  }
}

extension ComputerFailure {
  /// This background refusal, with why the foreground cannot take the step either, and the
  /// `reason` that names the foreground's limit when that is another one.
  func foregroundRefused(_ why: String, reason: ComputerRefusalReason? = nil) -> ComputerFailure {
    ComputerFailure(
      code, message + " The foreground cannot take it either: \(why).",
      mayHaveDispatched: mayHaveDispatched, reason: reason ?? self.reason)
  }
}
