import AICore
import Foundation

/// The host yields to the person (plan §1 F9/F10, §3): it never writes to a target the person
/// is using. Once an action's claim is held and before each of its write steps, a target whose
/// engine says it is in use (``ComputerEngine/isInUse(_:)``: by default while its app is the
/// frontmost one; a browser page only while the managed browser is frontmost and the page has
/// focus) fails `targetInUse` at once — no pause, no prompt, no waiting — and what was observed of
/// it is void, so the next write observes it again. The person's modal surfaces in Atd, the lock
/// screen and secure input stop writes too.
extension ComputerCoordinator {
  /// Why a write to `ref` may not go on now; nil when it may.
  func interruption(_ ref: TargetRefWire, engine: any ComputerEngine) async -> ComputerFailure? {
    if await engine.isInUse(ref) {
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
