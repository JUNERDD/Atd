import AICore
import Foundation

/// The host yields to the person (plan §1 F9/F10, §3): it never writes to a target the person
/// is using. A target is in use while it is in front of them (``ComputerEngine/isInFront(_:)``:
/// by default while its app is the frontmost one; a browser page only while the managed browser
/// is frontmost and the page has focus) and they pressed a key, clicked or scrolled within
/// ``inUseInput``; a target in front of a person who is only watching is worked on in the
/// background like any other. Once an action's claim is held and before each of its write steps,
/// a target in use fails `targetInUse` at once — no pause, no prompt, no waiting — and what was
/// observed of it is void, so the next write observes it again. The person's modal surfaces in
/// Atd, the lock screen and secure input stop writes too.
extension ComputerCoordinator {
  /// How recent the person's own key press, click or scroll must be for a target in front of
  /// them to count as in use.
  static let inUseInput: Duration = .seconds(3)

  /// Why a write to `ref` may not go on now; nil when it may.
  func interruption(_ ref: TargetRefWire, engine: any ComputerEngine) async -> ComputerFailure? {
    // Input first: it is a cheap read, and a browser asks its worker whether a page is in front.
    if let input = disturbance.lastPersonInput(), ContinuousClock.now - input < Self.inUseInput,
      await engine.isInFront(ref)
    {
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
