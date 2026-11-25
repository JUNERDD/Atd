import AICore
import Foundation

/// The host yields to the person (plan §1 F9/F10, §3): it never writes to a target the person
/// is using. A target is in use while it is in front of them (``ComputerEngine/isInFront(_:)``:
/// by default while its app is the frontmost one; a browser page only while the managed browser
/// is frontmost and the page has focus) and they pressed a key, clicked or scrolled within
/// ``inUseInput``; a target in front of a person who is only watching is worked on in the
/// background like any other. A target the person holds themselves (``ComputerEngine/isHeld(_:)``:
/// they took over a tab of their own Chrome in Atd for Chrome and have not handed it back) is in
/// use whatever their input, since they asked the run to keep off it; and an engine that learns of
/// the person's input in the target itself (``ComputerEngine/lastInput(on:)``: Atd for Chrome
/// reports it per tab) adds that to the host's own reading. Once an action's claim is held and
/// before each of its write steps, a target in use fails `targetInUse` at once — no pause, no
/// prompt, no waiting — and what was observed of it is void, so the next write observes it again.
/// The person's modal surfaces in Atd, the lock screen and secure input stop writes too.
extension ComputerCoordinator {
  /// How recent the person's own key press, click or scroll must be for a target in front of
  /// them to count as in use.
  static let inUseInput: Duration = .seconds(3)

  /// Why a write to `ref` may not go on now; nil when it may.
  func interruption(_ ref: TargetRefWire, engine: any ComputerEngine) async -> ComputerFailure? {
    if engine.isHeld(ref) {
      return ComputerFailure(
        .targetInUse,
        "The person took over the target and has not handed it back; nothing more was sent.")
    }
    // Input first: it is a cheap read, and a browser asks its worker whether a page is in front.
    let input = [disturbance.lastPersonInput(), engine.lastInput(on: ref)].compactMap { $0 }.max()
    if let input, ContinuousClock.now - input < Self.inUseInput, await engine.isInFront(ref) {
      return ComputerFailure(.targetInUse, "The person is using the target; nothing more was sent.")
    }
    if arbiter.heldClaims.contains(where: {
      $0.owner.isUser && $0.resources.contains(.interactiveScreen)
    }) {
      return ComputerFailure(
        .busy, "The person is using one of Atd's own screens (a capture or a file dialog).")
    }
    return ComputerScreenState.writeBlock()
  }
}
