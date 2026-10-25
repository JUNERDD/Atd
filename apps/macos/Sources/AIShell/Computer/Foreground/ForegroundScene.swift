import AICore
import AppKit

/// What the person had in front when an act step began, before its background attempt (R4.3), and
/// putting it back afterwards (R4.6): their front app, its front window, and Atd's own panel when
/// it held the keyboard while another app was active (the task panel never activates Atd). Atd
/// never moves the pointer (R13), so there is no pointer to record. The same restore repairs a
/// background step that raised or activated the target over the person's app (R7).
///
/// It takes nothing back from the person: their app comes back only while the target, or no app,
/// is in front. An app they switched to meanwhile stays in front, and the restore says so.
struct ForegroundScene {
  /// The person's front app when the step began.
  let front: pid_t?
  /// That app's front window, by window number.
  let window: Int?
  /// Atd's window that held the keyboard while another app was active, by window number.
  let panel: Int?

  /// The scene the disturbance guard recorded when the act step began.
  init(_ before: DisturbanceSnapshot) {
    front = before.frontmost
    window = before.personWindow
    panel = before.panel
  }

  /// The person's front app's name, for the evidence; nil when it was `target`'s own, or none.
  func frontName(besides target: Set<pid_t>) -> String? {
    guard let front, !target.contains(front) else { return nil }
    return Self.name(of: front)
  }

  /// The name of the app `pid`, for the evidence.
  static func name(of pid: pid_t) -> String? {
    let app = NSRunningApplication(processIdentifier: pid)
    return app?.localizedName ?? app?.bundleIdentifier
  }

  /// Puts the scene back after a step on `target`, whatever it did, and says what it put back. An
  /// app other than the target in front now is the person's choice and stays; otherwise their
  /// front app comes back, their window comes up over the target's where one covers it, and Atd's
  /// panel gets the keyboard back. `shown`, a target that was hidden and that Atd showed for the
  /// step, is hidden again unless it stays in front.
  func restore(
    target: Set<pid_t>, shown: NSRunningApplication?,
    diagnostics: ForegroundRestorationDiagnostics? = nil
  ) async -> ForegroundRestoration {
    let front: ForegroundRestoration.Front
    if personSwitched(target: target) {
      front = .personSwitched
    } else {
      front = await bringBack(target: target, diagnostics: diagnostics)
    }
    return ForegroundRestoration(front: front, hidden: await hideAgain(shown))
  }

  private func bringBack(
    target: Set<pid_t>, diagnostics: ForegroundRestorationDiagnostics?
  ) async -> ForegroundRestoration.Front {
    guard let front else { return .noneRecorded }
    guard let app = NSRunningApplication(processIdentifier: front), !app.isTerminated else {
      return .appQuit
    }
    let own = target.contains(front)
    if !own {
      let activated = await ForegroundActivation.activate(
        app, before: .now + ForegroundActivation.limit)
      diagnostics?.activationSucceeded = activated
    }
    if personSwitched(target: target) { return .personSwitched }
    // Their window back over the target's where one covers it, also within the target itself,
    // when they had it in front and the step used another of its windows.
    if let window {
      let beforeRaise = DisturbanceSnapshot.read(target: target, personWindow: window)
      diagnostics?.sample(beforeRaise, stage: "beforeRaise")
      if beforeRaise.targetAbove {
        _ = await ForegroundActivation.raise(
          pid: front, windowId: window, restoration: diagnostics)
      }
    }
    if personSwitched(target: target) { return .personSwitched }
    if let panel, let owned = NSApp.window(withWindowNumber: panel), owned.isVisible,
      owned.canBecomeKey, !NSApp.isActive
    {
      owned.makeKey()
    }
    // AX completion does not mean WindowServer has published the new order. Observe the full
    // restoration predicate without repeating activation, raise, or the original input.
    let end = ContinuousClock.now + .milliseconds(400)
    while true {
      if app.isTerminated { return .appQuit }
      let after = DisturbanceSnapshot.read(target: target, personWindow: window)
      diagnostics?.sample(after, stage: "restorationCheck")
      if let now = after.frontmost, now != front, !target.contains(now) { return .personSwitched }
      if after.frontmost == front, !after.targetAbove { return own ? .unchanged : .restored }
      guard ContinuousClock.now < end else { return .notRestored }
      do {
        try await Task.sleep(for: min(.milliseconds(20), ContinuousClock.now.duration(to: end)))
      } catch {
        diagnostics?.waitCancelled = true
        return .notRestored
      }
    }
  }

  private func personSwitched(target: Set<pid_t>) -> Bool {
    guard let now = NSWorkspace.shared.frontmostApplication?.processIdentifier else { return false }
    return now != front && !target.contains(now)
  }

  /// Hides `shown` again, unless it is the front app now: hiding the front app would bring some
  /// other app forward in its place.
  private func hideAgain(_ shown: NSRunningApplication?) async -> ForegroundRestoration.Hidden? {
    guard let shown else { return nil }
    if shown.isTerminated || shown.isHidden { return .hiddenAgain }
    let pid = shown.processIdentifier
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier != pid, shown.hide() else {
      return .leftShown
    }
    let end = ContinuousClock.now + ForegroundActivation.limit
    while !shown.isHidden {
      guard ContinuousClock.now < end else { return .leftShown }
      try? await Task.sleep(for: .milliseconds(20))
    }
    return .hiddenAgain
  }
}
